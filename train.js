'use strict';
/* /train/ page: model-training workbench. Uses common.js. */
/* ---------------- train panel (workbench: rail, tiles, tabs) ---------------- */
$('size').oninput = updSize; function updSize() { const n = SIZES[+$('size').value]; $('sizev').textContent = n ? `About ${n.toLocaleString()} samples (whole trips)` : 'All training samples (about 165,000, 54 trips)'; } updSize();
READY.push(() => { $('train').disabled = false; setTChip('idle', 'Idle'); });
const TNAMES = { ridge: 'Ridge', knn: 'KNN (k=25, 70k-row subsample)', svr: 'SVR (RBF, 8k subset)', lgbm: 'LightGBM (400 trees)' }, TSHORT = { ridge: 'Ridge', knn: 'KNN', svr: 'SVR', lgbm: 'LightGBM' }, TMODE = { resid: 'physics + ML residual', pure: 'pure ML (no physics)' };
const TTABS = ['imp', 'curve', 'table', 'runs'], RUNS = []; let mlSeen = false, bmwSeen = false, tRunning = false, tLast = null;
const TRAIN_CTRL = '.rail input, .rail select, .rail .alt';
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
  $('tqd').hidden = false; $('tqd').open = true; $('tqsum').textContent = 'Training'; tRunning = true; lockTrain(true); $('train').disabled = true; $('texport').disabled = true; st.textContent = ''; resetTiles(); tSteps(imp); tLast = null;
  $('tout').style.display = 'none'; $('tempty').hidden = false; $('tempty-p').textContent = 'Training in your browser. The result appears here when it finishes.';
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
    st.innerHTML = `Computed on your device in <span class="ro">${secs.toFixed(1)} s</span> Nothing was sent to a server`; setTChip('done', `Done in ${secs.toFixed(1)} s`); $('tqsum').textContent = `Last run: ${secs.toFixed(1)} s`; $('tqd').open = false;
    renderTrain(r, model, mode, n, secs, imp);
  } catch (e) { st.innerHTML = `<span class="err">${e.message.split('\n').filter(Boolean).pop()}</span>`; if (cur) tq(cur, 'err', 'error'); setTChip('error', 'Error'); $('tqsum').textContent = 'Run failed'; $('tqd').open = true; $('tempty-p').textContent = 'The run did not finish. See the message under the steps in the settings.'; }
  progressSink = null; if (readyInfo) $('lmsg').textContent = 'Engine ready · ' + readyInfo.secs.toFixed(1) + ' s on your device'; tRunning = false; lockTrain(false); $('train').disabled = false; $('texport').disabled = RUNS.length === 0;
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
