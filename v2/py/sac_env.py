"""Browser stub of python/sac_env.py: only the pieces the demo needs (obs_of, sac_policy), copied verbatim from the paper's file.
The original imports gymnasium (training environment), which is not needed to run a trained actor. Env is a placeholder so safe_filter.py imports unchanged."""
import numpy as np
TH, D0 = 1.5, 5.0
def obs_of(v, d, vl, al, a_prev): return np.array([v / 30, (vl - v) / 10, (d - (D0 + TH * v)) / 30, d / 60, vl / 30, al / 3, a_prev / 3], dtype=np.float32)
class Env: pass
def sac_policy(model):
    def pi(st):
        o = obs_of(st['v'], st['d'], st['vl'], st['al'], st['a_prev']); act, _ = model.predict(o, deterministic=True); return st['a_prev'] + 1.5 * float(act[0])
    return pi
