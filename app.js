'use strict';
/* Demo v2 front end. All simulation / training runs in worker.js (Pyodide) on the visitor's device. */
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
/* Desktop = wide viewport and a fine pointer; ?engine=1 forces the engine on for testing on any device. */
const DESKTOP = /[?&]engine=1(&|$)/.test(location.search) || (matchMedia('(min-width: 900px)').matches && matchMedia('(pointer: fine)').matches);
const HERO_WIN = (() => { const n = document.getElementById('hero-data'); try { return JSON.parse(n.textContent).win; } catch (e) { return ''; } })();
function heroLabel(loading) { const l = $('rv-hero-label'); if (l) l.textContent = loading ? `Replaying window ${HERO_WIN} while the engine loads` : `Window ${HERO_WIN} replay`; }
function applyGate() {
  $('lmsg').textContent = 'Live engine available on desktop'; $('lbar').parentNode.style.display = 'none'; heroLabel(false);
  const gate = '<div class="gate" role="note"><h3>Runs on desktop and laptop browsers</h3><p>The live engine downloads about 30 MB and needs a few seconds of computing, so it is switched off on phones and tablets. Everything in Results works here; open ev.sagniknath.in on a computer to run it.</p></div>';
  document.querySelectorAll('#sec-run .wb, #sec-train .wb').forEach(p => { p.hidden = true; p.insertAdjacentHTML('afterend', gate); });
  const acts = document.querySelectorAll('.hero .actions a'); if (acts.length === 2) { acts[0].remove(); acts[1].classList.remove('alt'); }
}
function setChip(st, txt) { const c = $('chip'); c.dataset.s = st; $('chiptxt').textContent = txt; }
if (!DESKTOP) { applyGate(); setChip('idle', 'Not on this device'); setTChip('idle', 'Not on this device'); } else { heroLabel(true); setChip('loading', 'Loading engine 0%'); setTChip('loading', 'Loading engine'); }
let REF = null, MLREF = null, WINDOWS = [], PYV = '', readyInfo = null, progressSink = null;
const fmt = (x, d = 2) => (x === null || x === undefined || Number.isNaN(x)) ? '-' : Number(x).toFixed(d);
const pct = (a, b) => (100 * (a - b) / b);
const sgn = x => (x > 0 ? '+' : '') + x.toFixed(2).replace('-', '\u2212') + '%';

/* ---------------- worker plumbing ---------------- */
const worker = DESKTOP ? new Worker('worker.js?v=20261114e', { type: 'module' }) : null;   // phones and tablets never create the worker, so Pyodide and the data files are never requested
let nextId = 1; const pending = new Map(); let readyRes, readyRej; const ready = new Promise((a, b) => { readyRes = a; readyRej = b; });
function setBar(frac, msg) { $('lbar').style.transform = 'scaleX(' + frac.toFixed(3) + ')'; $('lmsg').textContent = readyInfo ? msg : 'Loading the engine… (first visit downloads ~30 MB)'; if (!readyInfo) setChip('loading', 'Loading engine ' + Math.round(frac * 100) + '%'); if (progressSink) progressSink(frac, msg); }
if (worker) worker.onmessage = e => {
  const m = e.data;
  if (m.type === 'progress') setBar(m.frac, m.msg);
  else if (m.type === 'ready') { readyInfo = m; WINDOWS = m.windows; PYV = m.pyodide; setBar(1, 'Engine ready · ' + m.secs.toFixed(1) + ' s on your device'); $('lbar').parentNode.style.display = 'none'; readyRes(m); initUI(); heroLabel(false); }
  else if (m.type === 'result') { const p = pending.get(m.id); if (p) { pending.delete(m.id); p.res(m); } }
  else if (m.type === 'error') { const p = pending.get(m.id); if (p) { pending.delete(m.id); p.rej(new Error(m.msg)); } else { $('lmsg').innerHTML = '<span class="err">Could not start the Python runtime: ' + m.msg + '</span>'; readyRej(new Error(m.msg)); } }
};
if (worker) worker.onerror = e => { heroLabel(false); $('lmsg').innerHTML = '<span class="err">Worker error: ' + (e.message || e) + '</span>'; };
function call(msg) { const id = nextId++; return new Promise((res, rej) => { pending.set(id, { res, rej }); worker.postMessage(Object.assign({ id }, msg)); }); }
if (DESKTOP) Promise.all([fetch('data/reference.json').then(r => r.json()), fetch('data/ml_reference.json').then(r => r.json())]).then(([a, b]) => { REF = a; MLREF = b; });
if (worker) worker.postMessage({ cmd: 'init' });
/* MATLAB check windows and traces (optional: a missing file just hides the feature) */
let MW = null, MT = null;
const getJSON = u => DESKTOP ? fetch(u).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null);
getJSON('data/matlab_windows.json?v=20261114e').then(d => { MW = d && d.windows && d.windows.length === 10 ? d : null; if (!MW) $('mmodelab').hidden = true; else fillMWin(); });
getJSON('data/matlab_traces.json?v=20261114e').then(d => { MT = d; });
function mtrace(n) {
  if (!MT) return null; const z = String(n).padStart(2, '0'), W = MT.windows || MT, d = Array.isArray(W) ? W[n - 1] : (W['w' + n] || W['w' + z] || W[n] || W[z]);
  return d && Array.isArray(d.t) && d.v_acc && d.v_mpc ? d : null;
}
function fillMWin() { const sel = $('mwin'); sel.innerHTML = ''; MW.windows.forEach((w, i) => { const o = document.createElement('option'); o.value = i; o.textContent = `Window ${w.n}: lead mean ${w.lead_mean_kmh.toFixed(0)} km/h`; sel.appendChild(o); }); sel.onchange = () => { resetStage(); preview(); }; }


