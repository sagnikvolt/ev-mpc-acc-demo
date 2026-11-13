"""Battery-aware MPC ACC prototype (Python, cvxpy/OSQP). Frozen BMW i3 physics+aux model (results/bmw_i3_params_final.npy).
Decision vars: speed v_0..v_N over horizon. Energy cost = sum dt*Pb(Pw) with Pw linearised about previous iterate (SQP, 3 passes).
Gap: d_{k+1} = d_k + dt*(vl_k - (v_k+v_{k+1})/2) with lead preview vl (oracle / const / forecast supplied by caller).
Usage as module: from mpc_acc import MPC, simulate"""
import os, numpy as np, cvxpy as cp
ROOT = os.path.expanduser('~/mnt/EV Project')
P = np.load(f'{ROOT}/results/bmw_i3_params_final.npy')   # [Crr,c1,c2,r1,r2,b0,b1,b2,b3,CdA]
CRR, C1, C2, R1, R2, B0, CDA = P[0], P[1], P[2], P[3], P[4], P[5], P[9]
M, RHO, G = 1270.0, 1.2, 9.81
K = 0.5 * RHO * CDA

def pw_kw(v0, v1, dt):
    vb = 0.5 * (v0 + v1); a = (v1 - v0) / dt
    return ((M * a + M * G * CRR) * vb + K * vb**3) / 1000.0
ETA = None; CAP = 35.0; VFADE = 3.0   # ETA None = legacy plant (100% regen, no cap); else realistic regen (R0 fix, Opus 2026-11-08)
def set_regen(eta, cap=35.0, vfade=3.0):
    global ETA, CAP, VFADE; ETA, CAP, VFADE = eta, cap, vfade
def pb_kw(pw, v=None):   # battery power incl. aux (no heating/AC), kW. R0: regen = ETA*R1*fade(v)*max(pw,-CAP); excess braking is friction.
    pw = np.asarray(pw, dtype=float)
    if ETA is None: return np.where(pw >= 0, C1 * pw + C2 * pw**2, R1 * pw + R2 * pw**2) + B0 / 1000.0
    fade = np.minimum(1.0, np.asarray(v, dtype=float) / VFADE); pc = np.maximum(pw, -CAP)
    return np.where(pw >= 0, C1 * pw + C2 * pw**2, ETA * fade * (R1 * pc + R2 * pc**2)) + B0 / 1000.0
def grad_pw(v0, v1, dt):
    vb = 0.5 * (v0 + v1); a = (v1 - v0) / dt; f = M * a + M * G * CRR
    d1 = (M / dt * vb + 0.5 * f + 1.5 * K * vb**2) / 1000.0
    d0 = (-M / dt * vb + 0.5 * f + 1.5 * K * vb**2) / 1000.0
    return d0, d1

