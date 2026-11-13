"""Glue for the browser demo (and its native check). Runs the paper's OWN files (mpc_acc, baselines, safe_filter) unchanged.
Only run-time differences: (1) cvxpy solver OSQP -> CLARABEL (monkeypatch of Problem.solve), (2) SAC actors as a numpy forward pass of the SB3 weights,
(3) mpc_acc's parameter file is built from the packaged CSV under a scratch HOME (mpc_acc reads ~/mnt/EV Project/results/bmw_i3_params_final.npy at import)."""
import os, sys, tempfile, warnings, numpy as np
warnings.filterwarnings('ignore')
HERE = os.path.dirname(os.path.abspath(__file__)); A = B = SF = SE = None; CVX = None
ARMS = ('acc', 'smc', 'sac42', 'safesac42', 'mpc_const', 'mpc_oracle')
def init(solver_opts=None):
    """Import the science modules under a scratch HOME and install the CLARABEL patch. Call once."""
    global A, B, SF, SE, CVX
    tmp = tempfile.mkdtemp(prefix='evdemo_'); rd = os.path.join(tmp, 'mnt', 'EV Project', 'results'); os.makedirs(rd)
    vals = [float(l.split(',')[1]) for l in open(os.path.join(HERE, 'bmw_i3_params_final.csv')).read().strip().splitlines()[1:]]
    np.save(os.path.join(rd, 'bmw_i3_params_final.npy'), np.array(vals)); os.environ['HOME'] = tmp
    if HERE not in sys.path: sys.path.insert(0, HERE)
    import cvxpy as cp, mpc_acc, baselines, safe_filter, sac_env
    A, B, SF, SE, CVX = mpc_acc, baselines, safe_filter, sac_env, cp
    install_clarabel(solver_opts or {})
def install_clarabel(opts):
    """Swap OSQP for CLARABEL: mpc_acc.MPC.solve calls prob.solve(solver=cp.OSQP, warm_start, eps_abs, eps_rel, max_iter); OSQP-only kwargs are dropped. mpc_acc.py itself is not edited."""
    cp = CVX
    if not hasattr(cp.Problem, '_orig_solve'): cp.Problem._orig_solve = cp.Problem.solve
    orig = cp.Problem._orig_solve
    def solve(self, *a, **kw):
        kw = {k: v for k, v in kw.items() if k in ('verbose',)}; kw.update(opts)
        return orig(self, solver=cp.CLARABEL, **kw)
    cp.Problem.solve = solve
class NumpyActor:
    """Deterministic SB3 SAC actor: action = tanh(mu(relu(W1 relu(W0 obs + b0) + b1))). predict() mimics SB3's signature."""
    def __init__(s, npz):
        z = np.load(npz) if isinstance(npz, str) else npz; s.W0, s.b0, s.W1, s.b1, s.Wm, s.bm = [np.asarray(z[k], np.float32) for k in ('W0', 'b0', 'W1', 'b1', 'Wm', 'bm')]
    def predict(s, obs, deterministic=True):
        o = np.asarray(obs, np.float32); h = np.maximum(s.W0 @ o + s.b0, 0); h = np.maximum(s.W1 @ h + s.b1, 0); return np.tanh(s.Wm @ h + s.bm), None
def load_actor(path): return NumpyActor(path)
def prepare_upload(speeds, hz=10, unit='mps'):
    """Same rules as the AWS demo: 30-180 s, 0-46 m/s, resampled to 10 Hz."""
    x = np.asarray(speeds, float)
    if not np.all(np.isfinite(x)): raise ValueError('speeds contain non-numeric values')
    if hz not in (1, 2, 5, 10): raise ValueError('hz must be 1, 2, 5 or 10')
    if unit == 'kmh': x = x / 3.6
    dur = (len(x) - 1) / hz
    if dur < 30: raise ValueError('trace is %.0f s long; need at least 30 s' % dur)
    if dur > 180: raise ValueError('trace is %.0f s long; the demo allows at most 180 s' % dur)
    if x.min() < -0.5 or x.max() > 46.0: raise ValueError('speeds must be between 0 and 46 m/s (166 km/h)')
    t = np.arange(len(x)) / hz; t10 = np.arange(0, t[-1] + 1e-9, 0.1); return np.interp(t10, t, np.clip(x, 0, None))