/* ---------------- charts ---------------- */
const chartJobs = {};
function lineChart(el, t, series, ylabel, opt) {
  opt = opt || {}; chartJobs[el.id] = [el, t, series, ylabel, opt];
  const W = Math.max(280, Math.floor(el.clientWidth) || 640), H = opt.h || (W < 480 ? 240 : 320), m = { l: 44, r: 8, t: 8, b: 28 };
  const all = series.flatMap(s => s.y.filter(v => v !== null && Number.isFinite(v)));
  if (!all.length) { el.innerHTML = '<div class="mut lim">No data</div>'; return; }
  const mn = Math.min(0, ...all), mx = Math.max(...all) || 1, raw = (mx - mn) / 4, pw = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 2.5, 5, 10].map(k => k * pw).find(v => v >= raw) || raw, lo = Math.floor(mn / step + 1e-9) * step, hi = Math.ceil(mx / step - 1e-9) * step, nt4 = Math.round((hi - lo) / step), dec = Number.isInteger(step) ? 0 : (Math.round(step * 10) === step * 10 ? 1 : 2), T = t[t.length - 1] || 1;
  const x = v => m.l + (v / T) * (W - m.l - m.r), y = v => H - m.b - ((v - lo) / (hi - lo)) * (H - m.t - m.b);
  let g = '';
  for (let i = 0; i <= nt4; i++) { const v = lo + step * i; g += `<line class="grid-h" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${v.toFixed(dec)}</text>`; }
  const nt = W < 480 ? 3 : 5; for (let i = 0; i <= nt; i++) { const v = T * i / nt; g += `<text x="${x(v)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === nt ? 'end' : 'middle'}">${v.toFixed(0)} s</text>`; }
  const paths = series.map(s => {
    let d = '', pen = false;
    const tt = s.t || t; s.y.forEach((v, i) => { if (v === null || !Number.isFinite(v) || tt[i] === undefined) { pen = false; return; } d += (pen ? 'L' : 'M') + x(tt[i]).toFixed(1) + ' ' + y(v).toFixed(1); pen = true; });
    return `<path class="ln" d="${d}" style="stroke:${s.c};stroke-width:${s.w || 1.5}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/>`;
  });
  const lg = series.filter(s => !s.hide).map(s => `<span class="lg">${swatch(s)}${s.n}</span>`).join('');
  el.innerHTML = `${opt.labelTop ? `<div class="meta top">${ylabel}</div>` : ''}${opt.legend === false ? '' : `<div class="legend">${lg}</div>`}<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${ylabel}" data-ml="${m.l}" data-mr="${m.r}" data-w="${W}" data-t="${T}">${g}${paths.join('')}<line class="scrubl" y1="${m.t}" y2="${H - m.b}" x1="0" x2="0" style="display:none"/><rect class="hit" x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}" fill="transparent" style="touch-action:pan-y"/></svg>${opt.labelTop ? '' : `<div class="meta" style="margin-top:4px">${ylabel}</div>`}`;
  if (opt.noScrub) return;
  const sv = el.querySelector('svg[data-ml]'), hit = sv.querySelector('.hit'), send = t => window.dispatchEvent(new CustomEvent('ev:scrub', { detail: { t, src: 'chart', scope: 'run' } }));
  const move = e => { const r = hit.getBoundingClientRect(); send(Math.max(0, Math.min(T, (e.clientX - r.left) / r.width * T))); };
  hit.addEventListener('pointermove', move); hit.addEventListener('pointerdown', move); hit.addEventListener('pointerleave', () => send(null));
  if (runScrubT !== null) setScrub(sv, runScrubT);
}
let runScrubT = null;
function setScrub(sv, t) {
  const ln = sv.querySelector('.scrubl'); if (!ln) return; if (t === null) { ln.style.display = 'none'; return; }
  const ml = +sv.dataset.ml, mr = +sv.dataset.mr, W = +sv.dataset.w, T = +sv.dataset.t, x = ml + Math.min(1, t / T) * (W - ml - mr); ln.setAttribute('x1', x); ln.setAttribute('x2', x); ln.style.display = '';
}
window.addEventListener('ev:scrub', e => { const d = e.detail || {}; if (d.scope !== 'run') return; runScrubT = d.t === undefined ? null : d.t; Object.values(chartJobs).forEach(j => { const sv = j[0].querySelector('svg[data-ml]'); if (sv) setScrub(sv, runScrubT); }); });
let rzT = 0; window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(() => Object.values(chartJobs).forEach(j => { const sv = j[0].querySelector('svg'); if (sv && j[0].offsetParent && Math.abs(j[0].clientWidth - (+sv.getAttribute('width'))) > 8) lineChart(...j); }), 150); });

