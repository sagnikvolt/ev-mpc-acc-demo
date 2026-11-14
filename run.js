'use strict';
/* /run/ page: simulation workbench (settings rail, road view, tiles, tabbed results, MATLAB side-by-side). Uses common.js. */
/* MATLAB check windows and traces (optional: a missing file just hides the feature) */
let MW = null, MT = null;
const getJSON = u => DESKTOP ? fetch(u).then(r => r.ok ? r.json() : null).catch(() => null) : Promise.resolve(null);
getJSON('/data/matlab_windows.json?v=20261114f').then(d => { MW = d && d.windows && d.windows.length === 10 ? d : null; if (!MW) $('mmodelab').hidden = true; else fillMWin(); });
getJSON('/data/matlab_traces.json?v=20261114f').then(d => { MT = d; });
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
  $('run').disabled = false; setChip('idle', 'Idle');
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
const RAIL_CTRL = '.rail input, .rail select, .rail textarea, .rail .alt, .rail .linkbtn';
function lockRail(v) { document.querySelectorAll(RAIL_CTRL).forEach(e => { e.disabled = v; }); }
function resetStage() {
  $('tab-matlab').hidden = true; $('mlpanel').innerHTML = ['t1m', 't3m'].map(i => { $(i).hidden = true; return ''; }).join(''); if ($('tab-matlab').getAttribute('aria-selected') === 'true') activateTab('table', false);
  hasRun = false; $('out').style.display = 'none'; $('empty').hidden = false; $('export').disabled = true; $('qd').hidden = true; $('qd').open = false; $('queue').innerHTML = ''; $('status').textContent = '';
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
  const qd = $('qd'), qsum = $('qsum'), failMsg = h => { st.innerHTML = h; qsum.textContent = 'Run did not start'; qd.hidden = false; qd.open = true; setChip('error', 'Error'); };
  if (!arms.length) { failMsg('<span class="err">Pick at least one controller.</span>'); return; }
  let up = null, idx = null;
  try {
    if (mode === 'upload') { up = parseTrace(); await call({ cmd: 'checkUpload', speeds: JSON.stringify(up.speeds), hz: up.hz, unit: $('unit').value }); }
    else if (mode === 'matlab') { if (!MW) throw new Error('The MATLAB check windows could not be loaded.'); idx = +$('mwin').value; up = { speeds: MW.windows[idx].speeds.map(Math.fround), hz: MW.meta.hz }; await call({ cmd: 'checkUpload', speeds: JSON.stringify(up.speeds), hz: up.hz, unit: 'mps' }); }
    else idx = +$('win').value;
  } catch (e) { failMsg(`<span class="err">${e.message.split('\n').filter(Boolean).pop()}</span>`); return; }
  running = true; hasRun = false; pvSeq++; lockRail(true); $('run').disabled = true; $('export').disabled = true; $('empty').hidden = false;
  const rows = arms.map(a => ({ k: a, name: ARMS[a].name, o: ARMS[a] })); if (mode === 'window') rows.push({ k: 'recorded', name: 'Recorded follower', o: REC });
  const q = $('queue'); qd.hidden = false; qd.open = true; qsum.textContent = `Running 0 of ${arms.length}`; q.innerHTML = rows.map(r => `<li data-k="${r.k}" data-s="wait">${swatch(r.o)}<span class="qn" title="${r.name}">${r.name}</span><span class="qt">waiting</span></li>`).join('');
  const qs = (k, s, t) => { const li = q.querySelector(`[data-k="${k}"]`); li.dataset.s = s; li.querySelector('.qt').textContent = t; };
  const t0 = performance.now(), R = {}; let rec = null, cur = null;
  try {
    for (let i = 0; i < arms.length; i++) {
      cur = arms[i]; qs(cur, 'run', 'running'); setChip('running', `Running ${i + 1} of ${arms.length}`); qsum.textContent = `Running ${i + 1} of ${arms.length}`;
      const m = mode === 'window' ? await call({ cmd: 'runWindow', arm: cur, idx, eta, cap }) : await call({ cmd: 'runUpload', arm: cur, speeds: JSON.stringify(up.speeds), hz: up.hz, unit: mode === 'matlab' ? 'mps' : $('unit').value, eta, cap });
      R[cur] = m.res; R[cur]._secs = m.secs; qs(cur, 'done', m.secs.toFixed(1) + ' s');
    }
    if (mode === 'window') { cur = 'recorded'; qs(cur, 'run', 'running'); qsum.textContent = 'Replaying the recorded follower'; const m = await call({ cmd: 'runWindow', arm: 'recorded', idx, eta, cap }); rec = m.res; qs(cur, 'done', m.secs.toFixed(1) + ' s'); }
  } catch (e) { st.innerHTML = `<span class="err">${e.message.split('\n').filter(Boolean).pop()}</span>`; if (cur) qs(cur, 'err', 'error'); qsum.textContent = 'Run failed'; setChip('error', 'Error'); running = false; lockRail(false); $('run').disabled = false; return; }
  const secs = (performance.now() - t0) / 1000; st.innerHTML = `Computed on your device in <span class="ro">${secs.toFixed(1)} s</span> Nothing was sent to a server`; qsum.textContent = `Last run: ${secs.toFixed(1)} s`; qd.open = false;
  setChip('done', `Done in ${secs.toFixed(1)} s`); running = false; lockRail(false); $('run').disabled = false;
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
  const n = mwin.n, Z = String(n).padStart(2, '0'), A = arms.filter(a => a === 'acc' || a === 'mpc_const'), pn = $('mlpanel'), src = `/figures/matlab/traces_w${Z}.png?v=20261114f`;
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
READY.push(initUI);
