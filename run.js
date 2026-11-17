'use strict';
/* /run/ page: simulation workbench (settings rail, road view, tiles, tabbed results, MATLAB side-by-side). Uses common.js. */
/* MATLAB check windows and traces (optional: a missing file just hides the feature) */
let MW = null, MT = null;
const getJSON = u => DESKTOP ? fetch(u).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null);
getJSON('/data/matlab_windows.json?v=20261115m').then(d => { MW = d && d.windows && d.windows.length === 10 ? d : null; if (!MW) $('mmodelab').hidden = true; else fillMWin(); });
getJSON('/data/matlab_traces.json?v=20261115m').then(d => { MT = d; });
function mtrace(n) {
  if (!MT) return null; const z = String(n).padStart(2, '0'), W = MT.windows || MT, d = Array.isArray(W) ? W[n - 1] : (W['w' + n] || W['w' + z] || W[n] || W[z]);
  return d && Array.isArray(d.t) && d.v_acc && d.v_mpc ? d : null;
}
function fillMWin() { const sel = $('mwin'); sel.innerHTML = ''; MW.windows.forEach((w, i) => { const o = document.createElement('option'); o.value = i; o.textContent = `Window ${w.n}: lead mean ${w.lead_mean_kmh.toFixed(0)} km/h`; sel.appendChild(o); }); sel.onchange = () => { resetStage(); preview(); }; }


/* ---------------- charts ---------------- */
const chartJobs = {};
/* Series hidden by a legend click or by unticking its controller after a run. A series has an id (a controller key, 'lead', 'recorded'); a series with `of` follows that controller (the dotted MATLAB lines). */
const HID = new Set();
const seriesOn = s => !(s.id && HID.has(s.id)) && !(s.of && HID.has(s.of));
function lineChart(el, t, series, ylabel, opt) {
  opt = opt || {}; chartJobs[el.id] = [el, t, series, ylabel, opt]; const all0 = series; series = series.filter(seriesOn);
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
  const lg = all0.filter(s => !s.hide).map(s => s.id ? `<button type="button" class="lg lgb${seriesOn(s) ? '' : ' off'}" data-id="${s.id}" aria-pressed="${seriesOn(s)}" title="${seriesOn(s) ? 'Click to hide' : 'Click to show'} ${s.n}">${swatch(s)}${s.n}</button>` : `<span class="lg">${swatch(s)}${s.n}</span>`).join('');
  el.innerHTML = `${opt.labelTop ? `<div class="meta top">${ylabel}</div>` : ''}${opt.legend === false ? '' : `<div class="legend">${lg}</div>`}<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${ylabel}" data-ml="${m.l}" data-mr="${m.r}" data-w="${W}" data-t="${T}">${g}${paths.join('')}<line class="scrubl" y1="${m.t}" y2="${H - m.b}" x1="0" x2="0" style="display:none"/><g class="hovg" style="display:none;pointer-events:none"><line class="hovl" y1="${m.t}" y2="${H - m.b}" x1="0" x2="0" style="stroke:var(--text3);stroke-width:1;stroke-dasharray:2 3;opacity:.55"/><text class="hovt" y="${m.t - 4}" style="fill:var(--text3);font:400 10px var(--mono)"></text></g><rect class="hit" x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}" fill="transparent" style="touch-action:pan-y;cursor:col-resize"/></svg>${opt.labelTop ? '' : `<div class="meta" style="margin-top:4px">${ylabel}</div>`}`;
  el.querySelectorAll('.lgb').forEach(b => { b.onclick = () => toggleSeries(b.dataset.id); });
  if (opt.noScrub) return;
  const sv = el.querySelector('svg[data-ml]'), hit = sv.querySelector('.hit'), send = (t, phase) => window.dispatchEvent(new CustomEvent('ev:scrub', { detail: { t, src: 'chart', scope: 'run', phase } }));
  /* scrubber, not hover: hovering shows a faint line and its time only; pressing and dragging moves the road view (paused), releasing leaves it paused there */
  const hg = sv.querySelector('.hovg'), hl = sv.querySelector('.hovl'), ht = sv.querySelector('.hovt'), ml_ = +sv.dataset.ml, mr_ = +sv.dataset.mr, W_ = +sv.dataset.w; let drag = false;
  const tAt = e => { const r = hit.getBoundingClientRect(); return Math.max(0, Math.min(T, (e.clientX - r.left) / r.width * T)); };
  const hov = t => { if (t === null) { hg.style.display = 'none'; return; } const x = ml_ + t / T * (W_ - ml_ - mr_); hg.style.display = ''; hl.setAttribute('x1', x); hl.setAttribute('x2', x); ht.textContent = t.toFixed(1) + ' s'; ht.setAttribute('x', x); ht.setAttribute('text-anchor', x < ml_ + 24 ? 'start' : x > W_ - mr_ - 24 ? 'end' : 'middle'); };
  hit.addEventListener('pointerdown', e => { if (e.button > 0) return; try { hit.setPointerCapture(e.pointerId); } catch (x) { } drag = true; hov(null); send(tAt(e), 'down'); });
  hit.addEventListener('pointermove', e => { if (drag) send(tAt(e), 'drag'); else hov(tAt(e)); });
  const end = () => { if (!drag) return; drag = false; send(runScrubT, 'up'); };
  hit.addEventListener('pointerup', end); hit.addEventListener('pointercancel', end); hit.addEventListener('lostpointercapture', end); hit.addEventListener('pointerleave', () => { if (!drag) hov(null); });
  sv.tabIndex = 0; sv.addEventListener('keydown', e => { if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; e.preventDefault(); const t = Math.max(0, Math.min(T, (runScrubT === null ? 0 : runScrubT) + (e.key === 'ArrowRight' ? 0.5 : -0.5))); send(t, 'down'); send(t, 'up'); });
  if (runScrubT !== null) setScrub(sv, runScrubT);
}
function redrawAllCharts() { Object.values(chartJobs).forEach(j => { if (j[0].isConnected) lineChart(...j); }); }
function toggleSeries(id, on) {
  const show = on === undefined ? HID.has(id) : on; if (show) HID.delete(id); else HID.add(id);
  const cb = $('arm_' + id); if (cb && cb.checked !== show) cb.checked = show;
  redrawAllCharts(); document.querySelectorAll('#tbl tr[data-a]').forEach(tr => tr.classList.toggle('rowoff', HID.has(tr.dataset.a)));
  const L = window.__lastRun; if (L) showRoad(L.R, L.rec, L.arms, L.R[L.arms[0]].trace.t, true);
}
let runScrubT = null;
function setScrub(sv, t) {
  const ln = sv.querySelector('.scrubl'); if (!ln) return; if (t === null) { ln.style.display = 'none'; return; }
  const ml = +sv.dataset.ml, mr = +sv.dataset.mr, W = +sv.dataset.w, T = +sv.dataset.t, x = ml + Math.min(1, t / T) * (W - ml - mr); ln.setAttribute('x1', x); ln.setAttribute('x2', x); ln.style.display = '';
}
window.addEventListener('ev:scrub', e => { const d = e.detail || {}; if (d.scope !== 'run' || d.phase === 'up') return; runScrubT = d.t === undefined ? null : d.t; Object.values(chartJobs).forEach(j => { const sv = j[0].querySelector('svg[data-ml]'); if (sv) setScrub(sv, runScrubT); }); });
let rzT = 0; window.addEventListener('resize', () => { clearTimeout(rzT); rzT = setTimeout(() => Object.values(chartJobs).forEach(j => { const sv = j[0].querySelector('svg'); if (sv && j[0].offsetParent && Math.abs(j[0].clientWidth - (+sv.getAttribute('width'))) > 8) lineChart(...j); }), 150); });

