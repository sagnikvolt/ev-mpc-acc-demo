'use strict';
/* Shared code for every page: helpers, the engine (worker.js, Pyodide) on /run/ and /train/ only, CSV export, lightbox, self-test hook. All simulation and training run on the visitor's device. */
const $ = id => document.getElementById(id);
const ARMS = {
  acc: { name: 'Tuned ACC', c: 'var(--c-acc)', w: 1.5, dash: '6 4' }, smc: { name: 'SMC', c: 'var(--c-smc)', w: 1.5, dash: '1.5 3.5' }, sac42: { name: 'Plain SAC (seed 42)', c: 'var(--c-sac42)', w: 1.5, dash: '9 3 1.5 3' },
  safesac42: { name: 'Safe SAC (seed 42)', c: 'var(--c-safesac42)', w: 1, dash: '12 4' }, mpc_const: { name: 'MPC const-speed (our design car)', c: 'var(--c-mpc_const)', w: 2.25 },
  mpc_oracle: { name: 'MPC oracle (ceiling, not deployable)', c: 'var(--c-mpc_oracle)', w: 1, dash: '3 3' }
};
const SHORT = { acc: 'Tuned ACC', smc: 'SMC', sac42: 'Plain SAC', safesac42: 'Safe SAC', mpc_const: 'MPC (ours)', mpc_oracle: 'MPC oracle' };
const REC = { n: 'Recorded follower', name: 'Recorded follower', c: 'var(--c-recorded)', w: 1.5 }, LEAD = { name: 'Lead', c: 'var(--lead)', w: 1 };
const swatch = o => `<svg class="sw" viewBox="0 0 24 8" aria-hidden="true"><line x1="0" x2="24" y1="4" y2="4" style="stroke:${o.c};stroke-width:${o.w || 1.5};stroke-linecap:round"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/></svg>`;
document.querySelectorAll('[data-arm]').forEach(e => { e.innerHTML = swatch(ARMS[e.dataset.arm]); });
const ARM_ORDER = ['acc', 'smc', 'sac42', 'safesac42', 'mpc_const', 'mpc_oracle'];
const SIZES = [10000, 25000, 50000, 100000, 0];
/* Desktop = wide viewport and a fine pointer; ?engine=1 forces the engine on for testing on any device. Only /run/ and /train/ start the engine (body data-engine="1"). */
const DESKTOP = /[?&]engine=1(&|$)/.test(location.search) || (matchMedia('(min-width: 900px)').matches && matchMedia('(pointer: fine)').matches);
const ENGINE = document.body.dataset.engine === '1';
const READY = [];   // functions run once the engine is ready (each page registers its own)
function applyGate() {
  const lm = $('lmsg'); if (lm) lm.textContent = 'Live engine available on desktop'; const lb = $('lbar'); if (lb) lb.parentNode.style.display = 'none'; document.body.classList.add('gated');
  const gate = '<div class="gate" role="note"><h3>Runs on desktop and laptop browsers</h3><p>The live engine downloads about 30 MB and needs a few seconds of computing, so it is switched off on phones and tablets. Everything on the Results, MATLAB check and Code pages works here; open ev.sagniknath.in on a computer to run it.</p></div>';
  document.querySelectorAll('.rail, .stage > :not(.stage-title):not(footer)').forEach(e => { e.hidden = true; });
  const t = document.querySelector('.stage-title'); if (t) t.insertAdjacentHTML('afterend', gate);
}
function setChip(st, txt) { const c = $('chip'); if (!c) return; c.dataset.s = st; $('chiptxt').textContent = txt; }
function setTChip(st, txt) { const c = $('tchip'); if (!c) return; c.dataset.s = st; $('tchiptxt').textContent = txt; }
if (ENGINE && !DESKTOP) { applyGate(); setChip('idle', 'Not on this device'); setTChip('idle', 'Not on this device'); } else if (ENGINE) { setChip('loading', 'Loading engine 0%'); setTChip('loading', 'Loading engine'); }
if (!DESKTOP && document.body.dataset.page === 'home') { const acts = document.querySelectorAll('.hero .actions a'); if (acts.length === 2) { acts[0].remove(); acts[1].classList.remove('alt'); } }
let REF = null, MLREF = null, WINDOWS = [], PYV = '', readyInfo = null, progressSink = null;
const fmt = (x, d = 2) => (x === null || x === undefined || Number.isNaN(x)) ? '-' : Number(x).toFixed(d);
const pct = (a, b) => (100 * (a - b) / b);
const sgn = x => (x > 0 ? '+' : '') + x.toFixed(2).replace('-', '\u2212') + '%';