/* ---------------- run panel ---------------- */
function initUI() {
  $('run').disabled = false; $('train').disabled = false; setChip('idle', 'Idle'); setTChip('idle', 'Idle');
  rvRun = RoadView.create($('rv-run'), { id: 'rv-run', scope: 'run', height: 120, loop: false, speed: 10, multi: true });
  fillWindows(); $('filt').onchange = fillWindows; $('win').onchange = updWin;
}
function fillWindows() {
  const f = $('filt').value, sel = $('win'); sel.innerHTML = '';
  WINDOWS.filter(w => f === 'all' || w.group === f).forEach(w => { const o = document.createElement('option'); o.value = w.idx; o.textContent = `#${w.win}: ${w.campaign}, follower ${w.vehicle} (${w.group}), lead mean ${(w.mean_vl * 3.6).toFixed(0)} km/h`; sel.appendChild(o); });
  updWin();
}
function updWin() { const w = WINDOWS[+$('win').value]; resetStage(); $('wininfo').textContent = w ? `Window #${w.win}: 120 s of recorded lead-vehicle speed (${w.campaign} campaign). Recorded follower: ${w.vehicle}, ${w.group === 'acc' ? 'commercial ACC' : w.group === 'human' ? 'human driver' : 'mixed ACC/human'}.` : ''; preview(); }
function readMode() { return document.querySelector('input[name=mode]:checked').value; }
let pvT = 0;
['eta', 'cap'].forEach(k => $(k).oninput = () => { $(k + 'v').textContent = $(k).value; if (!hasRun && !running && readMode() === 'window') { clearTimeout(pvT); pvT = setTimeout(preview, 250); } });
$('reset').onclick = () => { $('eta').value = 0.65; $('cap').value = 35; $('etav').textContent = '0.65'; $('capv').textContent = '35'; if (!hasRun && !running && readMode() === 'window') preview(); };
document.querySelectorAll('input[name=mode]').forEach(r => r.onchange = () => { const m = readMode(); $('winbox').style.display = m === 'window' ? '' : 'none'; $('mbox').style.display = m === 'matlab' ? '' : 'none'; $('upbox').style.display = m === 'upload' ? '' : 'none'; resetStage(); preview(); });
$('file').onchange = e => { const f = e.target.files[0]; if (f) f.text().then(t => $('trace').value = t); };
$('ex').onclick = () => { const v = []; for (let t = 0; t <= 150; t++) { const c = (t % 50); v.push((c < 20 ? 8 + 0.6 * c : c < 30 ? 20 - 1.7 * (c - 20) : c < 40 ? 3 + 0.2 * (c - 30) : 5 + 0.7 * (c - 40)).toFixed(2)); } $('trace').value = v.join('\n'); $('unit').value = 'mps'; $('hz').value = '1'; };
function parseTrace() {
  const rows = $('trace').value.trim().split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^[a-zA-Z#]/.test(l)).map(l => l.split(/[,;\s]+/).filter(Boolean).map(Number));
  if (!rows.length || rows.some(r => r.some(x => !Number.isFinite(x)))) throw new Error('Could not read the trace: use numbers only (one speed per line, or time,speed).');
  if (rows[0].length >= 2) { const t = rows.map(r => r[0]), s = rows.map(r => r[1]); const dt = (t[t.length - 1] - t[0]) / (t.length - 1); const hz = Math.round(1 / dt); if (![1, 2, 5, 10].includes(hz)) throw new Error('Time column must be evenly spaced at 1, 2, 5 or 10 Hz.'); return { speeds: s, hz }; }
  return { speeds: rows.map(r => r[0]), hz: +$('hz').value };
}
function unsafeStr(o) { return o.short_max > 0.5 ? `<span class="err">yes (${o.short_max.toFixed(1)} m short)</span>` : 'no'; }
let hasRun = false, running = false, pvSeq = 0;
const RAIL_CTRL = '#sec-run .rail input, #sec-run .rail select, #sec-run .rail textarea, #sec-run .rail .alt, #sec-run .rail .linkbtn';
function lockRail(v) { document.querySelectorAll(RAIL_CTRL).forEach(e => { e.disabled = v; }); }
function resetStage() {
  $('tab-matlab').hidden = true; $('mlpanel').innerHTML = ['t1m', 't3m'].map(i => { $(i).hidden = true; return ''; }).join(''); if ($('tab-matlab').getAttribute('aria-selected') === 'true') activateTab('table', false);
  hasRun = false; $('out').style.display = 'none'; $('empty').hidden = false; $('export').disabled = true; $('queue').hidden = true; $('queue').innerHTML = ''; $('status').textContent = '';
  ['t1', 't2', 't3', 't4'].forEach(i => { $(i).textContent = '-'; }); $('t2s').textContent = 'recorded follower, same battery model'; $('t1s').textContent = 'Wh/km, MPC const-speed'; window.__lastRun = null;
  if (!running && readyInfo) setChip('idle', 'Idle');
}
async function preview() {
  const up = readMode() !== 'window'; $('rv-empty').textContent = readMode() === 'matlab' ? 'Press run. The road view shows the computed lanes for this MATLAB check window.' : 'Upload a lead-speed trace and press run. The road view shows the computed lanes.'; $('rv-empty').hidden = !up; $('rv-run').hidden = up; $('rv-cap').hidden = up; if (up || !rvRun) return;
  $('rv-cap').textContent = $('wininfo').textContent + ' Recorded data only. Press run to add the controllers.';
  /* recorded data only: the follower replay, plus the lead-speed trace (taken from the cheap tuned-ACC call; none of that controller's results is shown) */
  const seq = ++pvSeq, idx = +$('win').value; let m, l; try { m = await call({ cmd: 'runWindow', arm: 'recorded', idx, eta: +$('eta').value, cap: +$('cap').value }); if (seq !== pvSeq) return; l = await call({ cmd: 'runWindow', arm: 'acc', idx, eta: 0.65, cap: 35 }); } catch (e) { return; }
  if (seq !== pvSeq || hasRun || running) return; const tr = m.res.trace;
  rvRun.setData({ t: l.res.trace.t, lead: l.res.trace.lead, lanes: [], rec: { v: tr.v, gap: tr.gap, wh: null } }, { autoplay: false });
}
async function runSim() {
  const eta = +$('eta').value, cap = +$('cap').value, mode = readMode(), arms = ARM_ORDER.filter(a => $('arm_' + a).checked);
  const st = $('status'); st.textContent = ''; $('out').style.display = 'none';
  if (!arms.length) { st.innerHTML = '<span class="err">Pick at least one controller.</span>'; setChip('error', 'Error'); return; }
  let up = null, idx = null;
  try {
    if (mode === 'upload') { up = parseTrace(); await call({ cmd: 'checkUpload', speeds: JSON.stringify(up.speeds), hz: up.hz, unit: $('unit').value }); }
    else if (mode === 'matlab') { if (!MW) throw new Error('The MATLAB check windows could not be loaded.'); idx = +$('mwin').value; up = { speeds: MW.windows[idx].speeds.map(Math.fround), hz: MW.meta.hz }; await call({ cmd: 'checkUpload', speeds: JSON.stringify(up.speeds), hz: up.hz, unit: 'mps' }); }
    else idx = +$('win').value;
  } catch (e) { st.innerHTML = `<span class="err">${e.message.split('\n').filter(Boolean).pop()}</span>`; setChip('error', 'Error'); return; }
  running = true; hasRun = false; pvSeq++; lockRail(true); $('run').disabled = true; $('export').disabled = true; $('empty').hidden = false;
  const rows = arms.map(a => ({ k: a, name: ARMS[a].name, o: ARMS[a] })); if (mode === 'window') rows.push({ k: 'recorded', name: 'Recorded follower', o: REC });
  const q = $('queue'); q.hidden = false; q.innerHTML = rows.map(r => `<li data-k="${r.k}" data-s="wait">${swatch(r.o)}<span class="qn">${r.name}</span><span class="qt">waiting</span></li>`).join('');
  const rail = document.querySelector('#sec-run .rail'), toEnd = () => { rail.scrollTop = rail.scrollHeight; }; toEnd();
  const qs = (k, s, t) => { const li = q.querySelector(`[data-k="${k}"]`); li.dataset.s = s; li.querySelector('.qt').textContent = t; };
  const t0 = performance.now(), R = {}; let rec = null, cur = null;
  try {
    for (let i = 0; i < arms.length; i++) {
      cur = arms[i]; qs(cur, 'run', 'running'); setChip('running', `Running ${i + 1} of ${arms.length}`);
      const m = mode === 'window' ? await call({ cmd: 'runWindow', arm: cur, idx, eta, cap }) : await call({ cmd: 'runUpload', arm: cur, speeds: JSON.stringify(up.speeds), hz: up.hz, unit: mode === 'matlab' ? 'mps' : $('unit').value, eta, cap });
      R[cur] = m.res; R[cur]._secs = m.secs; qs(cur, 'done', m.secs.toFixed(1) + ' s');
    }
    if (mode === 'window') { cur = 'recorded'; qs(cur, 'run', 'running'); const m = await call({ cmd: 'runWindow', arm: 'recorded', idx, eta, cap }); rec = m.res; qs(cur, 'done', m.secs.toFixed(1) + ' s'); }
  } catch (e) { st.innerHTML = `<span class="err">${e.message.split('\n').filter(Boolean).pop()}</span>`; if (cur) qs(cur, 'err', 'error'); setChip('error', 'Error'); running = false; lockRail(false); $('run').disabled = false; return; }
  const secs = (performance.now() - t0) / 1000; st.innerHTML = `Computed on your device in <span class="ro">${secs.toFixed(1)} s</span> Nothing was sent to a server`;
  setChip('done', `Done in ${secs.toFixed(1)} s`); toEnd(); running = false; lockRail(false); $('run').disabled = false;
  render(R, rec, arms, mode, idx, eta, cap, secs);
}
$('run').onclick = runSim;
const dp3 = x => (Math.abs(x) < 0.0005 ? '0.000%' : (x > 0 ? '+' : '\u2212') + Math.abs(x).toFixed(3) + '%');
function setTiles(R, rec, mode, secs, ml) {
  const m = R.mpc_const, a = R.acc; $('t1').textContent = m ? fmt(m.whkm_adj, 1) : '-'; $('t1s').textContent = m ? 'Wh/km, MPC const-speed' : 'MPC const-speed not selected';
  if (mode !== 'window') { $('t2').textContent = 'n/a'; $('t2s').textContent = mode === 'matlab' ? 'no recording for this trace' : 'no recording for an upload'; } else { $('t2').textContent = m && rec ? sgn(pct(m.whkm_adj, rec.whkm_adj)) : '-'; $('t2s').textContent = 'recorded follower, same battery model'; }
  $('t3').textContent = m && a ? sgn(pct(m.whkm_adj, a.whkm_adj)) : '-'; $('t4').textContent = secs.toFixed(1) + ' s';
  $('t1m').hidden = $('t3m').hidden = true;
  if (ml) {   // 5th line: MATLAB's own numbers for this window (only the ACC and the MPC const-speed were ported)
    if (m && ml.mpc_const) { $('t1m').hidden = false; $('t1m').textContent = `MATLAB for this window: ${fmt(ml.mpc_const.whkm_adj, 2)} Wh/km (diff ${dp3(pct(m.whkm_adj, ml.mpc_const.whkm_adj))})`; }
    if (m && a && ml.mpc_const && ml.acc) { $('t3m').hidden = false; $('t3m').textContent = `MATLAB for this window: ${sgn(pct(ml.mpc_const.whkm_adj, ml.acc.whkm_adj))}`; }
  }
}
/* ---- tabs ---- */
const TABS = ['speed', 'gap', 'energy', 'table', 'matlab'], visTabs = () => TABS.filter(t => !$('tab-' + t).hidden);
function redrawCharts() { Object.values(chartJobs).forEach(j => { const sv = j[0].querySelector('svg'); if (sv && j[0].offsetParent && Math.abs(j[0].clientWidth - (+sv.getAttribute('width'))) > 8) lineChart(...j); }); }
function activateTab(k, focus) { TABS.forEach(t => { const on = t === k, b = $('tab-' + t); b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; $('pn-' + t).hidden = !on; }); if (focus) $('tab-' + k).focus(); redrawCharts(); }
TABS.forEach((t, i) => {
  $('tab-' + t).onclick = () => activateTab(t, false);
  $('tab-' + t).onkeydown = e => { const V = visTabs(), k = V.indexOf(t), n = V.length, j = e.key === 'ArrowRight' ? (k + 1) % n : e.key === 'ArrowLeft' ? (k + n - 1) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1; if (j >= 0) { e.preventDefault(); activateTab(V[j], true); } };
});
/* ---- CSV export (built in the browser from the last result) ---- */
const csvCell = v => { const x = String(v === null || v === undefined ? '' : v); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; };
function saveText(name, text) { const u = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })), a = document.createElement('a'); a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000); }
function exportCSV() {
  const L = window.__lastRun; if (!L) return; const { R, rec, arms, mode, idx, eta, cap } = L, r4 = x => (x === null || x === undefined || !Number.isFinite(x)) ? '' : Number(x.toFixed(4));
  const first = R[arms[0]].trace; let n = first.t.length; arms.forEach(a => { n = Math.min(n, R[a].trace.t.length); }); const hasRec = !!(rec && rec.trace && rec.trace.gap); if (hasRec) n = Math.min(n, rec.trace.v.length, rec.trace.gap.length);
  const recWh = hasRec && rec.trace.wh, head = ['t_s', 'lead_v_mps']; if (hasRec) head.push('recorded_v_mps', 'recorded_gap_m'); if (recWh) head.push('recorded_cum_wh'); arms.forEach(a => head.push(a + '_v_mps', a + '_gap_m', a + '_cum_wh'));
  const lines = [head.join(',')];
  for (let i = 0; i < n; i++) { const row = [r4(first.t[i]), r4(first.lead[i])]; if (hasRec) row.push(r4(rec.trace.v[i]), r4(rec.trace.gap[i])); if (recWh) row.push(r4(rec.trace.wh[i])); arms.forEach(a => { const tr = R[a].trace; row.push(r4(tr.v[i]), r4(tr.gap[i]), r4(tr.wh[i])); }); lines.push(row.join(',')); }
  const tl = []; document.querySelectorAll('#tbl table tr').forEach(tr => tl.push([...tr.children].map(c => csvCell(c.textContent.trim())).join(',')));
  const id = mode === 'window' ? 'window' + (WINDOWS[idx] ? WINDOWS[idx].win : idx) : mode === 'matlab' ? 'matlab_window' + (MW ? MW.windows[idx].n : idx) : 'upload', base = `ev_${id}_eta${eta}_cap${cap}`;
  saveText(base + '.csv', lines.join('\n') + '\n'); setTimeout(() => saveText(base + '_table.csv', tl.join('\n') + '\n'), 300);
}
$('export').onclick = exportCSV;
function render(R, rec, arms, mode, idx, eta, cap, secs) {
  const dflt = Math.abs(eta - 0.65) < 1e-9 && Math.abs(cap - 35) < 1e-9, stored = (mode === 'window' && dflt && REF) ? REF.windows[idx] : null;
  const isM = mode === 'matlab' && !!MW, mwin = isM ? MW.windows[idx] : null, ml = isM && dflt ? mwin.matlab : null, mt = ml ? mtrace(mwin.n) : null, fw = isM ? (x => fmt(x, 3)) : (x => fmt(x, 1));
  $('out').style.display = 'block'; $('empty').hidden = true; $('export').disabled = false; hasRun = true; setTiles(R, rec, mode, secs, ml);
  const base = R.acc ? R.acc.whkm_adj : null, recW = rec ? rec.whkm_adj : null;
  let h = '<table><tr><th>Controller</th><th>Wh/km (your browser)</th>' + (ml ? '<th>MATLAB R2024b</th><th>Web vs MATLAB</th>' : '') + (stored ? '<th>Stored Python result (paper)</th><th>Browser vs stored</th>' : '') + '<th>vs tuned ACC</th>' + (rec ? '<th>vs recorded follower</th>' : '') + '<th>Mean gap (m)</th><th>Jerk RMS</th><th>Unsafe?</th><th>Time</th></tr>';
  if (rec) h += `<tr class="hl"><td>${swatch(REC)}Recorded follower (replayed through the same battery model)</td><td>${fmt(rec.whkm_adj, 1)}</td>${stored ? `<td>${fmt(stored.recorded.whkm_adj, 1)}</td><td>${sgn(pct(rec.whkm_adj, stored.recorded.whkm_adj))}</td>` : ''}<td>${base ? sgn(pct(rec.whkm_adj, base)) : '-'}</td><td>0 (reference)</td><td>${fmt(rec.gap_mean, 1)}</td><td>${fmt(rec.jerk_rms)}</td><td>n/a</td><td>-</td></tr>`;
  arms.forEach(a => {
    const o = R[a]; let cells = `<td>${swatch(ARMS[a])} ${ARMS[a].name}</td><td>${fw(o.whkm_adj)}</td>`;
    if (ml) cells += ml[a] ? `<td>${fmt(ml[a].whkm_adj, 3)}</td><td>${dp3(pct(o.whkm_adj, ml[a].whkm_adj))}</td>` : '<td class="mut">not ported</td><td>-</td>';
    if (stored) { const s = stored[a]; cells += `<td>${fmt(s.whkm_adj, 1)}${s.short_max > 0.5 ? ' (unsafe)' : ''}</td><td>${sgn(pct(o.whkm_adj, s.whkm_adj))}</td>`; }
    cells += `<td>${base && a !== 'acc' ? sgn(pct(o.whkm_adj, base)) : (a === 'acc' ? '0 (reference)' : '-')}</td>`;
    if (rec) cells += `<td>${sgn(pct(o.whkm_adj, recW))}</td>`;
    cells += `<td>${fmt(o.gap_mean, 1)}</td><td>${fmt(o.jerk_rms)}</td><td>${unsafeStr(o)}${o.fail ? ` <span class="err">(${o.fail} solver failures)</span>` : ''}</td><td>${o._secs.toFixed(1)} s</td>`;
    h += '<tr>' + cells + '</tr>';
  });
  $('tbl').innerHTML = h + '</table>';
  const notes = [`Settings: regen efficiency ${eta}, regen cap ${cap} kW. Wh/km is battery energy with the paper's kinetic-energy end correction. Unsafe = gap shortfall above 0.5 m against the safe-gap rule 4 + 0.7 v.`];
  if (mode === 'window') notes.push(dflt ? 'The stored Python result is the number in the paper for this window (same controller code, OSQP solver for MPC, PyTorch actors for SAC). MPC rows can differ from it by up to about 0.2% because the browser uses the Clarabel solver.' : 'You changed the regen settings, so the stored paper results (computed at 0.65 / 35 kW) are not shown; the recorded follower is replayed again with your settings.');
  else if (isM) notes.push(`MATLAB check window ${mwin.n}: the 10 Hz lead-speed trace the MATLAB check used (V2V test row ${mwin.row}, not one of the 160 windows), run through this page's upload path.` + (ml ? ' MATLAB R2024b column: matlab/verify/matlab_results.csv. MATLAB ported only the tuned ACC and the MPC with constant-speed preview, so the other controllers show "not ported". Web vs MATLAB = website / MATLAB \u2212 1. Both columns are shown to 3 decimals.' : ' You changed the regen settings, so MATLAB\'s results (computed at 0.65 / 35 kW) are not shown.'));
  else notes.push(`Uploaded trace: ${(R[arms[0]].seconds_simulated).toFixed(0)} s simulated (the last 30 s of a trace give the MPC its look-ahead). This is your data, not a paper result. The oracle sees the lead car's future, so it is a ceiling, not a deployable controller.`);
  $('tnote').innerHTML = notes.join('<br>');
  const first = R[arms[0]], t = first.trace.t, S = [Object.assign({ y: first.trace.lead }, LEAD, { n: 'Lead' })], G = [], E = [];
  if (rec) { S.push(Object.assign({ y: rec.trace.v }, REC)); G.push(Object.assign({ y: rec.trace.gap }, REC, { n: 'Recorded follower (gap sensor)' })); }
  arms.forEach(a => { const tr = R[a].trace, o = ARMS[a]; S.push(Object.assign({}, o, { n: o.name, y: tr.v })); G.push(Object.assign({}, o, { n: o.name, y: tr.gap })); E.push(Object.assign({}, o, { n: o.name, y: tr.wh })); });
  if (mt) {   // MATLAB's own traces for the ACC and the MPC const-speed, dotted graphite on top of the website's lines
    arms.filter(a => a === 'acc' || a === 'mpc_const').forEach((a, i) => { const k = a === 'acc' ? 'acc' : 'mpc', o = { t: mt.t, c: 'var(--text)', w: 1.25, dash: '1.5 3', n: 'MATLAB R2024b', hide: i > 0 }; S.push(Object.assign({ y: mt['v_' + k] }, o)); G.push(Object.assign({ y: mt['gap_' + k] }, o)); E.push(Object.assign({ y: mt['E_' + k + '_Wh'] }, o)); });
  }
  runScrubT = null;
  lineChart($('c1'), t, S, 'speed, m/s'); lineChart($('c2'), t, G, 'gap to lead, m'); lineChart($('c3'), t, E, 'cumulative battery energy, Wh');
  window.__lastRun = { R, rec, arms, mode, idx, eta, cap, secs };
  $('tab-matlab').hidden = true; $('mlpanel').innerHTML = ''; if (ml && arms.some(a => a === 'acc' || a === 'mpc_const')) buildMLTab(R, arms, mwin, ml);
  activateTab('table', false);
  showRoad(R, rec, arms, t);
}
/* ---- MATLAB tab: the MATLAB-made PNG next to the website's own small speed / gap / energy charts, plus the Wh/km comparison */
function buildMLTab(R, arms, mwin, ml) {
  const n = mwin.n, Z = String(n).padStart(2, '0'), A = arms.filter(a => a === 'acc' || a === 'mpc_const'), pn = $('mlpanel'), src = `figures/matlab/traces_w${Z}.png?v=20261114e`;
  let rows = '', cap = [];
  A.forEach(a => { const o = R[a], m = ml[a]; rows += `<tr><td>${swatch(ARMS[a])} ${SHORT[a]}</td><td>${fmt(m.whkm_adj, 3)}</td><td>${fmt(o.whkm_adj, 3)}</td><td>${dp3(pct(o.whkm_adj, m.whkm_adj))}</td></tr>`; cap.push(`${SHORT[a]} ${fmt(m.whkm_adj, 3)} (MATLAB) and ${fmt(o.whkm_adj, 3)} (website) Wh/km`); });
  pn.innerHTML = `<div class="mlp"><figure class="mlfig"><button type="button" class="gal-b ml-b" id="mlimg-b" aria-label="Enlarge the MATLAB figure for window ${n}"><img id="mlimg" src="${src}" alt="MATLAB R2024b figure for window ${n}: lead and follower speed, gap and cumulative energy for the ACC and the MPC"></button><figcaption>Made by MATLAB R2024b (make_site_traces.m, exportgraphics) from its own simulation of window ${n}. Click to enlarge.</figcaption></figure>` +
    `<div class="mlside"><div class="mlh">This website, same window</div><div id="cm1" class="chartbox chart"></div><div id="cm2" class="chartbox chart"></div><div id="cm3" class="chartbox chart"></div></div></div>` +
    `<div class="tw"><table class="mlt"><tr><th>Controller</th><th>MATLAB Wh/km</th><th>Website Wh/km</th><th>Website vs MATLAB</th></tr>${rows}</table></div><div class="lim mut" style="margin-top:8px">Window ${n}: ${cap.join('; ')}. The dotted lines in the Speed, Gap and Energy tabs are MATLAB's own traces of this window.</div>`;
  const img = $('mlimg'), b = $('mlimg-b');
  img.onerror = () => { b.outerHTML = `<div class="rv-empty" style="min-height:120px">The MATLAB figure for window ${n} is not available.</div>`; };
  b.onclick = () => EVLB.open([{ src: img.currentSrc || img.src, alt: img.alt, cap: `MATLAB R2024b figure for window ${n}. ${cap.join('; ')}.` }], 0);
  const tr = R[A[0]].trace, W = (key, k) => A.map(a => Object.assign({}, ARMS[a], { n: SHORT[a], y: R[a].trace[key] })), o3 = { h: 150, noScrub: true, labelTop: true };
  lineChart($('cm1'), tr.t, [Object.assign({ y: tr.lead }, LEAD, { n: 'Lead' })].concat(W('v')), 'speed, m/s', Object.assign({}, o3, { legend: true }));
  lineChart($('cm2'), tr.t, W('gap'), 'gap to lead, m', Object.assign({}, o3, { legend: false }));
  lineChart($('cm3'), tr.t, W('wh'), 'cumulative battery energy, Wh', Object.assign({}, o3, { legend: false }));
  $('tab-matlab').hidden = false;
}
let rvRun = null;
function showRoad(R, rec, arms, t) {
  if (!window.RoadView || !rvRun) return;
  $('rv-empty').hidden = true; $('rv-run').hidden = false; $('rv-cap').hidden = false;
  $('rv-cap').textContent = 'Schematic replay of the computed window: positions come from the simulated speeds and gaps, and cars are drawn at 4.5 m.' + (rec ? ' The outline car is the recorded follower.' : '') + ' The cursor in the charts follows the replay.';
  rvRun.setData({ t, lead: R[arms[0]].trace.lead, lanes: arms.map(a => ({ id: a, name: ARMS[a].name, short: SHORT[a], accent: a === 'mpc_const', v: R[a].trace.v, gap: R[a].trace.gap, wh: R[a].trace.wh || null })), rec: rec ? { v: rec.trace.v, gap: rec.trace.gap, wh: rec.trace.wh || null } : null }, { autoplay: true });
}