/* ---------------- run panel ---------------- */
function initUI() {
  $('run').disabled = false; setChip('idle', 'Idle');
  rvRun = RoadView.create($('rv-run'), { id: 'rv-run', scope: 'run', height: 120, loop: false, speed: 10, multi: true });
  fillWindows(); $('filt').onchange = fillWindows; $('win').onchange = updWin; $('road').onchange = () => { applyRoadUI(); };
}
const CITY_MS = () => S1B ? S1B.max_mean_lead_ms : 20.0, CITY_KMH = () => Math.round(CITY_MS() * 3.6);   // the paper's S1b window rule: mean lead speed <= 20 m/s (python/s1b_run.py); the exported file carries the value
const roadKind = () => $('road').value;   // 'plain' | 'breakers' | 'potholes'
const roadArms = () => roadKind() !== 'plain';
let S1B = null; getJSON('/data/s1b_paper.json?v=' + SITE_V).then(d => { S1B = d; updRoadInfo(); });
function updRoadInfo() {
  const k = roadKind(), el = $('roadinfo'); if (!el) return;
  el.textContent = k === 'plain' ? 'The recorded road, as in the paper\'s main results.' : k === 'breakers' ? 'Speed breakers placed as in the paper\'s test S1b, with the lead car slowing for them. Only windows with a lead mean speed up to ' + CITY_KMH() + ' km/h are listed, as in the paper. The recorded follower is not shown: it drove on the plain road.' : 'Speed breakers as above, plus potholes. Demo only, not part of the paper\'s results. The potholes are an assumed extra that costs every controller some energy; they do not change how any controller drives.';
}
function applyRoadUI() {
  const rd = roadArms(), m = readMode(); $('armset').hidden = rd; $('armset-road').hidden = !rd; fillWindows(); updRoadInfo();
}
function fillWindows() {
  const f = $('filt').value, sel = $('win'), cityOnly = roadArms(); sel.innerHTML = '';
  WINDOWS.filter(w => (f === 'all' || w.group === f) && (!cityOnly || w.mean_vl <= CITY_MS())).forEach(w => { const o = document.createElement('option'); o.value = w.idx; o.textContent = `#${w.win}: ${w.campaign}, follower ${w.vehicle} (${w.group}), lead mean ${(w.mean_vl * 3.6).toFixed(0)} km/h`; sel.appendChild(o); });
  updWin();
}
function updWin() { const w = WINDOWS[+$('win').value]; resetStage(); const rd = roadArms(); $('wininfo').textContent = w ? `${rd ? 'Road windows are the test windows with a lead mean speed up to ' + CITY_KMH() + ' km/h, as in the paper. ' : ''}Window #${w.win}: 120 s of recorded lead-vehicle speed (${w.campaign} campaign). Recorded follower: ${w.vehicle}, ${w.group === 'acc' ? 'commercial ACC' : w.group === 'human' ? 'human driver' : 'mixed ACC/human'}.` : ''; preview(); }
function readMode() { return document.querySelector('input[name=mode]:checked').value; }
let pvT = 0;
['eta', 'cap'].forEach(k => $(k).oninput = () => { $(k + 'v').textContent = $(k).value; if (!hasRun && !running && readMode() === 'window') { clearTimeout(pvT); pvT = setTimeout(preview, 250); } });
$('reset').onclick = () => { $('eta').value = 0.65; $('cap').value = 35; $('etav').textContent = '0.65'; $('capv').textContent = '35'; if (!hasRun && !running && readMode() === 'window') preview(); };
document.querySelectorAll('input[name=mode]').forEach(r => r.onchange = () => { const m = readMode(); if (m === 'matlab' && roadKind() !== 'plain') { $('road').value = 'plain'; applyRoadUI(); } $('road').disabled = m === 'matlab'; $('winbox').style.display = m === 'window' ? '' : 'none'; $('mbox').style.display = m === 'matlab' ? '' : 'none'; $('upbox').style.display = m === 'upload' ? '' : 'none'; resetStage(); preview(); });
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
  $('tab-matlab').hidden = true; $('mlpanel').innerHTML = ['t1m', 't3m'].map(i => { $(i).hidden = true; return ''; }).join(''); if ($('tab-matlab').getAttribute('aria-selected') === 'true') activateTab('table', false);
  hasRun = false; $('out').style.display = 'none'; $('empty').hidden = false; $('export').disabled = true; $('qd').hidden = true; $('qd').open = false; $('queue').innerHTML = ''; $('status').textContent = '';
  ['t1', 't2', 't3', 't4'].forEach(i => { $(i).textContent = '-'; }); $('t2s').textContent = 'recorded follower, same battery model'; $('t2').parentNode.querySelector('.tl').textContent = 'vs normal car'; $('t1s').textContent = 'Wh/km, MPC const-speed'; $('t3s').textContent = 'Wh/km, same window'; $('t3').parentNode.querySelector('.tl').textContent = 'vs tuned ACC'; window.__lastRun = null;
  if (!running && readyInfo) setChip('idle', 'Idle');
}
async function preview() {
  const up = readMode() !== 'window' || roadArms(); $('rv-empty').textContent = readMode() === 'matlab' ? 'Press run. The road view shows the computed lanes for this MATLAB check window.' : readMode() === 'window' ? 'Press run. The road view shows the computed lanes on the road you picked, with its speed breakers' + (roadKind() === 'potholes' ? ' and potholes (demo only, not part of the paper\'s results).' : '.') : 'Upload a lead-speed trace and press run. The road view shows the computed lanes.'; $('rv-empty').hidden = !up; $('rv-run').hidden = up; $('rv-cap').hidden = up; if (up || !rvRun) return;
  $('rv-cap').textContent = $('wininfo').textContent + ' Recorded data only. Press run to add the controllers.';
  /* recorded data only: the follower replay, plus the lead-speed trace (taken from the cheap tuned-ACC call; none of that controller's results is shown) */
  const seq = ++pvSeq, idx = +$('win').value; let m, l; try { m = await call({ cmd: 'runWindow', arm: 'recorded', idx, eta: +$('eta').value, cap: +$('cap').value }); if (seq !== pvSeq) return; l = await call({ cmd: 'runWindow', arm: 'acc', idx, eta: 0.65, cap: 35 }); } catch (e) { return; }
  if (seq !== pvSeq || hasRun || running) return; const tr = m.res.trace;
  rvRun.setData({ t: l.res.trace.t, lead: l.res.trace.lead, lanes: [], rec: { v: tr.v, gap: tr.gap, wh: null } }, { autoplay: false });
}
async function runSim() {
  const eta = +$('eta').value, cap = +$('cap').value, mode = readMode(), road = mode === 'matlab' ? 'plain' : roadKind(), rd = road !== 'plain', arms = (rd ? ROAD_ORDER : ARM_ORDER).filter(a => $('arm_' + a).checked);
  const st = $('status'); st.textContent = ''; $('out').style.display = 'none';
  const qd = $('qd'), qsum = $('qsum'), failMsg = h => { st.innerHTML = h; qsum.textContent = 'Run did not start'; qd.hidden = false; qd.open = true; setChip('error', 'Error'); };
  if (!arms.length) { failMsg('<span class="err">Pick at least one controller.</span>'); return; }
  let up = null, idx = null, chk = null;
  try {
    if (mode === 'upload') { up = parseTrace(); chk = await call({ cmd: 'checkUpload', speeds: JSON.stringify(up.speeds), hz: up.hz, unit: $('unit').value }); }
    else if (mode === 'matlab') { if (!MW) throw new Error('The MATLAB check windows could not be loaded.'); idx = +$('mwin').value; up = { speeds: MW.windows[idx].speeds.map(Math.fround), hz: MW.meta.hz }; chk = await call({ cmd: 'checkUpload', speeds: JSON.stringify(up.speeds), hz: up.hz, unit: 'mps' }); }
    else idx = +$('win').value;
  } catch (e) { failMsg(`<span class="err">${e.message.split('\n').filter(Boolean).pop()}</span>`); return; }
  running = true; hasRun = false; pvSeq++; lockRail(true); $('run').disabled = true; $('export').disabled = true; $('empty').hidden = false;
  const rows = arms.map(a => ({ k: a, name: ARMS[a].name, o: ARMS[a] })); if (mode === 'window' && !rd) rows.push({ k: 'recorded', name: 'Recorded follower', o: REC });
  const q = $('queue'); qd.hidden = false; qd.open = true; qsum.textContent = `Running 0 of ${arms.length}`; q.innerHTML = rows.map(r => `<li data-k="${r.k}" data-s="wait">${swatch(r.o)}<span class="qn" title="${r.name}">${r.name}</span><span class="qt">waiting</span></li>`).join('');
  const qs = (k, s, t) => { const li = q.querySelector(`[data-k="${k}"]`); li.dataset.s = s; li.querySelector('.qt').textContent = t; };
  /* process pane: stages as the page and worker really report them. Decision steps = (samples - 150 - 1) // 5 at 10 Hz (py/mpc_acc.py simulate): 209 for a 120 s window. */
  const nS = mode === 'window' ? 1200 : Math.round(chk.res.seconds * 10) + 1, nDec = Math.floor((nS - 151) / 5), nPlant = nDec * 5, fmtN = n => n.toLocaleString('en-US');
  const cnt = `<b>${nDec} decisions</b> in this ${mode === 'window' ? 'window' : 'trace'} (one every 0.5 s), and the car moves in ${fmtN(nPlant)} steps of 0.1 s; at each 0.1 s step the battery model adds up the energy.`;
  const PT = {
    acc: 'Tuned ACC: every 0.5 s it computes an acceleration from the gap and the speed difference to the lead car. ' + cnt,
    smc: 'Sliding-mode controller (SMC): every 0.5 s it picks an acceleration from the gap error with a switching rule. ' + cnt,
    sac42: 'Plain SAC: every 0.5 s a neural network picks the acceleration from 7 inputs (own speed, speed difference, gap error, gap, lead speed, lead acceleration, last acceleration). ' + cnt,
    safesac42: 'Safe SAC: the same kind of network, plus a safety filter that checks the gap rule at every step and corrects the acceleration when it would break it. ' + cnt,
    mpc_const: 'MPC (our car): every 0.5 s it solves an optimisation over the next 15 s (30 steps) with the battery model, using the CLARABEL solver, and assumes the lead car keeps its present speed. ' + cnt,
    mpc_oracle: 'MPC oracle: the same optimisation, but it is given the lead car\'s true speed for the next 15 s, which no real car has. It shows the ceiling. ' + cnt,
    acc_map: 'Tuned ACC with a road map (paper arm ACC-map): it also slows so that it crosses each speed breaker at the breaker speed. ' + cnt,
    mpc_map_L: 'MPC with a road map and a simple lead model (paper arm MPC-map-L): it plans to cross each breaker slowly and assumes the lead car also slows for the breakers. Every 0.5 s it solves an optimisation over the next 15 s. ' + cnt,
    mpc_oracle_map: 'MPC oracle with a road map (paper arm ORACLE-map): the same, but it is given the lead car\'s true speed for the next 15 s. It shows the ceiling. ' + cnt,
    acc_blind: 'Tuned ACC that does not know about the breakers. It only follows the lead car, so it may cross a breaker faster than the breaker speed. A contrast, not a paper arm. ' + cnt,
    mpc_blind: 'MPC const-speed that does not know about the breakers. A contrast, not a paper arm. ' + cnt };
  const pst = [{ k: 'load', name: 'Load the lead-car trace', text: mode === 'window' ? `The 120 s of recorded lead-car speed for window #${WINDOWS[idx] ? WINDOWS[idx].win : ''} (1,200 samples at 10 Hz) is already in memory.` : `Your trace is checked (length, speed range) and resampled to 10 Hz: ${fmtN(nS)} samples.` }]
    .concat(arms.map(a => ({ k: a, name: ARMS[a].name, text: PT[a] })));
  if (mode === 'window' && !rd) pst.push({ k: 'recorded', name: 'Recorded follower', text: 'The recorded follower\'s real speeds are replayed through the same battery model, so its energy is comparable with the controllers\'.' });
  pst.push({ k: 'metrics', name: 'Collect the results', text: 'Energy per km, gap, jerk and safety are read from each run, then the table, charts and road view are built.' });
  Proc.start(mode === 'window' ? 'Running on your device' : 'Running your trace on your device', pst); Proc.stage('load', 'done', 'ready'); Proc.log((rd ? `road: ${road === 'potholes' ? 'speed breakers + potholes (demo only)' : 'speed breakers (paper scenario S1b)'}; ` : '') + `${arms.length} controller(s) selected; regen efficiency ${eta}, cap ${cap} kW; ${nDec} decisions per controller`);
  const t0 = performance.now(), R = {}; let rec = null, cur = null;
  try {
    for (let i = 0; i < arms.length; i++) {
      cur = arms[i]; qs(cur, 'run', 'running'); Proc.stage(cur, 'run'); setChip('running', `Running ${i + 1} of ${arms.length}`); qsum.textContent = `Running ${i + 1} of ${arms.length}`;
      const m = mode === 'window' ? await call({ cmd: 'runWindow', arm: cur, idx, eta, cap, road }) : await call({ cmd: 'runUpload', arm: cur, speeds: JSON.stringify(up.speeds), hz: up.hz, unit: mode === 'matlab' ? 'mps' : $('unit').value, eta, cap, road });
      R[cur] = m.res; R[cur]._secs = m.secs; qs(cur, 'done', m.secs.toFixed(1) + ' s'); Proc.stage(cur, 'done', m.secs.toFixed(1) + ' s'); if (m.res.steps !== undefined && m.res.steps !== nDec) Proc.log(`note: the engine reports ${m.res.steps} decision steps, not ${nDec}`);
    }
    if (mode === 'window' && !rd) { cur = 'recorded'; qs(cur, 'run', 'running'); Proc.stage(cur, 'run'); qsum.textContent = 'Replaying the recorded follower'; const m = await call({ cmd: 'runWindow', arm: 'recorded', idx, eta, cap }); rec = m.res; qs(cur, 'done', m.secs.toFixed(1) + ' s'); Proc.stage(cur, 'done', m.secs.toFixed(1) + ' s'); }
  } catch (e) { st.innerHTML = `<span class="err">${e.message.split('\n').filter(Boolean).pop()}</span>`; if (cur) qs(cur, 'err', 'error'); Proc.fail(e.message.split('\n').filter(Boolean).pop()); qsum.textContent = 'Run failed'; setChip('error', 'Error'); running = false; lockRail(false); $('run').disabled = false; return; }
  const secs = (performance.now() - t0) / 1000; st.innerHTML = `Computed on your device in <span class="ro">${secs.toFixed(1)} s</span> Nothing was sent to a server`; qsum.textContent = `Last run: ${secs.toFixed(1)} s`; qd.open = false;
  setChip('done', `Done in ${secs.toFixed(1)} s`); running = false; lockRail(false); $('run').disabled = false;
  Proc.stage('metrics', 'run'); await new Promise(r => setTimeout(r, 30)); Proc.stage('metrics', 'done', 'ready'); Proc.finish(true); render(R, rec, arms, mode, idx, eta, cap, secs, road);   /* results view is shown first so the charts measure their real width */
}
$('run').onclick = runSim;
/* after a run, a controller's tick box shows or hides that controller in the charts and the road view (no re-run); before a run it only chooses what to run */
document.querySelectorAll('.arm input').forEach(cb => cb.addEventListener('change', () => { const id = cb.id.slice(4), L = window.__lastRun; if (L && hasRun && !running && L.arms.includes(id)) toggleSeries(id, cb.checked); }));
const dp3 = x => (Math.abs(x) < 0.0005 ? '0.000%' : (x > 0 ? '+' : '\u2212') + Math.abs(x).toFixed(3) + '%');
function setTiles(R, rec, mode, secs, ml, road) {
  const rd = !!road && road !== 'plain', m = R[rd ? 'mpc_map_L' : 'mpc_const'], a = R[rd ? 'acc_map' : 'acc'], nm = rd ? 'MPC with map' : 'MPC const-speed';
  $('t3').parentNode.querySelector('.tl').textContent = rd ? 'vs ACC with map' : 'vs tuned ACC';
  $('t1').textContent = m ? fmt(m.whkm_adj, 1) : '-'; $('t1s').textContent = m ? 'Wh/km, ' + nm : nm + ' not selected';
  if (rd) { const oc = R.mpc_map_L || R.mpc_const_blind || m, ex = oc ? (oc.cross_excess_max !== undefined ? oc.cross_excess_max : oc.cross_excess) : null; $('t2').parentNode.querySelector('.tl').textContent = 'Over the breakers'; $('t2').textContent = ex === null || ex === undefined ? '-' : (ex * 3.6 <= 0.05 ? 'within limit' : '+' + (ex * 3.6).toFixed(1) + ' km/h'); $('t2s').textContent = `our car's fastest crossing above the 15 km/h breaker speed (${oc && oc.ncross !== undefined ? oc.ncross : 0} crossings)`; } else if (mode !== 'window') { $('t2').parentNode.querySelector('.tl').textContent = 'vs normal car'; $('t2').textContent = 'n/a'; $('t2s').textContent = mode === 'matlab' ? 'no recording for this trace' : 'no recording for an upload'; } else { $('t2').parentNode.querySelector('.tl').textContent = 'vs normal car'; $('t2').textContent = m && rec ? sgn(pct(m.whkm_adj, rec.whkm_adj)) : '-'; $('t2s').textContent = 'recorded follower, same battery model'; }
  $('t3').textContent = m && a ? sgn(pct(m.whkm_adj, a.whkm_adj)) : '-'; $('t3s').textContent = rd ? 'Wh/km, MPC with map vs ACC with map' : 'Wh/km, same window'; $('t4').textContent = secs.toFixed(1) + ' s';
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
function exportCSV() {
  const L = window.__lastRun; if (!L) return; const { R, rec, arms, mode, idx, eta, cap } = L, r4 = x => (x === null || x === undefined || !Number.isFinite(x)) ? '' : Number(x.toFixed(4));
  const first = R[arms[0]].trace; let n = first.t.length; arms.forEach(a => { n = Math.min(n, R[a].trace.t.length); }); const hasRec = !!(rec && rec.trace && rec.trace.gap); if (hasRec) n = Math.min(n, rec.trace.v.length, rec.trace.gap.length);
  const recWh = hasRec && rec.trace.wh, head = ['t_s', 'lead_v_mps']; if (hasRec) head.push('recorded_v_mps', 'recorded_gap_m'); if (recWh) head.push('recorded_cum_wh'); arms.forEach(a => head.push(a + '_v_mps', a + '_gap_m', a + '_cum_wh'));
  const lines = [head.join(',')];
  for (let i = 0; i < n; i++) { const row = [r4(first.t[i]), r4(first.lead[i])]; if (hasRec) row.push(r4(rec.trace.v[i]), r4(rec.trace.gap[i])); if (recWh) row.push(r4(rec.trace.wh[i])); arms.forEach(a => { const tr = R[a].trace; row.push(r4(tr.v[i]), r4(tr.gap[i]), r4(tr.wh[i])); }); lines.push(row.join(',')); }
  const tl = []; document.querySelectorAll('#tbl table tr').forEach(tr => tl.push([...tr.children].map(c => csvCell(c.textContent.trim())).join(',')));
  const id = (mode === 'window' ? 'window' + (WINDOWS[idx] ? WINDOWS[idx].win : idx) : mode === 'matlab' ? 'matlab_window' + (MW ? MW.windows[idx].n : idx) : 'upload') + (L.road === 'breakers' ? '_speed_breakers' : L.road === 'potholes' ? '_speed_breakers_potholes_demo_only' : ''), base = `ev_${id}_eta${eta}_cap${cap}`;
  saveText(base + '.csv', lines.join('\n') + '\n'); setTimeout(() => saveText(base + '_table.csv', tl.join('\n') + '\n'), 300);
}
$('export').onclick = exportCSV;
function render(R, rec, arms, mode, idx, eta, cap, secs, road) {
  HID.clear(); const rd = !!road && road !== 'plain', pit = road === 'potholes', refA = rd ? 'acc_map' : 'acc';
  const dflt = Math.abs(eta - 0.65) < 1e-9 && Math.abs(cap - 35) < 1e-9, stored = (mode === 'window' && dflt && REF && !rd) ? REF.windows[idx] : null;
  const isM = mode === 'matlab' && !!MW, mwin = isM ? MW.windows[idx] : null, ml = isM && dflt ? mwin.matlab : null, mt = ml ? mtrace(mwin.n) : null, fw = isM ? (x => fmt(x, 3)) : (x => fmt(x, 1));
  $('out').style.display = 'block'; $('empty').hidden = true; $('export').disabled = false; hasRun = true; setTiles(R, rec, mode, secs, ml, road);
  const base = R[refA] ? R[refA].whkm_adj : null, recW = rec ? rec.whkm_adj : null;
  let h = '<table><tr><th>Controller</th><th>Wh/km (your browser)</th>' + (ml ? '<th>MATLAB R2024b</th><th>Web vs MATLAB</th>' : '') + (stored ? '<th>Stored Python result (paper)</th><th>Browser vs stored</th>' : '') + `<th>${rd ? 'vs ACC with map' : 'vs tuned ACC'}</th>` + (rec ? '<th>vs recorded follower</th>' : '') + (rd ? '<th>Breakers crossed</th><th>Speed over breaker speed (m/s, mean)</th>' + (pit ? '<th>Pothole energy (Wh, demo only)</th>' : '') : '') + '<th>Mean gap (m)</th><th>Jerk RMS</th><th>Unsafe?</th><th>Time</th></tr>';
  if (rec) h += `<tr class="hl"><td>${swatch(REC)}Recorded follower (replayed through the same battery model)</td><td>${fmt(rec.whkm_adj, 1)}</td>${stored ? `<td>${fmt(stored.recorded.whkm_adj, 1)}</td><td>${sgn(pct(rec.whkm_adj, stored.recorded.whkm_adj))}</td>` : ''}<td>${base ? sgn(pct(rec.whkm_adj, base)) : '-'}</td><td>0 (reference)</td><td>${fmt(rec.gap_mean, 1)}</td><td>${fmt(rec.jerk_rms)}</td><td>n/a</td><td>-</td></tr>`;
  arms.forEach(a => {
    const o = R[a]; let cells = `<td>${swatch(ARMS[a])} ${ARMS[a].name}</td><td>${fw(o.whkm_adj)}</td>`;
    if (ml) cells += ml[a] ? `<td>${fmt(ml[a].whkm_adj, 3)}</td><td>${dp3(pct(o.whkm_adj, ml[a].whkm_adj))}</td>` : '<td class="mut">not ported</td><td>-</td>';
    if (stored) { const s = stored[a]; cells += `<td>${fmt(s.whkm_adj, 1)}${s.short_max > 0.5 ? ' (unsafe)' : ''}</td><td>${sgn(pct(o.whkm_adj, s.whkm_adj))}</td>`; }
    cells += `<td>${base && a !== refA ? sgn(pct(o.whkm_adj, base)) : (a === refA ? '0 (reference)' : '-')}</td>`;
    if (rec) cells += `<td>${sgn(pct(o.whkm_adj, recW))}</td>`;
    if (rd) cells += `<td>${o.ncross}</td><td>${fmt(o.cross_excess, 2)}</td>` + (pit ? `<td>${fmt(o.pothole_wh, 2)}</td>` : '');
    cells += `<td>${fmt(o.gap_mean, 1)}</td><td>${fmt(o.jerk_rms)}</td><td>${unsafeStr(o)}${o.fail ? ` <span class="err">(${o.fail} solver failures)</span>` : ''}</td><td>${o._secs.toFixed(1)} s</td>`;
    h += `<tr data-a="${a}">` + cells + '</tr>';
  });
  $('tbl').innerHTML = h + '</table>';
  const notes = [`Settings: regen efficiency ${eta}, regen cap ${cap} kW. Wh/km is battery energy with the paper's kinetic-energy end correction. Unsafe = gap shortfall above 0.5 m against the safe-gap rule 4 + 0.7 v.`];
  if (rd) {
    const ri = R[arms[0]].road, w = mode === 'window' && WINDOWS[idx] ? WINDOWS[idx].win : null;
    notes.push(`Road: speed breakers as in the paper's test S1b (the paper's generator in py/scenarios.py, unchanged; seed 7100 + ${w !== null ? 'window number ' + w : 'the default for an uploaded trace'}). The generator placed ${ri.breakers.length} breaker${ri.breakers.length === 1 ? '' : 's'} along the route, and the cars crossed ${R[arms[0]].ncross} of them in this run; the breaker speed is ${ri.vb} m/s and the lead car slows for each one. The recorded follower is not shown because it drove on the plain road. ${w !== null ? 'These windows are not the 42 windows of the paper\'s test; the paper\'s own numbers are below.' : ''}`);
    if (S1B) { const A = S1B.arms, f2 = x => sgn(x), L = A.mpc_map_L, C = A.acc_map; notes.push(`Paper, test S1b (${S1B.n_windows} other windows, same generator): median Wh/km ${fmt(C.median_whkm, 1)} for ACC with map and ${fmt(L.median_whkm, 1)} for MPC with map and the lead model (${f2(L.vs_acc_map_median_pct)}); unsafe windows ${L.unsafe} for MPC and ${C.unsafe} for ACC; mean speed over the breaker speed ${fmt(L.cross_excess_mean, 2)} m/s for MPC and ${fmt(C.cross_excess_mean, 2)} m/s for ACC. ${S1B.caveat}`); }
    if (pit) { const pp = ri.pit; notes.push(`<b>Demo only, not part of the paper's results.</b> Potholes: ${ri.potholes.length} rough stretch${ri.potholes.length === 1 ? '' : 'es'} of ${pp.length_m} m along the distance driven, each adding an assumed extra rolling-resistance force of ${pp.force_n} N, at the same road positions for every controller. They change energy only. The values are assumed, not measured; they are set in py/road_demo.py. Wh/km in this table includes the pothole energy.`); }
  }
  if (rd && mode === 'window') { /* the road notes above replace the stored-result note: there is no stored result for a road */ } else if (mode === 'window') notes.push(dflt ? 'The stored Python result is the number in the paper for this window (same controller code, OSQP solver for MPC, PyTorch actors for SAC). MPC rows can differ from it by up to about 0.2% because the browser uses the Clarabel solver.' : 'You changed the regen settings, so the stored paper results (computed at 0.65 / 35 kW) are not shown; the recorded follower is replayed again with your settings.');
  else if (isM) notes.push(`MATLAB check window ${mwin.n}: the 10 Hz lead-speed trace the MATLAB check used (V2V test row ${mwin.row}, not one of the 160 windows), run through this page's upload path.` + (ml ? ' MATLAB R2024b column: matlab/verify/matlab_results.csv. MATLAB ported only the tuned ACC and the MPC with constant-speed preview, so the other controllers show "not ported". Web vs MATLAB = website / MATLAB \u2212 1. Both columns are shown to 3 decimals.' : ' You changed the regen settings, so MATLAB\'s results (computed at 0.65 / 35 kW) are not shown.'));
  else notes.push(`Uploaded trace: ${(R[arms[0]].seconds_simulated).toFixed(0)} s simulated (the last 30 s of a trace give the MPC its look-ahead). This is your data, not a paper result. The oracle sees the lead car's future, so it is a ceiling, not a deployable controller.`);
  $('tnote').innerHTML = notes.join('<br>');
  const first = R[arms[0]], t = first.trace.t, S = [Object.assign({ y: first.trace.lead, id: 'lead' }, LEAD, { n: rd ? 'Lead (slows for the breakers)' : 'Lead' })], G = [], E = [];
  if (rec) { S.push(Object.assign({ y: rec.trace.v, id: 'recorded' }, REC)); G.push(Object.assign({ y: rec.trace.gap, id: 'recorded' }, REC, { n: 'Recorded follower (gap sensor)' })); }
  arms.forEach(a => { const tr = R[a].trace, o = ARMS[a]; S.push(Object.assign({}, o, { id: a, n: o.name, y: tr.v })); G.push(Object.assign({}, o, { id: a, n: o.name, y: tr.gap })); E.push(Object.assign({}, o, { id: a, n: o.name, y: tr.wh })); });
  if (rd) { const vb = R[arms[0]].road.vb; S.push({ id: 'bspeed', n: `Breaker speed (${vb} m/s)`, c: 'var(--text3)', w: 1, dash: '1 4', y: t.map(() => vb) }); }
  if (mt) {   // MATLAB's own traces for the ACC and the MPC const-speed, dotted graphite on top of the website's lines
    arms.filter(a => a === 'acc' || a === 'mpc_const').forEach((a, i) => { const k = a === 'acc' ? 'acc' : 'mpc', o = { t: mt.t, c: 'var(--text)', w: 1.25, dash: '1.5 3', n: 'MATLAB R2024b', hide: i > 0, of: a }; S.push(Object.assign({ y: mt['v_' + k] }, o)); G.push(Object.assign({ y: mt['gap_' + k] }, o)); E.push(Object.assign({ y: mt['E_' + k + '_Wh'] }, o)); });
  }
  runScrubT = null;
  lineChart($('c1'), t, S, 'speed, m/s'); lineChart($('c2'), t, G, 'gap to lead, m'); lineChart($('c3'), t, E, 'cumulative battery energy, Wh');
  window.__lastRun = { R, rec, arms, mode, idx, eta, cap, secs, road };
  $('tab-matlab').hidden = true; $('mlpanel').innerHTML = ''; if (ml && arms.some(a => a === 'acc' || a === 'mpc_const')) buildMLTab(R, arms, mwin, ml);
  activateTab('table', false);
  showRoad(R, rec, arms, t);
}
/* ---- MATLAB tab: the MATLAB-made PNG next to the website's own small speed / gap / energy charts, plus the Wh/km comparison */
function buildMLTab(R, arms, mwin, ml) {
  const n = mwin.n, Z = String(n).padStart(2, '0'), A = arms.filter(a => a === 'acc' || a === 'mpc_const'), pn = $('mlpanel'), src = `/figures/matlab/traces_w${Z}.png?v=20261115m`;
  let rows = '', cap = [];
  A.forEach(a => { const o = R[a], m = ml[a]; rows += `<tr><td>${swatch(ARMS[a])} ${SHORT[a]}</td><td>${fmt(m.whkm_adj, 3)}</td><td>${fmt(o.whkm_adj, 3)}</td><td>${dp3(pct(o.whkm_adj, m.whkm_adj))}</td></tr>`; cap.push(`${SHORT[a]} ${fmt(m.whkm_adj, 3)} (MATLAB) and ${fmt(o.whkm_adj, 3)} (website) Wh/km`); });
  pn.innerHTML = `<div class="mlp"><figure class="mlfig"><button type="button" class="gal-b ml-b" id="mlimg-b" aria-label="Enlarge the MATLAB figure for window ${n}"><img id="mlimg" src="${src}" alt="MATLAB R2024b figure for window ${n}: lead and follower speed, gap and cumulative energy for the ACC and the MPC"></button><figcaption>Made by MATLAB R2024b (make_site_traces.m, exportgraphics) from its own simulation of window ${n}. Click to enlarge.</figcaption></figure>` +
    `<div class="mlside"><div class="mlh">This website, same window</div><div id="cm1" class="chartbox chart"></div><div id="cm2" class="chartbox chart"></div><div id="cm3" class="chartbox chart"></div></div></div>` +
    `<div class="tw"><table class="mlt"><tr><th>Controller</th><th>MATLAB Wh/km</th><th>Website Wh/km</th><th>Website vs MATLAB</th></tr>${rows}</table></div><div class="lim mut" style="margin-top:8px">Window ${n}: ${cap.join('; ')}. The dotted lines in the Speed, Gap and Energy tabs are MATLAB's own traces of this window.</div>`;
  const img = $('mlimg'), b = $('mlimg-b');
  img.onerror = () => { b.outerHTML = `<div class="rv-empty" style="min-height:120px">The MATLAB figure for window ${n} is not available.</div>`; };
  b.onclick = () => EVLB.open([{ src: img.currentSrc || img.src, alt: img.alt, cap: `MATLAB R2024b figure for window ${n}. ${cap.join('; ')}.` }], 0);
  const tr = R[A[0]].trace, W = (key, k) => A.map(a => Object.assign({}, ARMS[a], { id: a, n: SHORT[a], y: R[a].trace[key] })), o3 = { h: 150, noScrub: true, labelTop: true };
  lineChart($('cm1'), tr.t, [Object.assign({ y: tr.lead, id: 'lead' }, LEAD, { n: 'Lead' })].concat(W('v')), 'speed, m/s', Object.assign({}, o3, { legend: true }));
  lineChart($('cm2'), tr.t, W('gap'), 'gap to lead, m', Object.assign({}, o3, { legend: false }));
  lineChart($('cm3'), tr.t, W('wh'), 'cumulative battery energy, Wh', Object.assign({}, o3, { legend: false }));
  $('tab-matlab').hidden = false;
}
let rvRun = null;
function showRoad(R, rec0, arms0, t, keep) {
  if (!window.RoadView || !rvRun) return;
  const rec = rec0 && !HID.has('recorded') ? rec0 : null, arms = arms0.filter(a => !HID.has(a)), ri = R[arms0[0]].road || null;
  $('rv-empty').hidden = true; $('rv-run').hidden = false; $('rv-cap').hidden = false;
  $('rv-cap').textContent = 'Schematic replay of the computed window: positions come from the simulated speeds and gaps, and cars are drawn at 4.9 m (the length of the Polestar model used on Home).' + (rec ? ' The outline car is the recorded follower.' : '') + (ri ? ' Speed breakers are drawn as humps (the simulation treats each as a point).' : '') + (ri && ri.kind === 'potholes' ? ' Potholes are drawn as dark dips. Demo only, not part of the paper\'s results.' : '') + ' The cursor in the charts follows the replay.' + (HID.size ? ' Hidden controllers are not drawn.' : '');
  rvRun.setData({ t, lead: R[arms0[0]].trace.lead, x0: R[arms0[0]].trace.gap[0], obst: ri ? { breakers: ri.breakers, potholes: ri.potholes } : null, lanes: arms.map(a => ({ id: a, name: ARMS[a].name, short: SHORT[a], accent: a === 'mpc_const' || a === 'mpc_map_L', v: R[a].trace.v, gap: R[a].trace.gap, wh: R[a].trace.wh || null })), rec: rec ? { v: rec.trace.v, gap: rec.trace.gap, wh: rec.trace.wh || null } : null }, { autoplay: !keep, keep: !!keep });
}
READY.push(initUI);
