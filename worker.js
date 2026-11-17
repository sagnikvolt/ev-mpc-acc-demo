/* Module Web Worker (new Worker(url,{type:'module'})): runs the paper's Python (mpc_acc, baselines, safe_filter) in Pyodide. Nothing leaves the visitor's device. */
import { loadPyodide } from 'https://cdn.jsdelivr.net/pyodide/v314.0.7/full/pyodide.mjs';   // static import needs a literal URL; keep in sync with PYODIDE_VERSION below
const PYODIDE_VERSION = '314.0.7';   // pinned; the feasibility test used the current stable Pyodide (numpy, scipy, cvxpy-base, clarabel, scikit-learn, lightgbm all present). Fallback known to carry the same packages: 0.29.5
const INDEX_URL = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
const here = new URL('.', import.meta.url).href, VQ = new URL(import.meta.url).search;   // VQ = '?v=...' of this worker file; added to our own file fetches so a new build replaces cached copies   // works from any path, e.g. https://ev.sagniknath.in/v2/
const PY_FILES = ['mpc_acc.py', 'baselines.py', 'safe_filter.py', 'sac_env.py', 'scenarios.py', 'road_demo.py', 'demo_core.py', 'demo_api.py', 'bmw_i3_params_final.csv'];
const DATA_FILES = ['windows.npz', 'sac42.npz', 'safesac42.npz', 'rl_meta.json'];
let py = null, api = null, mlReady = false, bmwLoaded = false;
const post = (type, o) => postMessage(Object.assign({ type }, o || {}));
/* Round x: real loading stages for the overlay (post-only; no computation changes). 'ld' events: {stage, state: 'start'|'done'} at real boundaries, and {bytes: {runtime, packages, files}} = bytes of the files this worker has finished fetching (Resource Timing, decoded size; for our own files the exact length). */
const LDB = { runtime: 0, packages: 0, files: 0 }, LDSEEN = new Set(); 
const ldStage = (stage, state) => post('ld', { stage, state, at: performance.now() });
function ldBytes(cls, n, url) { if (url) { if (LDSEEN.has(url)) return; LDSEEN.add(url); } LDB[cls] += n; post('ld', { bytes: Object.assign({}, LDB), at: performance.now() }); }
try { new PerformanceObserver(list => { for (const r of list.getEntries()) { if (r.name.startsWith(INDEX_URL)) { const f = r.name.slice(INDEX_URL.length).split('?')[0], n = r.decodedBodySize || r.encodedBodySize || r.transferSize || 0; ldBytes(/^(pyodide\.(mjs|asm\.js|asm\.wasm)|python_stdlib\.zip|pyodide-lock\.json)$/.test(f) ? 'runtime' : 'packages', n, r.name); } } }).observe({ type: 'resource', buffered: true }); } catch (e) { }
async function getBuf(path) { const r = await fetch(here + path + VQ); if (!r.ok) throw new Error('could not load ' + path + ' (' + r.status + ')'); const b = new Uint8Array(await r.arrayBuffer()); if (ldFiles) ldBytes('files', b.length, here + path); return b; }
let ldFiles = false;
async function init() {
  const t0 = performance.now();
  post('progress', { frac: 0.03, msg: 'Loading Python runtime (Pyodide ' + PYODIDE_VERSION + ')...' });
  ldStage('runtime', 'start'); py = await loadPyodide({ indexURL: INDEX_URL }); ldStage('runtime', 'done');
  post('progress', { frac: 0.25, msg: 'Loading numpy, scipy, cvxpy, clarabel...' });
  ldStage('packages', 'start'); await py.loadPackage(['numpy', 'scipy', 'clarabel', 'cvxpy-base']); ldStage('packages', 'done');
  post('progress', { frac: 0.7, msg: 'Loading the paper\'s Python files and trained actors...' });
  py.FS.mkdirTree('/evdemo/py'); py.FS.mkdirTree('/evdemo/data');
  ldStage('files', 'start'); ldFiles = true;
  for (const f of PY_FILES) py.FS.writeFile('/evdemo/py/' + f, await getBuf('py/' + f));
  for (const f of DATA_FILES) py.FS.writeFile('/evdemo/data/' + f, await getBuf('data/' + f));
  ldFiles = false; ldStage('files', 'done'); ldStage('import', 'start');
  py.runPython("import sys; sys.path.insert(0,'/evdemo/py'); import demo_api"); ldStage('import', 'done');
  api = py.pyimport('demo_api');
  post('progress', { frac: 0.9, msg: 'Starting the energy model and MPC solver...' });
  ldStage('init', 'start'); const info = JSON.parse(api.init('/evdemo/data'));
  // warm-up: build one MPC problem and solve once (first solve is slower)
  ldStage('init', 'done'); ldStage('solve', 'start'); api.run_window('mpc_const', 0, 0.65, 35.0);
  post('ready', { at: performance.now(), info, pyodide: PYODIDE_VERSION, secs: (performance.now() - t0) / 1000, windows: JSON.parse(api.window_list()) });
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
onmessage = (e) => {
  if (e.data.cmd === 'urls') {   // for the opt-in offline cache: every file this worker has fetched so far (Resource Timing lists module imports too). Answered at once, not queued.
    const urls = [...new Set([INDEX_URL + 'pyodide.mjs'].concat(performance.getEntriesByType('resource').map(r => r.name)).filter(u => u.startsWith('https://cdn.jsdelivr.net/pyodide/v' + PYODIDE_VERSION + '/') || u.startsWith(here)))];
    post('urls', { id: e.data.id, urls }); return;
  }
  q.push(e.data); pump();
};
async function pump() {
  if (busy) return; busy = true;
  while (q.length) {
    const m = q.shift(), t0 = performance.now();
    try {
      let res;
      if (m.cmd === 'init') { await init(); continue; }
      if (!api) throw new Error('worker not initialised');
      if (m.cmd === 'runWindow') { post('log', { msg: `worker: ${m.arm} on window index ${m.idx}, Python call started` }); res = JSON.parse(api.run_window(m.arm, m.idx, m.eta, m.cap, m.road || 'plain')); post('log', { msg: `worker: ${m.arm} finished in ${((performance.now() - t0) / 1000).toFixed(2)} s` + (res.steps !== undefined ? `, ${res.steps} decision steps` : '') }); }
      else if (m.cmd === 'runUpload') { post('log', { msg: `worker: ${m.arm} on the uploaded trace, Python call started` }); res = JSON.parse(api.run_upload(m.arm, m.speeds, m.hz, m.unit, m.eta, m.cap, m.road || 'plain', m.seed || 7100)); post('log', { msg: `worker: ${m.arm} finished in ${((performance.now() - t0) / 1000).toFixed(2)} s` + (res.steps !== undefined ? `, ${res.steps} decision steps` : '') }); }
      else if (m.cmd === 'checkUpload') res = JSON.parse(api.check_upload(m.speeds, m.hz, m.unit));
      else if (m.cmd === 'train') { await ensureML(); const info = await ensureBMW(); post('progress', { frac: 0.7, msg: 'Training ' + m.model + '...' }); post('log', { msg: `worker: Python call train(${m.model}, ${m.mode}, n_target ${m.n_target}, importance ${m.importance}) started` }); res = JSON.parse(api.train(m.model, m.mode, m.n_target, m.importance)); post('log', { msg: `worker: train finished: fit ${res.train_s.toFixed(1)} s, fit + test${m.importance ? ' + importance' : ''} ${res.total_s.toFixed(1)} s` }); if (info) res.data_info = info; }
      else throw new Error('unknown command ' + m.cmd);
      post('result', { id: m.id, cmd: m.cmd, res, secs: (performance.now() - t0) / 1000 });
    } catch (err) { post('error', { id: m.id, msg: String(err && err.message || err) }); }
  }
  busy = false;
}