/* ---------------- train panel (workbench: rail, tiles, tabs) ---------------- */
$('size').oninput = updSize; function updSize() { const n = SIZES[+$('size').value]; $('sizev').textContent = n ? `About ${n.toLocaleString()} samples (whole trips)` : 'All training samples (about 165,000, 54 trips)'; } updSize();
progressSink = null;
const TNAMES = { ridge: 'Ridge', knn: 'KNN (k=25, 70k-row subsample)', svr: 'SVR (RBF, 8k subset)', lgbm: 'LightGBM (400 trees)' }, TSHORT = { ridge: 'Ridge', knn: 'KNN', svr: 'SVR', lgbm: 'LightGBM' }, TMODE = { resid: 'physics + ML residual', pure: 'pure ML (no physics)' };
const TTABS = ['imp', 'curve', 'table', 'runs'], RUNS = []; let mlSeen = false, bmwSeen = false, tRunning = false, tLast = null;
function setTChip(st, txt) { const c = $('tchip'); c.dataset.s = st; $('tchiptxt').textContent = txt; }
const TRAIN_CTRL = '#trainwb .rail input, #trainwb .rail select, #trainwb .rail .alt';
function lockTrain(v) { document.querySelectorAll(TRAIN_CTRL).forEach(e => { e.disabled = v; }); }
function activateTTab(k, focus) { TTABS.forEach(t => { const on = t === k, b = $('ttab-' + t); b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; $('tpn-' + t).hidden = !on; }); if (focus) $('ttab-' + k).focus(); if (k === 'curve' && tLast) drawCurve(); }
TTABS.forEach((t, i) => {
  $('ttab-' + t).onclick = () => activateTTab(t, false);
  $('ttab-' + t).onkeydown = e => { const j = e.key === 'ArrowRight' ? (i + 1) % 4 : e.key === 'ArrowLeft' ? (i + 3) % 4 : e.key === 'Home' ? 0 : e.key === 'End' ? 3 : -1; if (j >= 0) { e.preventDefault(); activateTTab(TTABS[j], true); } };
});
function resetTiles() { ['tt1', 'tt2', 'tt3', 'tt4'].forEach(i => { $(i).textContent = '-'; }); $('tt1s').textContent = 'kW, fold 0 (14 unseen trips)'; $('tt2s').textContent = 'median absolute, over the 14 held-out trips'; $('tt3s').textContent = 'kW, fold 0 (from the paper\'s stored results)'; $('tt4s').textContent = 'seconds, nothing sent to a server'; }
function tSteps(imp) {
  const rows = [['pk', 'Load ML packages'], ['dt', 'Load BMW i3 data'], ['fit', 'Train the model'], ['ev', imp ? 'Test + importance' : 'Test on fold 0']];
  $('tqueue').innerHTML = rows.map((r, i) => `<li data-k="${r[0]}" data-s="wait"><span class="qk">${i + 1}</span><span class="qn">${r[1]}</span><span class="qt">waiting</span></li>`).join('');
}
const tq = (k, s, t) => { const li = $('tqueue').querySelector(`[data-k="${k}"]`); if (li) { li.dataset.s = s; li.querySelector('.qt').textContent = t; } };
async function runTrain() {
  const model = $('model').value, mode = $('tmode').value, n = SIZES[+$('size').value], imp = $('imp').checked, st = $('tstatus');
  tRunning = true; lockTrain(true); $('train').disabled = true; $('texport').disabled = true; st.textContent = ''; resetTiles(); tSteps(imp); tLast = null;
  $('tout').style.display = 'none'; $('tempty').hidden = false; $('tempty-p').textContent = 'Training in your browser. The result appears here when it finishes.';
  const rail = document.querySelector('#trainwb .rail'); rail.scrollTop = rail.scrollHeight;
  const t0 = performance.now(); let cur = null, curT = t0; const durs = {};
  const phase = (k, chip) => { const now = performance.now(); if (cur) { durs[cur] = (now - curT) / 1000; tq(cur, 'done', durs[cur].toFixed(1) + ' s'); } cur = k; curT = now; if (k) { tq(k, 'run', 'running'); setTChip(chip[0], chip[1]); } };
  if (mlSeen) tq('pk', 'done', 'cached'); if (bmwSeen) tq('dt', 'done', 'cached');
  progressSink = (f, m) => { if (/^Loading scikit/.test(m)) phase('pk', ['loading', 'Loading ML packages']); else if (/^Loading BMW/.test(m)) phase('dt', ['loading', 'Loading BMW i3 data']); else if (/^Training/.test(m)) phase('fit', ['running', 'Training']); };
  setTChip('running', 'Starting');
  try {
    const m = await call({ cmd: 'train', model, mode, n_target: n, importance: imp }), r = m.res, now = performance.now();
    if (cur) { durs[cur] = (now - curT) / 1000; }
    /* the worker runs fit, test and importance inside one Python call; it reports train_s (fit) and total_s (fit + test + importance), so those two rows get the worker's own numbers */
    tq('pk', 'done', durs.pk !== undefined ? durs.pk.toFixed(1) + ' s' : 'cached'); tq('dt', 'done', durs.dt !== undefined ? durs.dt.toFixed(1) + ' s' : 'cached');
    tq('fit', 'done', r.train_s.toFixed(1) + ' s'); tq('ev', 'done', Math.max(0, r.total_s - r.train_s).toFixed(1) + ' s');
    mlSeen = true; bmwSeen = true; const secs = (now - t0) / 1000;
    st.innerHTML = `Computed on your device in <span class="ro">${secs.toFixed(1)} s</span> Nothing was sent to a server`; setTChip('done', `Done in ${secs.toFixed(1)} s`);
    renderTrain(r, model, mode, n, secs, imp);
  } catch (e) { st.innerHTML = `<span class="err">${e.message.split('\n').filter(Boolean).pop()}</span>`; if (cur) tq(cur, 'err', 'error'); setTChip('error', 'Error'); $('tempty-p').textContent = 'The run did not finish. See the message under the steps in the settings.'; }
  progressSink = null; tRunning = false; lockTrain(false); $('train').disabled = false; $('texport').disabled = RUNS.length === 0; rail.scrollTop = rail.scrollHeight;
}
$('train').onclick = runTrain;
function paperRef(model, mode, n) {
  if (!MLREF) return null; const key = model + '_' + mode;
  if (n === 0 && MLREF.rmse_fold0[key]) return { kind: 'full', ...MLREF.rmse_fold0[key] };
  if (model === 'lgbm' && MLREF.curve_fold0_rep0[mode] && MLREF.curve_fold0_rep0[mode][String(n)]) { const c = MLREF.curve_fold0_rep0[mode][String(n)]; return { kind: 'curve', rmse_kw: c.rmse_kw, n_train: c.n_train, n_trips: c.n_trips, source: 'results/ml/learning_curve_*.csv, fold 0, draw 0' }; }
  return null;
}
const dpct = (a, b) => { const d = pct(a, b); return Math.abs(d) < 0.005 ? '0.00%' : sgn(d); };
function renderTrain(r, model, mode, n, secs, imp) {
  const p = paperRef(model, mode, n), key = model + '_' + mode, ph = MLREF && MLREF.rmse_fold0.physics_resid;
  RUNS.push({ k: RUNS.length + 1, model, mode, n, r, p, secs, imp }); tLast = { r, model, mode, n, p, key };
  $('tout').style.display = 'block'; $('tempty').hidden = true;
  /* tiles */
  $('tt1').textContent = r.rmse_kw.toFixed(3); $('tt1s').textContent = `kW, fold 0, ${r.n_test.toLocaleString()} samples`;
  $('tt2').textContent = r.trip_med_abs.toFixed(2) + '%'; $('tt2s').textContent = `median absolute over the 14 held-out trips; pooled ${sgn(r.pooled_err)}`;
  if (p) { $('tt3').textContent = p.rmse_kw.toFixed(3); $('tt3s').textContent = `kW, paper, same model, target and size; yours ${dpct(r.rmse_kw, p.rmse_kw)}`; } else { $('tt3').textContent = '-'; $('tt3s').textContent = 'the paper has no stored value for this setting'; }
  $('tt4').textContent = secs.toFixed(1) + ' s'; $('tt4s').textContent = `model fit ${r.train_s.toFixed(1)} s; ${(r.total_s - r.train_s).toFixed(1)} s test` + (imp ? ' + importance' : '');
  /* table: every metric the worker returns, yours vs paper */
  const dash = '-', ptxt = p ? '' : 'no stored paper number for this setting', te = r.trip_err.slice().sort((a, b) => a - b), full = p && p.kind === 'full';
  let h = '<table style="min-width:0"><tr><th></th><th>Your browser</th><th>Paper (fold 0)</th><th>Yours vs paper</th></tr>';
  h += `<tr><td>Model, target</td><td colspan="3" style="text-align:left">${TNAMES[model]}, ${TMODE[mode]}</td></tr>`;
  h += `<tr><td>Training samples / trips</td><td>${r.n_train.toLocaleString()} / ${r.n_trips}</td><td>${p && p.n_train ? p.n_train.toLocaleString() + ' / ' + p.n_trips : (p ? 'all 4 other folds' : dash)}</td><td></td></tr>`;
  h += `<tr><td>Held-out samples (fold 0)</td><td>${r.n_test.toLocaleString()}</td><td>${dash}</td><td></td></tr>`;
  h += `<tr class="hl"><td>Held-out power RMSE (kW)</td><td><strong>${r.rmse_kw.toFixed(3)}</strong></td><td>${p ? p.rmse_kw.toFixed(3) : ptxt}</td><td>${p ? dpct(r.rmse_kw, p.rmse_kw) : dash}</td></tr>`;
  h += `<tr><td>MAE (kW)</td><td>${r.mae_kw.toFixed(3)}</td><td>${full ? p.mae_kw.toFixed(3) : dash}</td><td>${full ? dpct(r.mae_kw, p.mae_kw) : dash}</td></tr>`;
  h += `<tr><td>R2</td><td>${r.r2.toFixed(4)}</td><td>${full ? p.r2.toFixed(4) : dash}</td><td>${dash}</td></tr>`;
  h += `<tr><td>Trip-energy error: median |error| over 14 trips</td><td>${r.trip_med_abs.toFixed(2)}%</td><td>${full ? p.trip_med_abs.toFixed(2) + '%' : dash}</td><td>${dash}</td></tr>`;
  h += `<tr><td>Trip-energy error: pooled over all 14 trips</td><td>${sgn(r.pooled_err)}</td><td>${full ? sgn(p.pooled_err) : dash}</td><td>${dash}</td></tr>`;
  h += `<tr><td>Trip-energy error per trip (sorted, %)</td><td colspan="3" class="mono" style="text-align:left;white-space:normal">${te.map(x => (x > 0 ? '+' : '') + x.toFixed(1).replace('-', '−')).join('&ensp;')}</td></tr>`;
  h += `<tr><td>Model fit time (s)</td><td>${r.train_s.toFixed(1)}</td><td>${dash}</td><td></td></tr><tr><td>Fit + test${imp ? ' + importance' : ''} (s, worker)</td><td>${r.total_s.toFixed(1)}</td><td>${dash}</td><td></td></tr>`;
  if (ph) h += `<tr><td>For reference: physics model alone, RMSE (kW)</td><td>${dash}</td><td>${ph.rmse_kw.toFixed(3)}</td><td></td></tr>`;
  $('tres').innerHTML = h + '</table>';
  $('tnote2').textContent = full || !p ? 'Per-trip errors are the energy error of each of the 14 held-out trips (predicted minus measured, as % of measured).' : 'Paper value for this size comes from the learning-curve run (fold 0, first draw of trips); only the RMSE is stored for it.';
  /* importance tab */
  if (r.importance) {
    const pi = MLREF && MLREF.importance_fold0[key], names2 = Object.keys(r.importance).sort((a, b) => r.importance[b] - r.importance[a]), mx = Math.max(0.01, ...names2.map(k => Math.max(r.importance[k], pi && pi[k] !== undefined ? pi[k] : 0)));
    let b = `<div class="lim mut" style="margin-bottom:12px">Increase in held-out power RMSE (kW) when one input group is shuffled (grouped permutation importance; fold 0; ${model === 'lgbm' ? 'all held-out rows, 3 repeats' : '5,000 held-out rows, 2 repeats'}; baseline RMSE on those rows ${r.importance_base_rmse_kw.toFixed(3)} kW). Thick bar = your run, the top input in teal; thin bar = paper's stored fold-0 value${pi ? ' (full training data)' : ' (not stored for this model)'}.${pi && n !== 0 ? ' The paper values are for all training data, yours used less.' : ''}</div>`;
    names2.forEach((k, ri) => { const v = r.importance[k], w = pi && pi[k] !== undefined ? pi[k] : null; b += `<div class="imp"><div>${k}</div><div><div class="br"><div class="bt"><div class="b b1${ri === 0 ? ' top' : ''}" style="width:${Math.max(0, 100 * v / mx)}%"></div></div><span class="v">${v.toFixed(3)}</span></div>${w !== null ? `<div class="br"><div class="bt"><div class="b b2" style="width:${Math.max(0, 100 * w / mx)}%"></div></div><span class="v">${w.toFixed(3)}</span></div>` : ''}</div></div>`; });
    $('timp').innerHTML = b;
  } else $('timp').innerHTML = '<div class="empty" style="padding:24px 8px">Importance was not computed for this run. Tick the box in the settings and train again.</div>';
  /* runs tab */
  const best = Math.min(...RUNS.map(x => x.r.rmse_kw));
  let rh = '<table style="min-width:0"><tr><th>#</th><th>Model</th><th>Target</th><th>Training samples / trips</th><th>Power RMSE (kW)</th><th>Paper (kW)</th><th>Trip-energy error, median |e|</th><th>Pooled</th><th>Time (s)</th></tr>';
  RUNS.forEach(x => { rh += `<tr${x === RUNS[RUNS.length - 1] ? ' class="hl"' : ''}><td>${x.k}</td><td>${TSHORT[x.model]}</td><td>${x.mode === 'resid' ? 'physics + residual' : 'pure ML'}</td><td>${x.r.n_train.toLocaleString()} / ${x.r.n_trips}</td><td>${x.r.rmse_kw === best ? '<strong>' + x.r.rmse_kw.toFixed(3) + '</strong>' : x.r.rmse_kw.toFixed(3)}</td><td>${x.p ? x.p.rmse_kw.toFixed(3) : dash}</td><td>${x.r.trip_med_abs.toFixed(2)}%</td><td>${sgn(x.r.pooled_err)}</td><td>${x.secs.toFixed(1)}</td></tr>`; });
  $('truns').innerHTML = rh + '</table>'; $('texport').disabled = false;
  activateTTab('table', false); window.__lastTrain = r;
}
function drawCurve() {
  const el = $('tcurve'), L = tLast; if (!L || !MLREF) return; const { r, model, mode, n } = L;
  const paper = model === 'lgbm' && MLREF.curve_fold0_rep0[mode] ? Object.values(MLREF.curve_fold0_rep0[mode]).map(c => ({ x: c.n_train, y: c.rmse_kw, trips: c.n_trips })).sort((a, b) => a.x - b.x) : [];
  const fullP = MLREF.rmse_fold0[model + '_' + mode], mine = RUNS.filter(x => x.model === model && x.mode === mode).map(x => ({ x: x.r.n_train, y: x.r.rmse_kw, cur: x === RUNS[RUNS.length - 1] }));
  const pts = [...paper, ...mine]; if (fullP && !paper.length) pts.push({ x: 164902, y: fullP.rmse_kw });
  const W = Math.max(300, Math.floor(el.clientWidth) || 640), H = W < 480 ? 260 : 320, m = { l: 48, r: 16, t: 12, b: 48 };
  const ys = pts.map(q => q.y), xs = pts.map(q => q.x), ymn = Math.min(...ys), ymx = Math.max(...ys), pad = (ymx - ymn || 0.5) * 0.15, lo0 = ymn - pad, hi0 = ymx + pad, raw = (hi0 - lo0) / 4, pw = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 2.5, 5, 10].map(k => k * pw).find(v => v >= raw) || raw, lo = Math.floor(lo0 / step) * step, hi = Math.ceil(hi0 / step) * step, dec = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  const x0 = 0, x1 = Math.max(170000, ...xs) * 1.02, X = v => m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r), Y = v => H - m.b - (v - lo) / (hi - lo) * (H - m.t - m.b);
  let g = ''; for (let v = lo; v <= hi + 1e-9; v += step) g += `<line class="grid-h" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 8}" y="${Y(v) + 4}" text-anchor="end">${v.toFixed(Math.max(dec, 1))}</text>`;
  for (let v = 0; v <= 160000; v += 40000) g += `<text x="${X(v)}" y="${H - 26}" text-anchor="${v === 0 ? 'start' : 'middle'}">${v / 1000}k</text>`;
  g += `<text x="${(m.l + W - m.r) / 2}" y="${H - 8}" text-anchor="middle">training samples</text>`;
  let line = ''; if (paper.length) { line = `<path class="ln" d="${paper.map((q, i) => (i ? 'L' : 'M') + X(q.x).toFixed(1) + ' ' + Y(q.y).toFixed(1)).join('')}" style="stroke:var(--text3);stroke-width:1.5"/>` + paper.map(q => `<circle cx="${X(q.x)}" cy="${Y(q.y)}" r="3.5" style="fill:var(--card);stroke:var(--text3);stroke-width:1.5"><title>Paper: ${q.y.toFixed(3)} kW at ${q.x.toLocaleString()} samples (${q.trips} trips)</title></circle>`).join(''); }
  else if (fullP) line = `<circle cx="${X(164902)}" cy="${Y(fullP.rmse_kw)}" r="3.5" style="fill:var(--card);stroke:var(--text3);stroke-width:1.5"><title>Paper: ${fullP.rmse_kw.toFixed(3)} kW at all training data</title></circle>`;
  const dots = mine.filter(q => !q.cur).map(q => `<circle cx="${X(q.x)}" cy="${Y(q.y)}" r="4" style="fill:var(--text2);fill-opacity:.6"><title>Earlier run of yours: ${q.y.toFixed(3)} kW at ${q.x.toLocaleString()} samples</title></circle>`).join('');
  const cur = mine.find(q => q.cur), me = `<circle cx="${X(cur.x)}" cy="${Y(cur.y)}" r="6" style="fill:var(--accent);stroke:var(--card);stroke-width:2"><title>Your run: ${cur.y.toFixed(3)} kW at ${cur.x.toLocaleString()} samples</title></circle>`;
  const lg = `<span class="lg"><svg class="sw" viewBox="0 0 24 8" aria-hidden="true"><circle cx="12" cy="4" r="3.5" style="fill:var(--accent)"/></svg>Your run</span>` + (mine.length > 1 ? `<span class="lg"><svg class="sw" viewBox="0 0 24 8" aria-hidden="true"><circle cx="12" cy="4" r="3.5" style="fill:var(--text2);fill-opacity:.6"/></svg>Your earlier runs, same model and target</span>` : '') + `<span class="lg"><svg class="sw" viewBox="0 0 24 8" aria-hidden="true"><line x1="0" x2="24" y1="4" y2="4" style="stroke:var(--text3);stroke-width:1.5"/><circle cx="12" cy="4" r="2.5" style="fill:var(--card);stroke:var(--text3);stroke-width:1.5"/></svg>Paper${paper.length ? ' learning curve' : ' (all training data)'}</span>`;
  el.innerHTML = `<div class="legend">${lg}</div><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="Held-out power RMSE against number of training samples, your run and the paper">${g}${line}${dots}${me}</svg><div class="meta" style="margin-top:4px">held-out power RMSE (kW), lower is better</div>`;
  $('tcurvenote').textContent = paper.length ? `Paper curve: ${TNAMES[model]}, ${TMODE[mode]}, fold 0, first draw of whole trips at each size (5 sizes). Your run is trained on the same folds, so it should land on or near the curve at its size.` : `The paper's learning curve was measured for LightGBM only. For ${TSHORT[model]} the paper has ${fullP ? 'one stored fold-0 value, at all training data (hollow point)' : 'no stored value for this target'}.`;
}
window.addEventListener('resize', () => { if (tLast && !$('tpn-curve').hidden) drawCurve(); });
function exportRuns() {
  if (!RUNS.length) return; const head = ['run', 'model', 'target', 'size_setting', 'n_train', 'n_trips', 'n_test', 'rmse_kw', 'mae_kw', 'r2', 'trip_energy_median_abs_err_pct', 'trip_energy_pooled_err_pct', 'fit_s', 'fit_test_importance_s', 'wall_s', 'importance_computed', 'paper_rmse_kw'], lines = [head.join(',')];
  RUNS.forEach(x => { const r = x.r; lines.push([x.k, x.model, x.mode, x.n === 0 ? 'all' : x.n, r.n_train, r.n_trips, r.n_test, r.rmse_kw, r.mae_kw, r.r2, r.trip_med_abs, r.pooled_err, r.train_s, r.total_s, x.secs, x.imp ? 'yes' : 'no', x.p ? x.p.rmse_kw : ''].map(csvCell).join(',')); });
  saveText('ev_train_runs.csv', lines.join('\n') + '\n');
}
$('texport').onclick = exportRuns;
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

