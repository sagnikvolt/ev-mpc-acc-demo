'use strict';
/* Shared code for every page: helpers, the engine (worker.js, Pyodide) on /run/ and /train/ only, CSV export, lightbox, self-test hook. All simulation and training run on the visitor's device. */
const $ = id => document.getElementById(id);
const SITE_V = '20261118x';   // same as VER in build_site.py (the build checks it)
const ARMS = {
  acc: { name: 'Tuned ACC', c: 'var(--c-acc)', w: 1.5, dash: '6 4' }, smc: { name: 'SMC', c: 'var(--c-smc)', w: 1.5, dash: '1.5 3.5' }, sac42: { name: 'Plain SAC (seed 42)', c: 'var(--c-sac42)', w: 1.5, dash: '9 3 1.5 3' },
  safesac42: { name: 'Safe SAC (seed 42)', c: 'var(--c-safesac42)', w: 1, dash: '12 4' }, mpc_const: { name: 'MPC const-speed (our design car)', c: 'var(--c-mpc_const)', w: 2.25 },
  mpc_oracle: { name: 'MPC oracle (ceiling, not deployable)', c: 'var(--c-mpc_oracle)', w: 1, dash: '3 3' },
  /* Round m: arms that exist only on the speed-breaker road (the paper's S1b arms, plus two contrasts that ignore the breakers) */
  acc_map: { name: 'Tuned ACC, knows the breakers', c: 'var(--c-acc)', w: 1.5, dash: '6 4' }, mpc_map_L: { name: 'MPC const-speed, knows the breakers (our design car)', c: 'var(--c-mpc_const)', w: 2.25 },
  mpc_oracle_map: { name: 'MPC oracle, knows the breakers (ceiling)', c: 'var(--c-mpc_oracle)', w: 1, dash: '3 3' }, acc_blind: { name: 'Tuned ACC, ignores the breakers (contrast)', c: 'var(--c-acc)', w: 1, dash: '2 3' },
  mpc_blind: { name: 'MPC const-speed, ignores the breakers (contrast)', c: 'var(--c-mpc_const)', w: 1.25, dash: '2 3' }
};
const SHORT = { acc: 'Tuned ACC', smc: 'SMC', sac42: 'Plain SAC', safesac42: 'Safe SAC', mpc_const: 'MPC (ours)', mpc_oracle: 'MPC oracle', acc_map: 'ACC + map', mpc_map_L: 'MPC + map', mpc_oracle_map: 'Oracle + map', acc_blind: 'ACC, no map', mpc_blind: 'MPC, no map' };
const REC = { n: 'Recorded follower', name: 'Recorded follower', c: 'var(--c-recorded)', w: 1.5 }, LEAD = { name: 'Lead', c: 'var(--lead)', w: 1 };
const swatch = o => `<svg class="sw" viewBox="0 0 24 8" aria-hidden="true"><line x1="0" x2="24" y1="4" y2="4" style="stroke:${o.c};stroke-width:${o.w || 1.5};stroke-linecap:round"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/></svg>`;
document.querySelectorAll('[data-arm]').forEach(e => { e.innerHTML = swatch(ARMS[e.dataset.arm]); });
const ARM_ORDER = ['acc', 'smc', 'sac42', 'safesac42', 'mpc_const', 'mpc_oracle'];
const ROAD_ORDER = ['acc_map', 'mpc_map_L', 'mpc_oracle_map', 'acc_blind', 'mpc_blind'];
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
if (!DESKTOP && document.body.dataset.page === 'replay') { const acts = document.querySelectorAll('.hero .actions a'); if (acts.length === 2) { acts[0].remove(); acts[1].classList.remove('alt'); } }
let REF = null, MLREF = null, WINDOWS = [], PYV = '', readyInfo = null, progressSink = null;
const fmt = (x, d = 2) => (x === null || x === undefined || Number.isNaN(x)) ? '-' : Number(x).toFixed(d);
const pct = (a, b) => (100 * (a - b) / b);
const sgn = x => (x > 0 ? '+' : '') + x.toFixed(2).replace('-', '\u2212') + '%';