/* ---------------- worker plumbing ---------------- */
const worker = ENGINE && DESKTOP ? new Worker('/worker.js?v=20261114g', { type: 'module' }) : null;   // phones and tablets never create the worker, so Pyodide and the data files are never requested
let nextId = 1; const pending = new Map(); let readyRes, readyRej; const ready = new Promise((a, b) => { readyRes = a; readyRej = b; });
function setBar(frac, msg) { $('lbar').style.transform = 'scaleX(' + frac.toFixed(3) + ')'; $('lmsg').textContent = readyInfo ? msg : 'Loading the engine… (first visit downloads ~30 MB)'; if (!readyInfo) setChip('loading', 'Loading engine ' + Math.round(frac * 100) + '%'); if (progressSink) progressSink(frac, msg); }
if (worker) worker.onmessage = e => {
  const m = e.data;
  if (m.type === 'progress') setBar(m.frac, m.msg);
  else if (m.type === 'ready') { readyInfo = m; WINDOWS = m.windows; PYV = m.pyodide; setBar(1, 'Engine ready · ' + m.secs.toFixed(1) + ' s on your device'); $('lbar').parentNode.style.display = 'none'; readyRes(m); READY.forEach(f => f()); }
  else if (m.type === 'result') { const p = pending.get(m.id); if (p) { pending.delete(m.id); p.res(m); } }
  else if (m.type === 'error') { const p = pending.get(m.id); if (p) { pending.delete(m.id); p.rej(new Error(m.msg)); } else { $('lmsg').innerHTML = '<span class="err">Could not start the Python runtime: ' + m.msg + '</span>'; readyRej(new Error(m.msg)); } }
};
if (worker) worker.onerror = e => { $('lmsg').innerHTML = '<span class="err">Worker error: ' + (e.message || e) + '</span>'; };
function call(msg) { const id = nextId++; return new Promise((res, rej) => { pending.set(id, { res, rej }); worker.postMessage(Object.assign({ id }, msg)); }); }
if (ENGINE && DESKTOP) Promise.all([fetch('/data/reference.json').then(r => r.json()), fetch('/data/ml_reference.json').then(r => r.json())]).then(([a, b]) => { REF = a; MLREF = b; });
if (worker) worker.postMessage({ cmd: 'init' });

/* ---------------- CSV helper ---------------- */
const csvCell = v => { const x = String(v === null || v === undefined ? '' : v); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
function saveText(name, text) { const u = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })), a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000); }

/* ---------------- lightbox (MATLAB gallery and the MATLAB figure of Run it) ---------------- */
const EVLB = (function () {
  const dlg = $('lb'); if (!dlg || !dlg.showModal) return { open() {} }; let items = [], cur = 0;
  const show = i => { cur = (i + items.length) % items.length; const it = items[cur]; $('lb-img').src = it.src; $('lb-img').alt = it.alt; $('lb-cap').textContent = it.cap || ''; $('lb-n').textContent = items.length > 1 ? (cur + 1) + ' of ' + items.length : ''; };
  const open = (list, i) => { items = list; show(i || 0); $('lb-prev').hidden = $('lb-next').hidden = list.length < 2; dlg.showModal(); };
  $('lb-prev').onclick = () => show(cur - 1); $('lb-next').onclick = () => show(cur + 1);
  dlg.addEventListener('keydown', e => { if (items.length > 1 && e.key === 'ArrowLeft') { e.preventDefault(); show(cur - 1); } else if (items.length > 1 && e.key === 'ArrowRight') { e.preventDefault(); show(cur + 1); } });
  dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
  const btns = [...document.querySelectorAll('.gal .gal-b')], list = btns.map(b => { const im = b.querySelector('img'); return { src: im.currentSrc || im.src, alt: im.alt, cap: b.dataset.cap || '', im }; });
  btns.forEach((b, i) => { b.onclick = () => { list.forEach(l => { l.src = l.im.currentSrc || l.im.src; }); open(list, i); }; });
  return { open };
})();