class _Rec:
    def __init__(s): s.v = []; s.d = []
def run_arm(arm, vl, eta=0.65, cap=35.0, actors=None, gamma=0.1, trace=False):
    """Run one arm on a 10 Hz lead trace. Returns the simulate() metrics dict (+ trace of state at each 0.5 s control step if trace)."""
    A.set_regen(float(eta), cap=float(cap)); vl = np.asarray(vl, float); rec = _Rec(); res = None
    if arm in ('acc', 'smc', 'sac42', 'safesac42'):
        if arm == 'acc': base = B.acc_policy(0.4, 1.0)
        elif arm == 'smc': base = B.smc_policy(0.3, 0.5, 2.0)
        elif arm == 'sac42': base = SE.sac_policy(actors['sac42'])
        else: base = SF.filtered_policy(actors['safesac42'], gamma)
        def pol(s): rec.v.append(float(s['v'])); rec.d.append(float(s['d'])); return base(s)
        o = B.simulate(vl, pol)
        if arm == 'safesac42': o['iv_rate'] = base.iv / max(base.n, 1); o['infeasible'] = int(base.inf)
    else:
        class M(A.MPC):
            def solve(s, v0, d0, *a, **k): rec.v.append(float(v0)); rec.d.append(float(d0)); return super().solve(v0, d0, *a, **k)
        o = A.simulate(vl, M(), preview='const' if arm == 'mpc_const' else 'oracle')
    o = {k: (float(v) if isinstance(v, (int, float, np.floating, np.integer)) else v) for k, v in o.items()}
    if trace:
        v = rec.v + [o['v_end']]; d = rec.d + [o['dgap_end'] + 5.0 + 1.5 * o['v_end']]   # final gap = desired gap + gap error (D0=5, TH=1.5)
        E = [0.0]
        for k in range(len(v) - 1):
            e = E[-1]; va = v[k]
            for q in range(5):
                v1 = va + (v[k + 1] - v[k]) / 5.0; e += float(A.pb_kw(A.pw_kw(va, v1, 0.1), 0.5 * (va + v1))) * 0.1 / 3.6; va = v1
            E.append(e)
        o['trace'] = dict(t=[0.5 * k for k in range(len(v))], v=v, gap=d, wh=E)
    return o

# ---------------------------------------------------------------- training panel (BMW i3, fold 0 held out; same settings as python/ml_bench.py and python/feature_importance.py)
GROUPS = {'Speed (v, v2, lags)': ['v', 'v2', 'v_l2', 'v_l5', 'v_m5'], 'Acceleration (a, av, lags)': ['a', 'av', 'a_l2', 'a_l5', 'a_m5'], 'Road grade': ['gr'], 'Cabin heating': ['heat'],
          'Air-conditioning': ['ac'], 'Ambient temperature': ['amb'], 'Battery temperature': ['bt'], 'State of charge': ['soc']}