/* ---------------- worker plumbing ---------------- */
const worker = ENGINE && DESKTOP ? new Worker('/worker.js?v=' + SITE_V, { type: 'module' }) : null;   // phones and tablets never create the worker, so Pyodide and the data files are never requested
const EVLD = { q: [], sink: null, push(m) { if (this.sink) this.sink(m); else this.q.push(m); } };   // Round x: loading-stage events for the loading overlay (load_scene.js); queued until the overlay script has attached
let nextId = 1; const pending = new Map(); let readyRes, readyRej; const ready = new Promise((a, b) => { readyRes = a; readyRej = b; });
const engineSaved = () => { try { return localStorage.getItem('ev_keep_engine') === '1' && 'caches' in window; } catch (e) { return false; } };   // the engine is kept on this device (Keep the engine): no download wording then
const LOAD_TXT = () => engineSaved() ? 'Loading the engine from this device…' : 'Loading the engine… (first visit downloads ~30 MB)';
if (ENGINE && DESKTOP && $('lmsg')) $('lmsg').textContent = LOAD_TXT();
function setBar(frac, msg) { $('lbar').style.transform = 'scaleX(' + frac.toFixed(3) + ')'; $('lmsg').textContent = readyInfo ? msg : LOAD_TXT(); if (!readyInfo) setChip('loading', 'Loading engine ' + Math.round(frac * 100) + '%'); if (progressSink) progressSink(frac, msg); }
if (worker) worker.onmessage = e => {
  const m = e.data;
  if (m.type === 'progress') { setBar(m.frac, m.msg); if (Proc.running) Proc.log(m.msg); }
  else if (m.type === 'log') Proc.log(m.msg);
  else if (m.type === 'ld') EVLD.push(m);
  else if (m.type === 'ready') { readyInfo = m; WINDOWS = m.windows; PYV = m.pyodide; setBar(1, 'Engine ready · ' + m.secs.toFixed(1) + ' s on your device'); $('lbar').parentNode.style.display = 'none'; readyRes(m); EVLD.push({ type: 'ready', secs: m.secs, at: m.at }); READY.forEach(f => f()); }
  else if (m.type === 'urls') { const p = pending.get(m.id); if (p) { pending.delete(m.id); p.res(m); } }
  else if (m.type === 'result') { const p = pending.get(m.id); if (p) { pending.delete(m.id); p.res(m); } }
  else if (m.type === 'error') { const p = pending.get(m.id); if (p) { pending.delete(m.id); p.rej(new Error(m.msg)); } else { $('lmsg').innerHTML = '<span class="err">Could not start the Python runtime: ' + m.msg + '</span>'; readyRej(new Error(m.msg)); EVLD.push({ type: 'error' }); } }
};
if (worker) worker.onerror = e => { EVLD.push({ type: 'error' }); $('lmsg').innerHTML = '<span class="err">Worker error: ' + (e.message || e) + '</span>'; };
function call(msg) { const id = nextId++; return new Promise((res, rej) => { pending.set(id, { res, rej }); worker.postMessage(Object.assign({ id }, msg)); }); }
if (ENGINE && DESKTOP) Promise.all([fetch('/data/reference.json?v=' + SITE_V).then(r => r.json()), fetch('/data/ml_reference.json?v=' + SITE_V).then(r => r.json())]).then(([a, b]) => { REF = a; MLREF = b; });
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



/* ---------------- Keep the engine on this device (opt-in; service worker /sw.js + Cache Storage; no cookies) ----------------
   Off until the visitor ticks the box and presses "Keep it". The choice is a flag in localStorage (wrapped in try/catch). "Not now" hides the banner for this visit only and stores nothing.
   What is saved: the Python runtime and packages (jsDelivr), our py/ and data/ files and the pages' own scripts. "Remove" deletes the caches, unregisters the worker and clears the flag. */