/* ---------------- Code section: file browser with a small built-in highlighter ---------------- */
(function () {
  const root = $('cv'); if (!root) return; const V = root.dataset.v, btns = [...root.querySelectorAll('.cv-f')], body = $('cv-body'), cache = {}; let cur = null, copyT = 0;
  const KW = {
    python: 'and as assert break class continue def del elif else except finally for from global if import in is lambda None nonlocal not or pass raise return try while with yield True False',
    matlab: 'break case catch classdef continue else elseif end for function global if otherwise parfor persistent return switch try while true false',
    js: 'async await break case catch class const continue default delete do else export finally for from function if import in instanceof let new null of return switch this throw true false try typeof undefined var void while yield'
  };
  const esc = x => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function tokenize(src, lang) {
    const kw = new Set(KW[lang].split(' ')), out = [], n = src.length, isId = c => c !== undefined && /[A-Za-z0-9_]/.test(c), NUM = /(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y, ID = /[A-Za-z_]\w*/y; let i = 0, plain = '';
    const flush = () => { if (plain) { out.push(['', plain]); plain = ''; } }, push = (c, t) => { flush(); out.push([c, t]); }, eol = j => { const k = src.indexOf('\n', j); return k < 0 ? n : k; };
    while (i < n) {
      const ch = src[i], prev = src[i - 1];
      if ((lang === 'python' && ch === '#') || (lang === 'matlab' && (ch === '%' || src.startsWith('...', i))) || (lang === 'js' && src.startsWith('//', i))) { const j = eol(i); push('c', src.slice(i, j)); i = j; continue; }
      if (lang === 'js' && src.startsWith('/*', i)) { let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; push('c', src.slice(i, j)); i = j; continue; }
      if (lang === 'python' && (src.startsWith('"""', i) || src.startsWith("'''", i))) { const q = src.substr(i, 3); let j = src.indexOf(q, i + 3); j = j < 0 ? n : j + 3; push('s', src.slice(i, j)); i = j; continue; }
      if (ch === '"' || (ch === "'" && !(lang === 'matlab' && (isId(prev) || ')]}.\''.includes(prev || ' ')))) || (lang === 'js' && ch === '`')) {
        let j = i + 1; const multi = lang === 'js' && ch === '`';
        while (j < n) { const c = src[j]; if (c === '\n' && !multi) break; if (lang !== 'matlab' && c === '\\') { j += 2; continue; } if (c === ch) { if (lang === 'matlab' && src[j + 1] === ch) { j += 2; continue; } j++; break; } j++; }
        push('s', src.slice(i, j)); i = j; continue;
      }
      if (!isId(prev) && (/\d/.test(ch) || (ch === '.' && /\d/.test(src[i + 1] || '')))) { NUM.lastIndex = i; const m = NUM.exec(src); if (m) { push('n', m[0]); i += m[0].length; continue; } }
      if (/[A-Za-z_]/.test(ch)) { ID.lastIndex = i; const m = ID.exec(src)[0]; if (kw.has(m)) push('k', m); else plain += m; i += m.length; continue; }
      plain += ch; i++;
    }
    flush(); return out;
  }
  function highlight(src, lang) {
    const lines = ['']; tokenize(src, lang).forEach(([c, t]) => { t.split('\n').forEach((piece, k) => { if (k) lines.push(''); if (piece) lines[lines.length - 1] += c ? `<span class="tk-${c}">${esc(piece)}</span>` : esc(piece); }); });
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop(); return lines;
  }
  async function open(btn) {
    const path = btn.dataset.path, name = btn.dataset.name; cur = btn; btns.forEach(b => b.setAttribute('aria-current', b === btn ? 'true' : 'false'));
    $('cv-fn').textContent = name; $('cv-meta').textContent = `${btn.dataset.lines} lines, ${(+btn.dataset.bytes / 1024).toFixed(1)} KB`; $('cv-desc').textContent = btn.dataset.desc; $('cv-copy').disabled = $('cv-dl').disabled = true;
    body.setAttribute('aria-label', 'Source of ' + name); body.setAttribute('aria-busy', 'true');
    try {
      if (cache[path] === undefined) { body.innerHTML = '<div class="cv-empty">Loading...</div>'; const r = await fetch(path + '?v=' + V); if (!r.ok) throw new Error(r.status); cache[path] = await r.text(); }
      if (cur !== btn) return; const lines = highlight(cache[path], btn.dataset.lang);
      body.innerHTML = `<div class="cv-in"><div class="cv-gut" aria-hidden="true">${lines.map((_, i) => i + 1).join('\n')}</div><pre class="cv-code"><code>${lines.join('\n')}</code></pre></div>`; body.scrollTop = 0; body.scrollLeft = 0; $('cv-copy').disabled = $('cv-dl').disabled = false;
    } catch (e) { if (cur === btn) body.innerHTML = '<div class="cv-empty err">Could not load this file. Open it in the repository instead.</div>'; }
    body.removeAttribute('aria-busy');
  }
  btns.forEach((b, i) => { b.setAttribute('aria-current', 'false'); b.onclick = () => open(b); b.onkeydown = e => { const j = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : -1; if (j >= 0 && j < btns.length) { e.preventDefault(); btns[j].focus(); } }; });
  $('cv-copy').onclick = async () => {
    const t = cache[cur.dataset.path]; if (t === undefined) return; try { await navigator.clipboard.writeText(t); } catch (e) { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e2) {} ta.remove(); }
    $('cv-copy').textContent = 'Copied'; clearTimeout(copyT); copyT = setTimeout(() => { $('cv-copy').textContent = 'Copy'; }, 1600);
  };
  $('cv-dl').onclick = () => { const t = cache[cur.dataset.path]; if (t === undefined) return; const u = URL.createObjectURL(new Blob([t], { type: 'text/plain;charset=utf-8' })), a = document.createElement('a'); a.href = u; a.download = cur.dataset.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000); };
  if (btns.length && 'IntersectionObserver' in window) { const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); if (!cur) open(btns[0]); } }, { rootMargin: '200px' }); io.observe(root); }
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