class MPC:
    def __init__(s, N=30, dt=0.5, th=1.5, d0=5.0, vmax=38.0, amin=-3.5, amax=2.0, jmax=3.0,
                 w_gap=0.2, w_v=0.002, w_tr=0.08, w_slack=200.0, pb_max=50.0, pw_regen=None,
                 dmin_a=4.0, dmin_b=0.7, w_energy=1.0, passes=3, band_a=3.0, band_b=0.25, w_cap=20.0):
        s.N, s.dt, s.th, s.d0, s.vmax = N, dt, th, d0, vmax
        s.amin, s.amax, s.jmax, s.passes = amin, amax, jmax, passes
        s.dmin_a, s.dmin_b = dmin_a, dmin_b; s.band_a, s.band_b = band_a, band_b
        v = cp.Variable(N + 1); d = cp.Variable(N + 1); sl = cp.Variable(N + 1, nonneg=True); slc = cp.Variable(N + 1, nonneg=True); s.pcap = cp.Parameter(N + 1, value=np.full(N + 1, 100.0)); el = cp.Variable(N + 1, nonneg=True); eh = cp.Variable(N + 1, nonneg=True)
        s.v, s.d, s.sl = v, d, sl
        s.pv0 = cp.Parameter(); s.pd0 = cp.Parameter(); s.pa0 = cp.Parameter()
        s.pvl = cp.Parameter(N); s.pA0 = cp.Parameter(N); s.pA1 = cp.Parameter(N); s.pA2 = cp.Parameter(N)
        s.pvr = cp.Parameter(N + 1)
        pw = s.pA0 + cp.multiply(s.pA1, v[:-1]) + cp.multiply(s.pA2, v[1:])
        s.pgA0 = cp.Parameter(N); s.pgA1 = cp.Parameter(N); s.pgA2 = cp.Parameter(N); s.pfl = cp.Parameter(N)
        pgpw = s.pgA0 + cp.multiply(s.pgA1, v[:-1]) + cp.multiply(s.pgA2, v[1:])   # g_k * pw_k (g_k = regen slope incl. eta, fade)
        pb = cp.maximum(cp.maximum(C1 * pw, pgpw), s.pfl) if ETA is not None else cp.maximum(C1 * pw, R1 * pw)   # piecewise-linear; R2*P^2<=0.4 kW dropped so problem stays a QP
        a = (v[1:] - v[:-1]) / dt
        cons = [v[0] == s.pv0, d[0] == s.pd0, v >= 0, v <= vmax,
                d[1:] == d[:-1] + dt * (s.pvl - 0.5 * (v[:-1] + v[1:])),
                a >= amin, a <= amax,
                C1 * pw <= pb_max,
                cp.abs(a[0] - s.pa0) <= jmax * dt, cp.abs(a[1:] - a[:-1]) <= jmax * dt,
                d >= dmin_a + dmin_b * v - sl]
        ddes = d0 + th * v; band = band_a + band_b * v
        cons += [d - ddes >= -band - el, d - ddes <= band + eh, v <= s.pcap + slc]   # pcap: optional breaker speed caps (inactive = 100)
        cost = w_energy * (dt / 3.6) * cp.sum(pb) + w_gap * (cp.sum_squares(el) + cp.sum_squares(eh)) \
             + w_v * cp.sum_squares(v - vmax) * 0 + w_tr * cp.sum_squares(v - s.pvr) + w_slack * cp.sum(sl) + w_cap * cp.sum(slc)
        s.prob = cp.Problem(cp.Minimize(cost), cons)
        s.vr = None; s.a_prev = 0.0
    def solve(s, v0, d0, vl_prev, a_prev, breakers=None, xe=0.0, vb=4.2):
        N, dt = s.N, s.dt
        vr = np.full(N + 1, v0) if s.vr is None else np.concatenate([s.vr[1:], s.vr[-1:]]); vr[0] = v0
        s.pv0.value, s.pd0.value, s.pa0.value, s.pvl.value = v0, d0, a_prev, np.asarray(vl_prev)
        for _ in range(s.passes):
            g0, g1 = grad_pw(vr[:-1], vr[1:], dt); p0 = pw_kw(vr[:-1], vr[1:], dt)
            s.pA1.value, s.pA2.value = g0, g1
            s.pA0.value = p0 - g0 * vr[:-1] - g1 * vr[1:]
            if ETA is not None:
                gk = ETA * R1 * np.minimum(1.0, 0.5 * (vr[:-1] + vr[1:]) / VFADE)
                s.pgA0.value, s.pgA1.value, s.pgA2.value, s.pfl.value = gk * s.pA0.value, gk * g0, gk * g1, -CAP * gk
            else:
                s.pgA0.value = s.pgA1.value = s.pgA2.value = s.pfl.value = np.zeros(N)
            s.pvr.value = vr
            cap = np.full(N + 1, 100.0)
            if breakers is not None:
                sref = xe + np.cumsum(dt * 0.5 * (vr[:-1] + vr[1:]))
                for xb in breakers:
                    if xe < xb <= sref[-1]:
                        kk = int(np.argmax(sref >= xb)) + 1; cap[kk] = min(cap[kk], vb)
                        if kk - 1 >= 1: cap[kk - 1] = min(cap[kk - 1], vb)
            s.pcap.value = cap
            s.prob.solve(solver=cp.OSQP, warm_start=True, eps_abs=1e-4, eps_rel=1e-4, max_iter=8000)
            if s.v.value is None: break
            vr = s.v.value.copy()
        ok = s.v.value is not None
        if ok: s.vr = vr
        return ok, (vr[1] - vr[0]) / dt if ok else np.clip(-1.0, s.amin, s.amax)