const KEEP = (function () {
  const FLAG = 'ev_keep_engine', BYTES = 'ev_keep_bytes', CAN = !!(window.isSecureContext && 'serviceWorker' in navigator && 'caches' in window);
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }, lsDel = k => { try { localStorage.removeItem(k); } catch (e) { } };
  let declined = false; try { declined = sessionStorage.getItem('ev_keep_no') === '1'; } catch (e) { }
  const mb = b => { const x = b / 1048576; return x >= 10 ? x.toFixed(0) : x.toFixed(1); };
  let SZ = null; fetch('/data/engine_size.json?v=' + SITE_V).then(r => r.ok ? r.json() : null).then(d => { SZ = d; paint(); }).catch(() => { });
  const isOn = () => lsGet(FLAG) === '1';
  const expect = () => { if (!SZ) return null; return document.body.dataset.page === 'train' ? SZ.train_bytes : SZ.run_bytes; };
  async function measure() {
    let n = 0; for (const k of await caches.keys()) { if (!k.startsWith('ev-')) continue; const c = await caches.open(k); for (const rq of await c.keys()) { const r = await c.match(rq); if (r) n += (await r.clone().blob()).size; } } return n;
  }
  let state = 'off', files = 0, total = 0, msg = '';   // off | saving | on
  async function collect() {   // put every file the page and the worker have fetched into the caches (skips what is already there)
    let urls = [];
    if (ENGINE && DESKTOP && typeof worker !== 'undefined' && worker) { await ready; const r = await call({ cmd: 'urls' }); urls = r.urls || []; }
    const page = performance.getEntriesByType('resource').map(r => r.name).filter(u => u.startsWith(location.origin) && /[?&]v=/.test(u)), ldx = ENGINE && DESKTOP ? ['https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js', location.origin + '/media/home3d/car.bin?v=' + SITE_V] : [];   // ldx: the loading overlay's 3D car (three.js and car.bin), so a saved engine also starts its film without the network
    urls = [...new Set(urls.concat(page, ldx, [location.href]))]; total = urls.length; files = 0;
    const cPy = await caches.open('ev-pyodide-v314.0.7'), cSite = await caches.open('ev-site-' + SITE_V), cThree = await caches.open('ev-three-0.170.0');
    for (const u of urls) {
      const c = u.startsWith(location.origin) ? cSite : u.includes('/npm/three@') ? cThree : cPy, rq = new Request(u); msg = 'Saving file ' + (files + 1) + ' of ' + total; paint();
      if (!(await c.match(rq, u === location.href ? { ignoreSearch: true } : undefined))) { const r = await fetch(rq); if (r.status === 200) await c.put(rq, r); }
      files++;
    }
  }
  async function warm() {
    state = 'saving'; msg = 'Starting...'; paint();
    try {
      await navigator.serviceWorker.register('/sw.js?v=' + SITE_V, { scope: '/' }); await navigator.serviceWorker.ready;
      if (navigator.storage && navigator.storage.persist) { try { await navigator.storage.persist(); } catch (e) { } }
      msg = 'Waiting for the engine to finish loading...'; paint(); await collect();
      const b = await measure(); lsSet(BYTES, String(b)); state = 'on';
    } catch (err) { state = 'off'; msg = 'Could not save: ' + (err && err.message || err); lsDel(FLAG); }
    paint();
  }
  async function rewarm() { if (!isOn() || state === 'saving') return; try { await collect(); const b = await measure(); lsSet(BYTES, String(b)); state = 'on'; paint(); } catch (e) { } }
  async function remove() {
    try { for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister(); } catch (e) { }
    try { for (const k of await caches.keys()) if (k.startsWith('ev-')) await caches.delete(k); } catch (e) { }
    lsDel(FLAG); lsDel(BYTES); state = 'off'; declined = false; try { sessionStorage.removeItem('ev_keep_no'); } catch (e) { } paint();
  }
  function optIn() { if (!lsSet(FLAG, '1')) { msg = 'This browser does not let the page save a choice, so nothing was saved.'; paint(); return; } warm(); }
  /* the three places: banner (Run it, Train it), rail status (same pages), About */
  function html(where) {
    const b = lsGet(BYTES), e = expect(), sz = b ? mb(+b) : (e ? mb(e) : null);
    if (state === 'saving') return `<span class="keep-s">Saving the engine on this device... <span class="mono" role="status">${msg}</span></span>`;
    if (state === 'on' || isOn()) return `<span class="keep-s"><i class="keep-dot" aria-hidden="true"></i>Engine saved on this device${sz ? ' (' + sz + ' MB)' : ''}</span><button type="button" class="alt sm" data-keep="remove">Remove</button>`;
    return '';
  }
  function paint() {
    if (!CAN) { const a = $('keep-about'); if (a) a.innerHTML = '<p class="lim mut">This browser cannot keep the engine on the device (it needs a secure page with service workers and Cache Storage).</p>'; return; }
    const on = state === 'on' || state === 'saving' || isOn(), e = expect(), sz = e ? mb(e) : null, size = sz ? 'About ' + sz + ' MB' : 'Some tens of MB';
    const bn = $('keepbar'); if (bn) { bn.hidden = on || declined || !(ENGINE && DESKTOP); if (!bn.hidden) { const t = bn.querySelector('.keep-sz'); if (t) t.textContent = size; const er = bn.querySelector('.keep-err'); if (er) er.textContent = msg && state === 'off' ? msg : ''; } }
    const rs = $('keepstat'); if (rs) { rs.hidden = !on; rs.innerHTML = on ? html('rail') : ''; }
    const ab = $('keep-about'); if (ab) {
      ab.innerHTML = (on ? `<div class="keep-row">${html('about')}</div>` : `<div class="keep-row"><label class="check"><input type="checkbox" id="keep-ab-tick"><span>Keep the engine on this device. ${size} is saved in this browser. The next visit then starts without downloading it.</span></label><button type="button" class="btn sm" id="keep-ab-go" disabled>Keep it</button></div>`) + (msg && state === 'off' ? `<p class="err lim">${msg}</p>` : '') +
        (ENGINE ? '' : '<p class="lim mut">The files are saved the next time you open Run it or Train it.</p>');
      const t = $('keep-ab-tick'), g = $('keep-ab-go'); if (t && g) { t.onchange = () => { g.disabled = !t.checked; }; g.onclick = () => { if (!ENGINE) { if (lsSet(FLAG, '1')) { navigator.serviceWorker.register('/sw.js?v=' + SITE_V, { scope: '/' }).then(() => { state = 'on'; paint(); }).catch(er => { lsDel(FLAG); msg = 'Could not turn it on: ' + er.message; paint(); }); } } else optIn(); }; }
    }
    document.querySelectorAll('[data-keep=remove]').forEach(b => { b.onclick = remove; });
  }
  function mount() {
    if (!CAN) { paint(); return; }
    if (ENGINE && DESKTOP) {
      const t = document.querySelector('.stage-title');
      if (t && !$('keepbar')) t.insertAdjacentHTML('afterend', '<div class="keepbar" id="keepbar" role="region" aria-label="Keep the engine on this device" hidden><p class="keep-q"><strong>Keep the engine on this device?</strong> <span class="keep-sz">About 30 MB</span> is saved in your browser so the next visit starts without downloading. You can remove it any time on <a href="/about/#h-keep">About</a>.</p><div class="keep-act"><label class="check"><input type="checkbox" id="keep-tick"><span>Yes, save it in this browser</span></label><button type="button" class="btn sm" id="keep-go" disabled>Keep it</button><button type="button" class="alt sm" id="keep-no">Not now</button></div><p class="err lim keep-err" role="alert"></p></div>');
      const lb = $('loadbox'); if (lb && !$('keepstat')) lb.insertAdjacentHTML('afterend', '<div class="keepstat" id="keepstat" hidden></div>');
      const tk = $('keep-tick'), go = $('keep-go'), no = $('keep-no');
      if (tk) tk.onchange = () => { go.disabled = !tk.checked; }; if (go) go.onclick = () => { if (tk.checked) optIn(); }; if (no) no.onclick = () => { declined = true; try { sessionStorage.setItem('ev_keep_no', '1'); } catch (e) { } paint(); };
    }
    if (isOn()) { state = 'on'; navigator.serviceWorker.register('/sw.js?v=' + SITE_V, { scope: '/' }).catch(() => { }); if (lsGet(BYTES) === null) measure().then(b => { if (b) { lsSet(BYTES, String(b)); paint(); } }); }
    paint();
  }
  mount();
  return { remove, optIn, measure, rewarm, get state() { return state; } };
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


/* ---------------- Process pane: what is happening while Run it / Train it computes ----------------
   Stages are driven by what the page and the worker really report (per controller on Run it; per Python call on Train it). It shows elapsed time and the stage that is running, a short plain explanation of that stage, and a time-stamped log of the worker's messages. No percentages: the worker does not report any. */
const Proc = (function () {
  const el = $('proc'), bar = $('procbar'), st = document.querySelector('.stage');
  const none = { running: false, show() {}, log() {}, start() {}, stage() {}, finish() {}, fail() {}, note() {} };
  if (!el || !bar || !st) return none;
  let t0 = 0, tm = 0, cur = null, curT = 0, running = false, nLog = 0; const list = $('proc-st'), logEl = $('proc-log'), elapsed = $('proc-el'), title = $('proc-title'), radios = bar.querySelectorAll('input[name=pview]');
  const secs = () => (performance.now() - t0) / 1000, f1 = s => s.toFixed(1) + ' s', esc = x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const view = v => { st.classList.toggle('pv-proc', v === 'proc'); st.classList.toggle('pv-model', v === 'model'); radios.forEach(r => { r.checked = r.value === v; }); };
  radios.forEach(r => { r.onchange = () => view(r.value); });
  const li = k => list.querySelector(`[data-k="${k}"]`);
  const setT = (k, s, txt) => { const l = li(k); if (!l) return; l.dataset.s = s; l.querySelector('.pq').textContent = txt; if (s === 'run') l.setAttribute('aria-current', 'step'); else l.removeAttribute('aria-current'); };
  function tick() { elapsed.textContent = f1(secs()); if (cur) setT(cur, 'run', 'running ' + f1((performance.now() - curT) / 1000)); }
  function log(msg) {
    if (!running && !nLog) return; const line = `[+${secs().toFixed(1).padStart(5)} s] ${msg}`; nLog++;
    const near = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 30; logEl.textContent += (logEl.textContent ? '\n' : '') + line; if (near) logEl.scrollTop = logEl.scrollHeight;
  }
  return {
    get running() { return running; },
    show: view,   /* Train it: 'model' shows the Model view card */
    log,
    start(ttl, stages) {
      title.textContent = ttl; nLog = 0; logEl.textContent = ''; cur = null;
      list.innerHTML = stages.map((s, i) => `<li data-k="${s.k}" data-s="wait"><span class="pk">${i + 1}</span><div class="pb"><div class="pn"><span>${esc(s.name)}</span><span class="pq">waiting</span></div><p class="px">${s.text}</p></div></li>`).join('');
      bar.hidden = false; view('proc'); t0 = performance.now(); running = true; elapsed.textContent = '0.0 s'; clearInterval(tm); tm = setInterval(tick, 100); log('started');
    },
    stage(k, s, txt) {   /* s: run | done | skip | err */
      const now = performance.now();
      if (s === 'run') { if (cur && cur !== k) { setT(cur, 'done', f1((now - curT) / 1000)); } cur = k; curT = now; setT(k, 'run', 'running 0.0 s'); const l = li(k); if (l && l.scrollIntoView && st.classList.contains('pv-proc')) { /* keep the current stage in view in short windows */ const r = l.getBoundingClientRect(); if (r.top < 0 || r.bottom > innerHeight) l.scrollIntoView({ block: 'nearest' }); } }
      else { if (cur === k) cur = null; setT(k, s, txt !== undefined ? txt : f1((now - curT) / 1000)); }
    },
    note(k, html) { const l = li(k); if (l) l.querySelector('.px').innerHTML += ' ' + html; },
    finish(auto) { running = false; clearInterval(tm); if (cur) { setT(cur, 'done', f1((performance.now() - curT) / 1000)); cur = null; } elapsed.textContent = f1(secs()); title.textContent = 'Finished in ' + f1(secs()); log('finished'); if (auto) view('res'); },
    fail(msg) { running = false; clearInterval(tm); if (cur) { setT(cur, 'err', 'error'); cur = null; } elapsed.textContent = f1(secs()); title.textContent = 'Stopped after ' + f1(secs()); log('error: ' + msg); view('proc'); }
  };
})();