/* ---------------- hidden self-test hook (for the PASS RULE check) ---------------- */
window.runSelfTest = async function (opts) {
  if (!DESKTOP) throw new Error('The engine is switched off on this device; add ?engine=1 to the address to force it on.');
  opts = opts || {}; const t00 = performance.now(); await ready; while (!REF || !MLREF) await new Promise(r => setTimeout(r, 100));
  const TOL = { acc: 0.01, smc: 0.01, sac42: 0.1, safesac42: 0.1, mpc_const: 0.2, mpc_oracle: 0.2 }, rows = [], idxs = []; for (let i = 0; i < 160; i += 16) idxs.push(i);
  const useIdx = opts.idxs || idxs; let fullWindowSecs = null;
  for (const idx of useIdx) {
    const tw = performance.now();
    for (const a of ARM_ORDER) {
      window.__selfTestProgress = `window ${idx} arm ${a}`;
      const m = await call({ cmd: 'runWindow', arm: a, idx, eta: 0.65, cap: 35.0 }), o = m.res, s = REF.windows[idx][a], d = pct(o.whkm_adj, s.whkm_adj);
      rows.push({ idx, win: REF.windows[idx].win, arm: a, browser: o.whkm_adj, stored: s.whkm_adj, pct: d, tol: TOL[a], within: Math.abs(d) <= TOL[a], unsafe_browser: o.short_max > 0.5, unsafe_stored: s.short_max > 0.5, same_flag: (o.short_max > 0.5) === (s.short_max > 0.5), fail: o.fail || 0, secs: m.secs });
    }
    if (fullWindowSecs === null) fullWindowSecs = (performance.now() - tw) / 1000;
  }
  const arms = {}; ARM_ORDER.forEach(a => { const x = rows.filter(r => r.arm === a); arms[a] = { tol_pct: TOL[a], max_abs_pct: Math.max(...x.map(r => Math.abs(r.pct))), all_within: x.every(r => r.within), all_flags_same: x.every(r => r.same_flag), solver_failures: x.reduce((s, r) => s + r.fail, 0), n: x.length, mean_secs: x.reduce((s, r) => s + r.secs, 0) / x.length }; arms[a].pass = arms[a].all_within && arms[a].all_flags_same && arms[a].solver_failures === 0 && x.length === useIdx.length; });
  let lgbm = null;
  if (!opts.skipTrain) {
    window.__selfTestProgress = 'LightGBM full-data training'; const tt = performance.now(), m = await call({ cmd: 'train', model: 'lgbm', mode: 'resid', n_target: 0, importance: false }), r = m.res, ref = MLREF.rmse_fold0.lgbm_resid.rmse_kw, d = pct(r.rmse_kw, ref);
    lgbm = { rmse_kw: r.rmse_kw, paper_fold0_rmse_kw: ref, pct_diff: d, limit_pct: 5, pass: Math.abs(d) <= 5, n_train: r.n_train, n_trips: r.n_trips, train_secs: r.train_s, call_secs: m.secs };
  }
  const rep = { pyodide: PYV, versions: readyInfo && readyInfo.info.versions, windows_tested: useIdx, arms, lightgbm: lgbm, first_window_all_6_arms_secs: fullWindowSecs, startup_secs: readyInfo && readyInfo.secs, total_secs: (performance.now() - t00) / 1000, rows };
  rep.overall_pass = ARM_ORDER.every(a => arms[a].pass) && (!lgbm || lgbm.pass); window.__selfTest = rep; window.__selfTestProgress = 'done'; return rep;
};