def cutin_metrics(short, gap_events):
    """S2 metrics (admin/indian_prereg_s1b.md): shortfall excluding 5 s after each cut-in; recovery time to shortfall<=0.5 m (mean over recovered, count not recovered within 15 s)."""
    s = np.maximum(0.0, np.array(short)); n = len(s); ev = sorted(set(int(j) // 5 for j in (gap_events or {})))
    if not ev: return dict(short_post=float(s.max()), rec_mean=np.nan, rec_unrec=0, n_ev=0)
    mask = np.ones(n, bool)
    for e in ev: mask[e:e + 10] = False
    rec, un = [], 0
    for e in ev:
        if e >= n: continue
        w = np.where(s[e:e + 30] <= 0.5)[0]
        if len(w): rec.append(0.5 * w[0])
        else: un += 1
    return dict(short_post=float(s[mask].max()) if mask.any() else 0.0, rec_mean=float(np.mean(rec)) if rec else np.nan, rec_unrec=un, n_ev=len(ev))

def simulate(vl, mpc, preview='oracle', forecaster=None, sub=5, dt_plant=0.1, th0=None, gap_events=None, breakers=None, vb=4.2, use_map=False):
    """vl: lead speed at 10 Hz (m/s). preview: 'oracle'|'const'|'forecast' (forecaster(hist_vl_10Hz, N, dt)->array N of future lead speed means).
    Returns metrics dict. Plant: nonlinear model, ZOH accel over MPC step, dt_plant substeps."""
    N, dt = mpc.N, mpc.dt; nsub = int(round(dt / dt_plant)); step10 = int(round(dt * 10))
    T = len(vl); nsteps = (T - N * step10 - 1) // step10
    v = float(vl[0]); d = mpc.d0 + mpc.th * v; a_prev = 0.0; mpc.vr = None
    short = []; xe = 0.0; cross = []; E = 0.0; dist = 0.0; dmin = 1e9; gaps = []; jerks = []; fail = 0; ds = []; vs = []
    for k in range(nsteps):
        i = k * step10
        if preview == 'oracle': pv = [np.mean(vl[i + j * step10: i + (j + 1) * step10 + 1]) for j in range(N)]
        elif preview == 'const': pv = [vl[i]] * N
        elif preview == 'constmap':   # S1b: const-speed lead preview limited by the breaker cap profile (lead slows for breakers: a_dec 2, a_acc 1)
            pv = []; xl = xe + d
            for j in range(N):
                c = min((np.sqrt(vb ** 2 + 2 * 2.0 * (xb - xl)) if xl <= xb else np.sqrt(vb ** 2 + 2 * 1.0 * (xl - xb))) for xb in breakers)
                pj = min(vl[i], c); pv.append(pj); xl += pj * dt
        else: pv = forecaster(vl[:i + 1], N, dt)
        ok, a = mpc.solve(v, d, pv, a_prev, breakers=(breakers if use_map else None), xe=xe, vb=vb)
        if not ok: fail += 1
        for q in range(nsub):
            j = i + q * 2   # dt_plant = 0.1 s = one 10 Hz sample
            j = i + q
            v1 = max(0.0, v + a * dt_plant)
            pw = pw_kw(v, v1, dt_plant); E += float(pb_kw(pw, 0.5 * (v + v1))) * dt_plant / 3.6   # Wh
            if gap_events is not None and j in gap_events: d = min(d, gap_events[j])
            d += (vl[j] - 0.5 * (v + v1)) * dt_plant; dist += 0.5 * (v + v1) * dt_plant; xn = xe + 0.5 * (v + v1) * dt_plant
            if breakers is not None:
                for xb in breakers:
                    if xe < xb <= xn: cross.append(v1)
            xe = xn; v = v1
            dmin = min(dmin, d); 
        short.append(mpc.dmin_a + mpc.dmin_b * v - d); gaps.append(d); ds.append(d - (mpc.d0 + mpc.th * v)); vs.append(v); jerks.append((a - a_prev) / dt); a_prev = a
    dke = 0.5 * M * (v**2 - float(vl[0])**2) / 3600.0   # Wh of KE change vs. start (reported for fairness)
    _r = dict(E_wh=E, dist_m=dist, whkm=E / dist * 1000 if dist > 0 else np.nan, whkm_adj=(E - dke * 0.9) / dist * 1000,
                dmin=dmin, gap_mean=float(np.mean(gaps)), gap_err_rms=float(np.sqrt(np.mean(np.square(ds)))),
                jerk_rms=float(np.sqrt(np.mean(np.square(jerks)))), viol=float(np.mean(np.array(gaps) < mpc.dmin_a + mpc.dmin_b * np.array(vs) - 1e-6)),
                fail=fail, steps=nsteps, ncross=len(cross), cross_excess=float(np.mean(np.maximum(0, np.array(cross) - vb))) if cross else 0.0, cross_excess_max=float(np.max(np.maximum(0, np.array(cross) - vb))) if cross else 0.0, cross_frac=float(np.mean(np.array(cross) > vb + 1.0)) if cross else 0.0, short_max=float(max(0.0, max(short))), v_end=v, dgap_end=ds[-1])
    _r.update(cutin_metrics(short, gap_events)); return _r
