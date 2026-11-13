/* Web Worker: runs the paper's Python (mpc_acc, baselines, safe_filter) in Pyodide. Nothing leaves the visitor's device. */
const PYODIDE_VERSION = '314.0.7';   // pinned; the feasibility test used the current stable Pyodide (numpy, scipy, cvxpy-base, clarabel, scikit-learn, lightgbm all present). Fallback known to carry the same packages: 0.29.5
const INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
importScripts(INDEX_URL + 'pyodide.js');
const here = new URL('.', self.location.href).href;   // works from any path, e.g. https://ev.sagniknath.in/v2/
const PY_FILES = ['mpc_acc.py', 'baselines.py', 'safe_filter.py', 'sac_env.py', 'demo_core.py', 'demo_api.py', 'bmw_i3_params_final.csv'];
const DATA_FILES = ['windows.npz', 'sac42.npz', 'safesac42.npz', 'rl_meta.json'];
let py = null, api = null, mlReady = false, bmwLoaded = false;
const post = (type, o) => postMessage(Object.assign({ type }, o || {}));
async function getBuf(path) { const r = await fetch(here + path); if (!r.ok) throw new Error('could not load ' + path + ' (' + r.status + ')'); return new Uint8Array(await r.arrayBuffer()); }
async function init() {
  const t0 = performance.now();
  post('progress', { frac: 0.03, msg: 'Loading Python runtime (Pyodide ' + PYODIDE_VERSION + ')...' });
  py = await loadPyodide({ indexURL: INDEX_URL });
  post('progress', { frac: 0.25, msg: 'Loading numpy, scipy, cvxpy, clarabel...' });
  await py.loadPackage(['numpy', 'scipy', 'clarabel', 'cvxpy-base']);
  post('progress', { frac: 0.7, msg: 'Loading the paper\'s Python files and trained actors...' });
  py.FS.mkdirTree('/evdemo/py'); py.FS.mkdirTree('/evdemo/data');
  for (const f of PY_FILES) py.FS.writeFile('/evdemo/py/' + f, await getBuf('py/' + f));
  for (const f of DATA_FILES) py.FS.writeFile('/evdemo/data/' + f, await getBuf('data/' + f));
  py.runPython("import sys; sys.path.insert(0,'/evdemo/py'); import demo_api");
  api = py.pyimport('demo_api');
  post('progress', { frac: 0.9, msg: 'Starting the energy model and MPC solver...' });
  const info = JSON.parse(api.init('/evdemo/data'));
  // warm-up: build one MPC problem and solve once (first solve is slower)
  api.run_window('mpc_const', 0, 0.65, 35.0);
  post('ready', { info, pyodide: PYODIDE_VERSION, secs: (performance.now() - t0) / 1000, windows: JSON.parse(api.window_list()) });
}
async function ensureML() {
  if (mlReady) return;
  post('progress', { frac: 0.1, msg: 'Loading scikit-learn and LightGBM (first time only)...' });
  await py.loadPackage(['scikit-learn', 'lightgbm']); mlReady = true;
}
async function ensureBMW() {
  if (bmwLoaded) return;
  post('progress', { frac: 0.5, msg: 'Loading BMW i3 data (about 8 MB)...' });
  py.FS.writeFile('/evdemo/data/bmw_i3_train.npz', await getBuf('data/bmw_i3_train.npz'));
  const info = JSON.parse(api.load_bmw('/evdemo/data/bmw_i3_train.npz')); bmwLoaded = true; return info;
}
const q = []; let busy = false;
onmessage = (e) => { q.push(e.data); pump(); };
async function pump() {
  if (busy) return; busy = true;
  while (q.length) {
    const m = q.shift(), t0 = performance.now();
    try {
      let res;
      if (m.cmd === 'init') { await init(); continue; }
      if (!api) throw new Error('worker not initialised');
      if (m.cmd === 'runWindow') res = JSON.parse(api.run_window(m.arm, m.idx, m.eta, m.cap));
      else if (m.cmd === 'runUpload') res = JSON.parse(api.run_upload(m.arm, m.speeds, m.hz, m.unit, m.eta, m.cap));
      else if (m.cmd === 'checkUpload') res = JSON.parse(api.check_upload(m.speeds, m.hz, m.unit));
      else if (m.cmd === 'train') { await ensureML(); const info = await ensureBMW(); post('progress', { frac: 0.7, msg: 'Training ' + m.model + '...' }); res = JSON.parse(api.train(m.model, m.mode, m.n_target, m.importance)); if (info) res.data_info = info; }
      else throw new Error('unknown command ' + m.cmd);
      post('result', { id: m.id, cmd: m.cmd, res, secs: (performance.now() - t0) / 1000 });
    } catch (err) { post('error', { id: m.id, msg: String(err && err.message || err) }); }
  }
  busy = false;
}