class BMW:
    def __init__(s, npz):
        z = np.load(npz) if isinstance(npz, str) else npz
        s.X = z['X'].astype(np.float64); s.Pb = z['Pb'].astype(np.float64); s.trip = z['trip']; s.fold = z['fold']; s.t = z['t'].astype(np.float64)
        s.Pp = z['Pphys_0'].astype(np.float64); s.Pw = z['Pw_0'].astype(np.float64); s.fn = [str(x) for x in z['feat_names']]
        s.tr = np.where(s.fold != 0)[0]; s.te = np.where(s.fold == 0)[0]
    def build(s, resid):
        X, tr, te = s.X, s.tr, s.te
        med = np.nanmedian(X[tr], axis=0); med = np.where(np.isnan(med), 0, med); f = lambda a: np.where(np.isnan(a), med, a); mu = f(X[tr]).mean(0); sd = f(X[tr]).std(0) + 1e-9
        Xtr, Xte = (f(X[tr]) - mu) / sd, (f(X[te]) - mu) / sd; cols = list(s.fn)
        if resid:
            m_, s_ = s.Pw[tr].mean(), s.Pw[tr].std() + 1e-9; Xtr = np.column_stack([Xtr, (s.Pw[tr] - m_) / s_]); Xte = np.column_stack([Xte, (s.Pw[te] - m_) / s_]); cols.append('Pw')
        return Xtr, Xte, cols
    def subset(s, n_target, rep=0):
        """whole trips added in a fixed random order (seed 100+rep, as the learning-curve script, fold 0) until >= n_target samples; n_target 0 = all."""
        trips_tr = np.unique(s.trip[s.tr]); order = np.random.default_rng(100 + rep).permutation(trips_tr)
        if not n_target: return np.ones(len(s.tr), bool), len(trips_tr)
        chosen = []; cnt = 0
        for t in order:
            chosen.append(t); cnt += int((s.trip[s.tr] == t).sum())
            if cnt >= n_target: break
        return np.isin(s.trip[s.tr], chosen), len(chosen)
def _fit(model, Xtr, ytr):
    if model == 'lgbm':
        import lightgbm as lgb; return lgb.LGBMRegressor(n_estimators=400, learning_rate=0.05, num_leaves=31, min_child_samples=50, subsample=0.8, subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0, random_state=42, n_jobs=1, verbose=-1).fit(Xtr, ytr), lambda m, a: m.booster_.predict(a)   # booster predict = same numbers as m.predict, without sklearn's per-call validation
    if model == 'ridge':
        from sklearn.linear_model import Ridge; return Ridge(alpha=10.0).fit(Xtr, ytr), lambda m, a: m.predict(a)
    rng = np.random.default_rng(42)
    if model == 'knn':
        from sklearn.neighbors import KNeighborsRegressor; sel = rng.choice(len(Xtr), min(70000, len(Xtr)), replace=False)
        return KNeighborsRegressor(n_neighbors=25, weights='distance', n_jobs=1).fit(Xtr[sel], ytr[sel]), lambda m, a: m.predict(a)
    from sklearn.svm import SVR; sel = rng.choice(len(Xtr), min(8000, len(Xtr)), replace=False); sc = np.std(ytr[sel])
    return SVR(kernel='rbf', C=3.0, epsilon=0.05, gamma='scale').fit(Xtr[sel], ytr[sel] / sc), lambda m, a: m.predict(a) * sc
