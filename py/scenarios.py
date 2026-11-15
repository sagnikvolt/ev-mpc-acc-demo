"""Stylized Indian-traffic disturbances injected into real lead trajectories (see admin/indian_prereg.md). All return (vl_eff, gap_events, breakers)."""
import numpy as np
DT = 0.1
def s1_breakers(vl, rng, vb=4.2, a_dec=2.0, a_acc=1.0):
    x0 = 5.0 + 1.5 * vl[0]; bk = [rng.uniform(150, 250)]; xmax = x0 + vl.mean() * 120 + 500
    while bk[-1] < xmax: bk.append(bk[-1] + rng.uniform(250, 600))
    out = np.empty_like(vl); xl = x0; prev = vl[0]
    for i in range(len(vl)):
        cap = min((np.sqrt(vb ** 2 + 2 * a_dec * (xb - xl)) if xl <= xb else np.sqrt(vb ** 2 + 2 * a_acc * (xl - xb))) for xb in bk)
        tgt = min(vl[i], cap); prev = float(np.clip(tgt, prev - 3.0 * DT, prev + 2.0 * DT)) if i else vl[0]; out[i] = prev; xl += prev * DT
    return out, None, bk
def s2_cutins(vl, rng):
    out = vl.copy(); ev = {}; t = 15.0 + rng.exponential(35.0); defi = 0.0; T = 10.0; tc = None
    times = []
    while t < 110: times.append(t); t += rng.exponential(35.0)
    k = 0; defi = 0.0; T = 10.0
    for i in range(len(vl)):
        ts = i * DT
        while k < len(times) and ts >= times[k]:
            defi = rng.uniform(2, 5); T = rng.uniform(8, 14); ev[i] = rng.uniform(8, 15); k += 1
        out[i] = max(0.0, vl[i] - defi); defi *= np.exp(-DT / T)
    return out, ev, None
def s3_hardbrake(vl, rng):
    out = vl.copy(); t_next = 15.0 + rng.exponential(35.0); mode = 'n'; v = vl[0]; hold = 0.0; ab = 3.0; vmin = 0.0
    for i in range(len(vl)):
        ts = i * DT
        if mode == 'n' and ts >= t_next: mode = 'b'; ab = rng.uniform(2.5, 3.5); vmin = rng.uniform(0, 0.3) * v; hold = 0.0
        if mode == 'n': v = vl[i]
        elif mode == 'b':
            v = max(vmin, v - ab * DT)
            if v <= vmin + 1e-6: mode = 'h'; hold = 3.0
        elif mode == 'h':
            hold -= DT
            if hold <= 0: mode = 'r'
        elif mode == 'r':
            v = v + 1.5 * DT
            if v >= vl[i]: mode = 'n'; t_next = ts + rng.exponential(35.0); v = vl[i]
        out[i] = v
    return out, None, None
GEN = {1: s1_breakers, 2: s2_cutins, 3: s3_hardbrake}

def apply_caps(v, x0, bk, vb=4.2, a_dec=2.0, a_acc=1.0):
    """Same breaker cap + rate limiter as s1_breakers, for any vehicle starting x0 m ahead of the ego start."""
    out = np.empty_like(v); xl = x0; prev = v[0]
    for i in range(len(v)):
        cap = min((np.sqrt(vb ** 2 + 2 * a_dec * (xb - xl)) if xl <= xb else np.sqrt(vb ** 2 + 2 * a_acc * (xl - xb))) for xb in bk)
        tgt = min(v[i], cap); prev = float(np.clip(tgt, prev - 3.0 * DT, prev + 2.0 * DT)) if i else v[0]; out[i] = prev; xl += prev * DT
    return out
