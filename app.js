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
  document.querySelectorAll('#sec-run .wb, #sec-train .panel').forEach(p => { p.hidden = true; p.insertAdjacentHTML('afterend', gate); });
  const acts = document.querySelectorAll('.hero .actions a'); if (acts.length === 2) { acts[0].remove(); acts[1].classList.remove('alt'); }
}
function setChip(st, txt) { const c = $('chip'); c.dataset.s = st; $('chiptxt').textContent = txt; }
if (!DESKTOP) { applyGate(); setChip('idle', 'Not on this device'); } else { heroLabel(true); setChip('loading', 'Loading engine 0%'); }
let REF = null, MLREF = null, WINDOWS = [], PYV = '', readyInfo = null, progressSink = null;
const fmt = (x, d = 2) => (x === null || x === undefined || Number.isNaN(x)) ? '-' : Number(x).toFixed(d);
const pct = (a, b) => (100 * (a - b) / b);
const sgn = x => (x > 0 ? '+' : '') + x.toFixed(2).replace('-', '\u2212') + '%';

/* ---------------- worker plumbing ---------------- */
const worker = DESKTOP ? new Worker('worker.js?v=20261114c', { type: 'module' }) : null;   // phones and tablets never create the worker, so Pyodide and the data files are never requested
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

/* ---------------- charts ---------------- */
const chartJobs = {};
function lineChart(el, t, series, ylabel) {
  chartJobs[el.id] = [el, t, series, ylabel];
  const W = Math.max(280, Math.floor(el.clientWidth) || 640), H = W < 480 ? 240 : 320, m = { l: 44, r: 8, t: 8, b: 28 };
  const all = series.flatMap(s => s.y.filter(v => v !== null && Number.isFinite(v)));
  if (!all.length) { el.innerHTML = '<div class="mut lim">No data</div>'; return; }
  const mn = Math.min(0, ...all), mx = Math.max(...all) || 1, raw = (mx - mn) / 4, pw = Math.pow(10, Math.floor(Math.log10(raw))), step = [1, 2, 2.5, 5, 10].map(k => k * pw).find(v => v >= raw) || raw, lo = Math.floor(mn / step + 1e-9) * step, hi = Math.ceil(mx / step - 1e-9) * step, nt4 = Math.round((hi - lo) / step), dec = Number.isInteger(step) ? 0 : (Math.round(step * 10) === step * 10 ? 1 : 2), T = t[t.length - 1] || 1;
  const x = v => m.l + (v / T) * (W - m.l - m.r), y = v => H - m.b - ((v - lo) / (hi - lo)) * (H - m.t - m.b);
  let g = '';
  for (let i = 0; i <= nt4; i++) { const v = lo + step * i; g += `<line class="grid-h" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 8}" y="${y(v) + 4}" text-anchor="end">${v.toFixed(dec)}</text>`; }
  const nt = W < 480 ? 3 : 5; for (let i = 0; i <= nt; i++) { const v = T * i / nt; g += `<text x="${x(v)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === nt ? 'end' : 'middle'}">${v.toFixed(0)} s</text>`; }
  const paths = series.map(s => {
    let d = '', pen = false;
    s.y.forEach((v, i) => { if (v === null || !Number.isFinite(v)) { pen = false; return; } d += (pen ? 'L' : 'M') + x(t[i]).toFixed(1) + ' ' + y(v).toFixed(1); pen = true; });
    return `<path class="ln" d="${d}" style="stroke:${s.c};stroke-width:${s.w || 1.5}" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/>`;
  });
  const lg = series.map(s => `<span class="lg">${swatch(s)}${s.n}</span>`).join('');
  el.innerHTML = `<div class="legend">${lg}</div><svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${ylabel}" data-ml="${m.l}" data-mr="${m.r}" data-w="${W}" data-t="${T}">${g}${paths.join('')}<line class="scrubl" y1="${m.t}" y2="${H - m.b}" x1="0" x2="0" style="display:none"/><rect class="hit" x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}" fill="transparent" style="touch-action:pan-y"/></svg><div class="meta" style="margin-top:4px">${ylabel}</div>`;
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
  $('run').disabled = false; $('train').disabled = false; setChip('idle', 'Idle');
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
document.querySelectorAll('input[name=mode]').forEach(r => r.onchange = () => { const w = readMode() === 'window'; $('winbox').style.display = w ? '' : 'none'; $('upbox').style.display = w ? 'none' : ''; resetStage(); preview(); });
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
const RAIL_CTRL = '.rail input, .rail select, .rail textarea, .rail .alt, .rail .linkbtn';
function lockRail(v) { document.querySelectorAll(RAIL_CTRL).forEach(e => { e.disabled = v; }); }
function resetStage() {
  hasRun = false; $('out').style.display = 'none'; $('empty').hidden = false; $('export').disabled = true; $('queue').hidden = true; $('queue').innerHTML = ''; $('status').textContent = '';
  ['t1', 't2', 't3', 't4'].forEach(i => { $(i).textContent = '-'; }); $('t2s').textContent = 'recorded follower, same battery model'; $('t1s').textContent = 'Wh/km, MPC const-speed'; window.__lastRun = null;
  if (!running && readyInfo) setChip('idle', 'Idle');
}
async function preview() {
  const up = readMode() !== 'window'; $('rv-empty').hidden = !up; $('rv-run').hidden = up; $('rv-cap').hidden = up; if (up || !rvRun) return;
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
    else idx = +$('win').value;
  } catch (e) { st.innerHTML = `<span class="err">${e.message.split('\n').filter(Boolean).pop()}</span>`; setChip('error', 'Error'); return; }
  running = true; hasRun = false; pvSeq++; lockRail(true); $('run').disabled = true; $('export').disabled = true; $('empty').hidden = false;
  const rows = arms.map(a => ({ k: a, name: ARMS[a].name, o: ARMS[a] })); if (mode === 'window') rows.push({ k: 'recorded', name: 'Recorded follower', o: REC });
  const q = $('queue'); q.hidden = false; q.innerHTML = rows.map(r => `<li data-k="${r.k}" data-s="wait">${swatch(r.o)}<span class="qn">${r.name}</span><span class="qt">waiting</span></li>`).join('');
  const rail = document.querySelector('.rail'), toEnd = () => { rail.scrollTop = rail.scrollHeight; }; toEnd();
  const qs = (k, s, t) => { const li = q.querySelector(`[data-k="${k}"]`); li.dataset.s = s; li.querySelector('.qt').textContent = t; };
  const t0 = performance.now(), R = {}; let rec = null, cur = null;
  try {
    for (let i = 0; i < arms.length; i++) {
      cur = arms[i]; qs(cur, 'run', 'running'); setChip('running', `Running ${i + 1} of ${arms.length}`);
      const m = mode === 'window' ? await call({ cmd: 'runWindow', arm: cur, idx, eta, cap }) : await call({ cmd: 'runUpload', arm: cur, speeds: JSON.stringify(up.speeds), hz: up.hz, unit: $('unit').value, eta, cap });
      R[cur] = m.res; R[cur]._secs = m.secs; qs(cur, 'done', m.secs.toFixed(1) + ' s');
    }
    if (mode === 'window') { cur = 'recorded'; qs(cur, 'run', 'running'); const m = await call({ cmd: 'runWindow', arm: 'recorded', idx, eta, cap }); rec = m.res; qs(cur, 'done', m.secs.toFixed(1) + ' s'); }
  } catch (e) { st.innerHTML = `<span class="err">${e.message.split('\n').filter(Boolean).pop()}</span>`; if (cur) qs(cur, 'err', 'error'); setChip('error', 'Error'); running = false; lockRail(false); $('run').disabled = false; return; }
  const secs = (performance.now() - t0) / 1000; st.innerHTML = `Computed on your device in <span class="ro">${secs.toFixed(1)} s</span> Nothing was sent to a server`;
  setChip('done', `Done in ${secs.toFixed(1)} s`); toEnd(); running = false; lockRail(false); $('run').disabled = false;
  render(R, rec, arms, mode, idx, eta, cap, secs);
}
$('run').onclick = runSim;
function setTiles(R, rec, mode, secs) {
  const m = R.mpc_const, a = R.acc; $('t1').textContent = m ? fmt(m.whkm_adj, 1) : '-'; $('t1s').textContent = m ? 'Wh/km, MPC const-speed' : 'MPC const-speed not selected';
  if (mode === 'upload') { $('t2').textContent = 'n/a'; $('t2s').textContent = 'no recording for an upload'; } else { $('t2').textContent = m && rec ? sgn(pct(m.whkm_adj, rec.whkm_adj)) : '-'; $('t2s').textContent = 'recorded follower, same battery model'; }
  $('t3').textContent = m && a ? sgn(pct(m.whkm_adj, a.whkm_adj)) : '-'; $('t4').textContent = secs.toFixed(1) + ' s';
}
/* ---- tabs ---- */
const TABS = ['speed', 'gap', 'energy', 'table'];
function redrawCharts() { Object.values(chartJobs).forEach(j => { const sv = j[0].querySelector('svg'); if (sv && j[0].offsetParent && Math.abs(j[0].clientWidth - (+sv.getAttribute('width'))) > 8) lineChart(...j); }); }
function activateTab(k, focus) { TABS.forEach(t => { const on = t === k, b = $('tab-' + t); b.setAttribute('aria-selected', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; $('pn-' + t).hidden = !on; }); if (focus) $('tab-' + k).focus(); redrawCharts(); }
TABS.forEach((t, i) => {
  $('tab-' + t).onclick = () => activateTab(t, false);
  $('tab-' + t).onkeydown = e => { const j = e.key === 'ArrowRight' ? (i + 1) % 4 : e.key === 'ArrowLeft' ? (i + 3) % 4 : e.key === 'Home' ? 0 : e.key === 'End' ? 3 : -1; if (j >= 0) { e.preventDefault(); activateTab(TABS[j], true); } };
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
  const id = mode === 'window' ? 'window' + (WINDOWS[idx] ? WINDOWS[idx].win : idx) : 'upload', base = `ev_${id}_eta${eta}_cap${cap}`;
  saveText(base + '.csv', lines.join('\n') + '\n'); setTimeout(() => saveText(base + '_table.csv', tl.join('\n') + '\n'), 300);
}
$('export').onclick = exportCSV;
function render(R, rec, arms, mode, idx, eta, cap, secs) {
  $('out').style.display = 'block'; $('empty').hidden = true; $('export').disabled = false; hasRun = true; setTiles(R, rec, mode, secs);
  const dflt = Math.abs(eta - 0.65) < 1e-9 && Math.abs(cap - 35) < 1e-9, stored = (mode === 'window' && dflt && REF) ? REF.windows[idx] : null;
  const base = R.acc ? R.acc.whkm_adj : null, recW = rec ? rec.whkm_adj : null;
  let h = '<table><tr><th>Controller</th><th>Wh/km (your browser)</th>' + (stored ? '<th>Stored Python result (paper)</th><th>Browser vs stored</th>' : '') + '<th>vs tuned ACC</th>' + (rec ? '<th>vs recorded follower</th>' : '') + '<th>Mean gap (m)</th><th>Jerk RMS</th><th>Unsafe?</th><th>Time</th></tr>';
  if (rec) h += `<tr class="hl"><td>${swatch(REC)}Recorded follower (replayed through the same battery model)</td><td>${fmt(rec.whkm_adj, 1)}</td>${stored ? `<td>${fmt(stored.recorded.whkm_adj, 1)}</td><td>${sgn(pct(rec.whkm_adj, stored.recorded.whkm_adj))}</td>` : ''}<td>${base ? sgn(pct(rec.whkm_adj, base)) : '-'}</td><td>0 (reference)</td><td>${fmt(rec.gap_mean, 1)}</td><td>${fmt(rec.jerk_rms)}</td><td>n/a</td><td>-</td></tr>`;
  arms.forEach(a => {
    const o = R[a]; let cells = `<td>${swatch(ARMS[a])} ${ARMS[a].name}</td><td>${fmt(o.whkm_adj, 1)}</td>`;
    if (stored) { const s = stored[a]; cells += `<td>${fmt(s.whkm_adj, 1)}${s.short_max > 0.5 ? ' (unsafe)' : ''}</td><td>${sgn(pct(o.whkm_adj, s.whkm_adj))}</td>`; }
    cells += `<td>${base && a !== 'acc' ? sgn(pct(o.whkm_adj, base)) : (a === 'acc' ? '0 (reference)' : '-')}</td>`;
    if (rec) cells += `<td>${sgn(pct(o.whkm_adj, recW))}</td>`;
    cells += `<td>${fmt(o.gap_mean, 1)}</td><td>${fmt(o.jerk_rms)}</td><td>${unsafeStr(o)}${o.fail ? ` <span class="err">(${o.fail} solver failures)</span>` : ''}</td><td>${o._secs.toFixed(1)} s</td>`;
    h += '<tr>' + cells + '</tr>';
  });
  $('tbl').innerHTML = h + '</table>';
  const notes = [`Settings: regen efficiency ${eta}, regen cap ${cap} kW. Wh/km is battery energy with the paper's kinetic-energy end correction. Unsafe = gap shortfall above 0.5 m against the safe-gap rule 4 + 0.7 v.`];
  if (mode === 'window') notes.push(dflt ? 'The stored Python result is the number in the paper for this window (same controller code, OSQP solver for MPC, PyTorch actors for SAC). MPC rows can differ from it by up to about 0.2% because the browser uses the Clarabel solver.' : 'You changed the regen settings, so the stored paper results (computed at 0.65 / 35 kW) are not shown; the recorded follower is replayed again with your settings.');
  else notes.push(`Uploaded trace: ${(R[arms[0]].seconds_simulated).toFixed(0)} s simulated (the last 30 s of a trace give the MPC its look-ahead). This is your data, not a paper result. The oracle sees the lead car's future, so it is a ceiling, not a deployable controller.`);
  $('tnote').innerHTML = notes.join('<br>');
  const first = R[arms[0]], t = first.trace.t, S = [Object.assign({ y: first.trace.lead }, LEAD, { n: 'Lead' })], G = [], E = [];
  if (rec) { S.push(Object.assign({ y: rec.trace.v }, REC)); G.push(Object.assign({ y: rec.trace.gap }, REC, { n: 'Recorded follower (gap sensor)' })); }
  arms.forEach(a => { const tr = R[a].trace, o = ARMS[a]; S.push(Object.assign({}, o, { n: o.name, y: tr.v })); G.push(Object.assign({}, o, { n: o.name, y: tr.gap })); E.push(Object.assign({}, o, { n: o.name, y: tr.wh })); });
  runScrubT = null;
  lineChart($('c1'), t, S, 'speed, m/s'); lineChart($('c2'), t, G, 'gap to lead, m'); lineChart($('c3'), t, E, 'cumulative battery energy, Wh');
  window.__lastRun = { R, rec, arms, mode, idx, eta, cap, secs };
  activateTab('table', false);
  showRoad(R, rec, arms, t);
}
let rvRun = null;
function showRoad(R, rec, arms, t) {
  if (!window.RoadView || !rvRun) return;
  $('rv-empty').hidden = true; $('rv-run').hidden = false; $('rv-cap').hidden = false;
  $('rv-cap').textContent = 'Schematic replay of the computed window: positions come from the simulated speeds and gaps, and cars are drawn at 4.5 m.' + (rec ? ' The outline car is the recorded follower.' : '') + ' The cursor in the charts follows the replay.';
  rvRun.setData({ t, lead: R[arms[0]].trace.lead, lanes: arms.map(a => ({ id: a, name: ARMS[a].name, short: SHORT[a], accent: a === 'mpc_const', v: R[a].trace.v, gap: R[a].trace.gap, wh: R[a].trace.wh || null })), rec: rec ? { v: rec.trace.v, gap: rec.trace.gap, wh: rec.trace.wh || null } : null }, { autoplay: true });
}

/* ---------------- train panel ---------------- */
$('size').oninput = updSize; function updSize() { const n = SIZES[+$('size').value]; $('sizev').textContent = n ? `about ${n.toLocaleString()} samples (whole trips)` : 'all training samples (about 165,000, 54 trips)'; } updSize();
progressSink = null;
async function runTrain() {
  const model = $('model').value, mode = $('tmode').value, n = SIZES[+$('size').value], imp = $('imp').checked, st = $('tstatus');
  $('trainout').style.display = 'none'; $('train').disabled = true; const t0 = performance.now();
  progressSink = (f, m) => { st.textContent = m; }; st.textContent = 'Starting';
  try {
    const m = await call({ cmd: 'train', model, mode, n_target: n, importance: imp }); const r = m.res;
    st.innerHTML = `Done in <span class="ro">${((performance.now() - t0) / 1000).toFixed(1)} s</span> on your device (model fit ${r.train_s.toFixed(1)} s)`; renderTrain(r, model, mode, n);
  } catch (e) { st.innerHTML = `<span class="err">${e.message.split('\n').filter(Boolean).pop()}</span>`; }
  progressSink = null; $('train').disabled = false;
}
$('train').onclick = runTrain;
function paperRef(model, mode, n) {
  if (!MLREF) return null; const key = model + '_' + mode;
  if (n === 0 && MLREF.rmse_fold0[key]) return { kind: 'full', ...MLREF.rmse_fold0[key] };
  if (model === 'lgbm' && MLREF.curve_fold0_rep0[mode] && MLREF.curve_fold0_rep0[mode][String(n)]) { const c = MLREF.curve_fold0_rep0[mode][String(n)]; return { kind: 'curve', rmse_kw: c.rmse_kw, n_train: c.n_train, n_trips: c.n_trips, source: 'results/ml/learning_curve_*.csv, fold 0, draw 0' }; }
  return null;
}
function renderTrain(r, model, mode, n) {
  $('trainout').style.display = 'block'; const p = paperRef(model, mode, n), key = model + '_' + mode;
  const names = { ridge: 'Ridge', knn: 'KNN (k=25, 70k-row subsample)', svr: 'SVR (RBF, 8k subset)', lgbm: 'LightGBM (400 trees)' };
  let h = '<table style="min-width:0"><tr><th></th><th>Your browser</th><th>Paper (fold 0)</th></tr>';
  h += `<tr><td>Model</td><td colspan="2" style="text-align:left">${names[model]}, ${mode === 'resid' ? 'physics + ML residual' : 'pure ML (no physics)'}</td></tr>`;
  h += `<tr><td>Training samples / trips</td><td>${r.n_train.toLocaleString()} / ${r.n_trips}</td><td>${p && p.n_train ? p.n_train.toLocaleString() + ' / ' + p.n_trips : (p ? 'all 4 other folds' : '-')}</td></tr>`;
  h += `<tr><td>Held-out power RMSE (kW), fold 0, ${r.n_test.toLocaleString()} samples</td><td><strong>${r.rmse_kw.toFixed(3)}</strong></td><td>${p ? p.rmse_kw.toFixed(3) : 'no stored paper number for this setting'}</td></tr>`;
  if (p && p.kind === 'full') h += `<tr><td>MAE (kW) / R2</td><td>${r.mae_kw.toFixed(3)} / ${r.r2.toFixed(3)}</td><td>${p.mae_kw.toFixed(3)} / ${p.r2.toFixed(3)}</td></tr><tr><td>Trip-energy error: median |error| over 14 held-out trips / pooled</td><td>${r.trip_med_abs.toFixed(2)}% / ${sgn(r.pooled_err)}</td><td>${p.trip_med_abs.toFixed(2)}% / ${sgn(p.pooled_err)}</td></tr>`;
  else h += `<tr><td>MAE (kW) / R2</td><td>${r.mae_kw.toFixed(3)} / ${r.r2.toFixed(3)}</td><td>-</td></tr><tr><td>Trip-energy error: median |error| over 14 held-out trips / pooled</td><td>${r.trip_med_abs.toFixed(2)}% / ${sgn(r.pooled_err)}</td><td>-</td></tr>`;
  const ph = MLREF && MLREF.rmse_fold0.physics_resid; if (ph) h += `<tr><td>For reference: physics model alone</td><td>-</td><td>${ph.rmse_kw.toFixed(3)} kW</td></tr>`;
  h += '</table>'; $('tres').innerHTML = h;
  if (r.importance) {
    const pi = MLREF && MLREF.importance_fold0[key], names2 = Object.keys(r.importance).sort((a, b) => r.importance[b] - r.importance[a]), mx = Math.max(0.01, ...names2.map(k => Math.max(r.importance[k], pi && pi[k] !== undefined ? pi[k] : 0)));
    let b = `<div class="lim mut" style="margin-bottom:12px">Increase in held-out power RMSE (kW) when one input group is shuffled (grouped permutation importance; fold 0; ${model === 'lgbm' ? 'all held-out rows, 3 repeats' : '5,000 held-out rows, 2 repeats'}). Thick bar = your run, the top input in teal; thin bar = paper's stored fold-0 value${pi ? '' : ' (not stored for this model)'}.</div>`;
    names2.forEach((k, ri) => { const v = r.importance[k], w = pi && pi[k] !== undefined ? pi[k] : null; b += `<div class="imp"><div>${k}</div><div><div class="b b1${ri === 0 ? ' top' : ''}" style="width:${Math.max(0, 100 * v / mx)}%"></div><span class="v">${v.toFixed(3)}</span>${w !== null ? `<div class="b b2" style="width:${Math.max(0, 100 * w / mx)}%"></div><span class="v">${w.toFixed(3)}</span>` : ''}</div></div>`; });
    $('timp').innerHTML = b;
  } else $('timp').innerHTML = '<div class="lim mut">Importance not computed (tick the box to compute it).</div>';
  window.__lastTrain = r;
}

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
