"""Control-barrier safety filter for car-following RL. See preregistrations/safe_rl_prereg.md.
Barrier h = d - (4.0 + 0.7 v). Discrete CBF: h(next) >= (1-gamma) h(now), lead assumed to keep its current decel over the 0.5 s step.
The filter only lowers acceleration. Jerk limit (+-1.5 m/s per 0.5 s step) and accel limits [-3.5, 2] apply to all arms, so a_cbf below
max(-3.5, a_prev-1.5) cannot be executed: counted as 'infeasible' (and the maximum braking allowed by the plant is applied)."""
import numpy as np, mpc_acc as A, sac_env as SE
DT, DA, DB = 0.5, 4.0, 0.7
def a_cbf(v, d, vl, al, gamma):
    al_neg = min(al, 0.0); h = d - (DA + DB * v)
    return (d + DT * (vl + 0.5 * al_neg * DT - v) - DA - DB * v - (1 - gamma) * h) / (0.5 * DT ** 2 + DB * DT)
def filt(a_rl, v, d, vl, al, a_prev, gamma):
    """returns executed accel (before the plant's own clipping), cbf bound, intervened, infeasible"""
    ac = a_cbf(v, d, vl, al, gamma); a = min(a_rl, ac); lo = max(-3.5, a_prev - 1.5)
    return a, ac, ac < a_rl - 1e-9, ac < lo - 1e-9
class FilteredPolicy:
    """policy for baselines.simulate: SAC action -> CBF filter. Counts interventions."""
    def __init__(s, model, gamma): s.m, s.g = model, gamma; s.n = s.iv = s.inf = 0
    def __call__(s, st):
        o = SE.obs_of(st['v'], st['d'], st['vl'], st['al'], st['a_prev']); act, _ = s.m.predict(o, deterministic=True)
        a_rl = float(np.clip(st['a_prev'] + 1.5 * float(act[0]), st['a_prev'] - 1.5, st['a_prev'] + 1.5))
        a, ac, iv, inf = filt(a_rl, st['v'], st['d'], st['vl'], st['al'], st['a_prev'], s.g); s.n += 1; s.iv += iv; s.inf += inf; return a
def filtered_policy(model, gamma): return FilteredPolicy(model, gamma)
class FEnv(SE.Env):
    """SAC env with the filter inside: executed = filtered action; extra reward -0.1*|a_rl - a_exec|."""
    def __init__(s, gamma=0.3, folds=(0, -1), seed=0): super().__init__(folds=folds, seed=seed); s.gamma = gamma; s.n_iv = s.n_st = 0
    def step(s, act):
        i = s.k * 5; al = float(np.clip((s.vl[i] - s.vl[max(i - 10, 0)]) / 1.0, -3.5, 2.0))
        a_rl = float(np.clip(s.a + 1.5 * float(np.clip(act[0], -1, 1)), -3.5, 2.0)); a, ac, iv, inf = filt(a_rl, s.v, s.d, s.vl[i], al, s.a, s.gamma)
        a = float(np.clip(a, s.a - 1.5, s.a + 1.5)); a = float(np.clip(a, -3.5, 2.0))
        if s.v >= 38 and a > 0: a = 0.0
        s.n_iv += int(iv); s.n_st += 1; da = a - s.a; E = 0.0
        for q in range(5):
            v1 = max(0.0, s.v + a * 0.1); E += float(A.pb_kw(A.pw_kw(s.v, v1, 0.1), 0.5 * (s.v + v1))) * 0.1 / 3.6; s.d += (s.vl[i + q] - 0.5 * (s.v + v1)) * 0.1; s.v = v1
        band = 3 + 0.25 * s.v; e = s.d - (SE.D0 + SE.TH * s.v); exc = max(0.0, abs(e) - band); sh = max(0.0, 4 + 0.7 * s.v - s.d)
        r = -E / 2 - 0.02 * min(exc, 30.0) ** 2 - 0.3 * min(sh, 20.0) - 0.05 * abs(da) - 0.1 * abs(a_rl - a); s.a = a; s.k += 1
        col = s.d < 0.5
        if col: r -= 300.0 + 3.0 * (120 - s.k)
        return s._obs(), r, bool(col), bool(s.k >= 120), {}
