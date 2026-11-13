"""Entry points called by worker.js (all return JSON strings). Keeps state (data, actors) in module globals."""
import json, math, numpy as np, demo_core as C
_S = {}
def _clean(o):
    if isinstance(o, dict): return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)): return [_clean(v) for v in o]
    if isinstance(o, (np.floating, float)): return None if (math.isnan(o) or math.isinf(o)) else float(o)
    if isinstance(o, np.integer): return int(o)
    if isinstance(o, np.bool_): return bool(o)
    return o
def _dump(o): return json.dumps(_clean(o), separators=(',', ':'))
def init(data_dir):
    C.init(); Z = np.load(data_dir + '/windows.npz'); _S['Z'] = {k: Z[k] for k in Z.files}
    _S['actors'] = {'sac42': C.load_actor(data_dir + '/sac42.npz'), 'safesac42': C.load_actor(data_dir + '/safesac42.npz')}
    _S['gamma'] = json.load(open(data_dir + '/rl_meta.json'))['gamma']
    return _dump(dict(n_windows=len(_S['Z']['win']), versions=_versions()))
def _versions():
    import cvxpy, clarabel, scipy; return dict(numpy=np.__version__, scipy=scipy.__version__, cvxpy=cvxpy.__version__, clarabel=getattr(clarabel, '__version__', '?'))
def window_list():
    Z = _S['Z']; return _dump([dict(idx=i, win=int(Z['win'][i]), campaign=str(Z['campaign'][i]), group=str(Z['group'][i]), vehicle=str(Z['vehicle'][i]), mean_vl=float(np.mean(Z['vl'][i]))) for i in range(len(Z['win']))])
def run_window(arm, idx, eta, cap):
    Z = _S['Z']; vl = Z['vl'][idx].astype(float)
    if arm == 'recorded': return _dump(C.recorded(Z['vf'][idx], Z['ivs'][idx], eta, cap, trace=True))
    o = C.run_arm(arm, vl, eta, cap, _S['actors'], _S['gamma'], trace=True)
    o['trace']['lead'] = [float(x) for x in vl[::5][:len(o['trace']['t'])]]; return _dump(o)
def run_upload(arm, speeds_json, hz, unit, eta, cap):
    vl = C.prepare_upload(json.loads(speeds_json), int(hz), unit); o = C.run_arm(arm, vl, eta, cap, _S['actors'], _S['gamma'], trace=True)
    o['trace']['lead'] = [float(x) for x in vl[::5][:len(o['trace']['t'])]]; o['seconds_simulated'] = o['steps'] * 0.5; return _dump(o)
def check_upload(speeds_json, hz, unit):
    vl = C.prepare_upload(json.loads(speeds_json), int(hz), unit); return _dump(dict(seconds=(len(vl) - 1) / 10.0, vmax=float(vl.max()), vmean=float(vl.mean())))
def load_bmw(path):
    _S['bmw'] = C.BMW(path); b = _S['bmw']; return _dump(dict(n_train=len(b.tr), n_test=len(b.te), n_trips_train=int(len(np.unique(b.trip[b.tr]))), n_trips_test=int(len(np.unique(b.trip[b.te])))))
def train(model, mode, n_target, importance):
    return _dump(C.train_eval(_S['bmw'], model, mode, int(n_target), bool(importance)))
