"""Baseline car-following controllers on the SAME plant/metrics as mpc_acc.simulate (control every 0.5 s, ZOH, 0.1 s plant, same limits).
Common limits for ALL controllers incl. MPC: a in [-3.5, 2.0] m/s^2, jerk <= 3 m/s^3 (=> |da| <= 1.5 per 0.5 s step), v in [0, 38].
Controllers: 'acc' (constant-time-gap PD, conventional ACC), 'smc' (sliding-mode), policy callable for SAC."""
import numpy as np, mpc_acc as A
TH, D0, DMIN_A, DMIN_B = 1.5, 5.0, 4.0, 0.7
def acc_policy(k1, k2):
    def pi(s):
        e = s['d'] - (D0 + TH * s['v']); return k1 * e + k2 * (s['vl'] - s['v'])
    return pi
def smc_policy(lam, K, phi):
    def pi(s):
        e = s['d'] - (D0 + TH * s['v']); ev = s['vl'] - s['v']; sl = ev + lam * e
        return (s['al'] + lam * ev + K * np.clip(sl / phi, -1, 1)) / (1 + lam * TH)
    return pi
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

def simulate(vl, policy, dt=0.5, dt_plant=0.1, gap_events=None, breakers=None, vb=4.2):
    step10 = int(round(dt * 10)); nsub = int(round(dt / dt_plant)); N = 30; T = len(vl); nsteps = (T - N * step10 - 1) // step10
    v = float(vl[0]); d = D0 + TH * v; a_prev = 0.0
    short = []; xe = 0.0; cross = []; E = 0.0; dist = 0.0; dmin = 1e9; gaps = []; jerks = []; ds = []; vs = []
    for k in range(nsteps):
        i = k * step10; al = np.clip((vl[i] - vl[max(i - 10, 0)]) / 1.0, -3.5, 2.0)
        a = float(policy(dict(v=v, d=d, vl=vl[i], al=al, a_prev=a_prev, i=i, hist=vl[:i + 1], xe=xe, breakers=breakers, vb=vb)))
        a = np.clip(a, a_prev - 1.5, a_prev + 1.5); a = float(np.clip(a, -3.5, 2.0))
        if v >= 38.0 and a > 0: a = 0.0
        for q in range(nsub):
            j = i + q; v1 = max(0.0, v + a * dt_plant); E += float(A.pb_kw(A.pw_kw(v, v1, dt_plant), 0.5 * (v + v1))) * dt_plant / 3.6
            if gap_events is not None and j in gap_events: d = min(d, gap_events[j])
            d += (vl[j] - 0.5 * (v + v1)) * dt_plant; dist += 0.5 * (v + v1) * dt_plant; xn = xe + 0.5 * (v + v1) * dt_plant
            if breakers is not None:
                for xb in breakers:
                    if xe < xb <= xn: cross.append(v1)
            xe = xn; v = v1; dmin = min(dmin, d)
        short.append(DMIN_A + DMIN_B * v - d); gaps.append(d); ds.append(d - (D0 + TH * v)); vs.append(v); jerks.append((a - a_prev) / dt); a_prev = a
    dke = 0.5 * A.M * (v ** 2 - float(vl[0]) ** 2) / 3600.0
    _r = dict(E_wh=E, dist_m=dist, whkm=E / dist * 1000 if dist > 0 else np.nan, whkm_adj=(E - dke * 0.9) / dist * 1000, dmin=dmin, gap_mean=float(np.mean(gaps)),
                gap_err_rms=float(np.sqrt(np.mean(np.square(ds)))), jerk_rms=float(np.sqrt(np.mean(np.square(jerks)))), viol=float(np.mean(np.array(short) > 1e-6)),
                fail=0, steps=nsteps, ncross=len(cross), cross_excess=float(np.mean(np.maximum(0, np.array(cross) - vb))) if cross else 0.0, cross_excess_max=float(np.max(np.maximum(0, np.array(cross) - vb))) if cross else 0.0, cross_frac=float(np.mean(np.array(cross) > vb + 1.0)) if cross else 0.0, short_max=float(max(0.0, max(short))), v_end=v, dgap_end=ds[-1])
    _r.update(cutin_metrics(short, gap_events)); return _r

def acc_map_policy(k1, k2, ac=1.5, kv=1.0):
    base = acc_policy(k1, k2)
    def pi(s):
        a = base(s); xs = [x for x in (s['breakers'] or []) if x > s['xe']]
        if xs:
            xb = min(xs); vdes = np.sqrt(s['vb'] ** 2 + 2 * ac * max(xb - s['xe'], 0.0)); a = min(a, kv * (vdes - s['v']))
        return a
    return pi