def train_eval(D, model='lgbm', mode='resid', n_target=0, importance=True):
    """Train on folds != 0 (optionally a whole-trip subset), test on fold 0. Returns RMSE kW, trip-energy errors, optional grouped permutation importance."""
    import time; t0 = time.time(); resid = mode == 'resid'; Xtr, Xte, cols = D.build(resid); msk, ntrips = D.subset(n_target)
    target = (D.Pb - D.Pp) if resid else D.Pb; ytr = target[D.tr][msk]
    m, pr = _fit(model, Xtr[msk], ytr); t_fit = time.time() - t0
    out = pr(m, Xte); pred = out + D.Pp[D.te] if resid else out; y = D.Pb[D.te]; e = pred - y
    r = dict(model=model, mode=mode, n_train=int(msk.sum()), n_trips=int(ntrips), n_test=int(len(D.te)), rmse_kw=float(np.sqrt(np.mean(e ** 2)) / 1000), mae_kw=float(np.mean(np.abs(e)) / 1000),
             r2=float(1 - np.sum(e ** 2) / np.sum((y - y.mean()) ** 2)), train_s=t_fit)
    tt = D.trip[D.te]; tte = D.t[D.te]; errs = []; Em = Ey = 0.0
    for n in np.unique(tt):
        i = np.where(tt == n)[0]; E1 = np.trapezoid(pred[i], tte[i]) / 3.6e6; E0 = np.trapezoid(y[i], tte[i]) / 3.6e6; errs.append(100 * (E1 - E0) / E0); Em += E1; Ey += E0
    r['trip_err'] = [float(x) for x in errs]; r['trip_med_abs'] = float(np.median(np.abs(errs))); r['pooled_err'] = float(100 * (Em - Ey) / Ey)
    if importance:
        prng = np.random.default_rng(7); nrep = 3 if model == 'lgbm' else 2; nsub = None if model == 'lgbm' else 5000
        idx = np.arange(len(D.te)) if nsub is None else np.sort(prng.choice(len(D.te), min(nsub, len(D.te)), replace=False)); a = Xte[idx]; yy = target[D.te][idx]
        base = float(np.sqrt(np.mean((pr(m, a) - yy) ** 2)) / 1000); groups = dict(GROUPS)
        if resid: groups['Physics wheel power (Pw)'] = ['Pw']
        imp = {}
        for g, fs in groups.items():
            ci = [cols.index(f) for f in fs]; inc = []
            for _ in range(nrep):
                b = a.copy(); p = prng.permutation(len(b)); b[:, ci] = a[p][:, ci]; inc.append(float(np.sqrt(np.mean((pr(m, b) - yy) ** 2)) / 1000) - base)
            imp[g] = float(np.mean(inc))
        r['importance'] = imp; r['importance_base_rmse_kw'] = base
    r['total_s'] = time.time() - t0; return r

# ---------------------------------------------------------------- recorded follower (copied from python/normal_car.py: smooth, replay, jerk_rms; 1.0 s smoothing, first 1046 samples)
def _smooth(v, n):
    if n <= 1: return v.copy()
    k = np.ones(n); return np.convolve(v, k, 'same') / np.convolve(np.ones(len(v)), k, 'same')
def _replay(v):
    v0, v1 = v[:-1], v[1:]; vm = 0.5 * (v0 + v1)
    E = float(np.sum(A.pb_kw(A.pw_kw(v0, v1, 0.1), vm)) * 0.1 / 3.6); dist = float(np.sum(vm) * 0.1)
    dke = 0.5 * A.M * (v[-1] ** 2 - v[0] ** 2) / 3600.0
    return (E - 0.9 * dke) / dist * 1000
def _jerk_rms(v):
    a = (v[5::5] - v[:-5:5][:len(v[5::5])]) / 0.5; return float(np.sqrt(np.mean(np.square(np.diff(a) / 0.5))))
def recorded(vf, ivs, eta=0.65, cap=35.0, trace=False):
    """Recorded follower replayed through the same battery model (as results/normal_car). vf, ivs: 10 Hz arrays (>=1046 samples)."""
    A.set_regen(float(eta), cap=float(cap)); n = 209 * 5 + 1
    vf = np.clip(np.asarray(vf[:n], float), 0, None); iv = np.asarray(ivs[:n], float); vs = _smooth(vf, 11); ok = ~np.isnan(iv)
    o = dict(whkm_adj=_replay(vs), jerk_rms=_jerk_rms(vs), gap_mean=float(np.mean(iv[ok])) if ok.mean() > 0.5 else None,
             short_max=float(np.max(4.0 + 0.7 * vs[ok] - iv[ok])) if ok.mean() > 0.5 else None)
    if trace: o['trace'] = dict(t=[0.5 * k for k in range(0, n, 5) if k < n], v=[float(x) for x in vf[::5]], gap=[None if np.isnan(x) else float(x) for x in iv[::5]])
    return o
