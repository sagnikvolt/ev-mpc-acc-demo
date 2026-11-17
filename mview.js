'use strict';
/* Train it: "Model view". Two kinds of picture, always labelled:
   1. ILLUSTRATION (while training, and on request afterwards): a short looping sketch of how the chosen model learns, drawn on a small made-up toy data set (deterministic, generated below).
      The boosting, ridge, k-nearest-neighbour and tube steps are real algorithms run on that toy data; none of it is your data or your model.
   2. YOUR MODEL (after training): views computed by the worker from the fitted model and the fold-0 held-out trips (py/demo_core.py, model_views). Nothing here is typed by hand.
   Reduced motion: the final frame is shown and nothing loops. */
(function () {
  const $ = id => document.getElementById(id), card = $('mview'); if (!card) return;
  const rm = () => !!((window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) || document.documentElement.classList.contains('rm'));
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const F = (x, d) => (d === undefined ? x.toFixed(1) : x.toFixed(d)).replace('-', '−');
  const cl = (v, a, b) => Math.max(a, Math.min(b, v)), lerp = (a, b, u) => a + (b - a) * u, ease = u => (u = cl(u, 0, 1), u * u * (3 - 2 * u)), seg = (t, a, b) => cl((t - a) / (b - a), 0, 1);
  const NAMES = { lgbm: 'LightGBM', ridge: 'Ridge', knn: 'KNN', svr: 'SVR' };
  const FN = { v: 'speed', a: 'acceleration', gr: 'road grade', v2: 'speed squared', av: 'speed x accel.', heat: 'cabin heating', ac: 'air-con', amb: 'ambient temp.', bt: 'battery temp.', soc: 'state of charge', v_l2: 'speed, lag 2', v_l5: 'speed, lag 5', a_l2: 'accel., lag 2', a_l5: 'accel., lag 5', v_m5: 'speed, mean 5', a_m5: 'accel., mean 5', Pw: 'physics wheel power' };
  function ticks(lo, hi, n) { const raw = (hi - lo) / n, p = Math.pow(10, Math.floor(Math.log10(raw))), st = [1, 2, 2.5, 5, 10].map(k => k * p).find(v => v >= raw) || raw, o = []; for (let v = Math.ceil(lo / st - 1e-9) * st; v <= hi + 1e-9; v += st) o.push(+v.toFixed(10)); return o; }
  const dec = s => (s >= 1 ? 0 : s >= 0.1 ? 1 : 2);
  const path = (xs, ys, X, Y, n) => { let d = ''; const m = n === undefined ? xs.length : n; for (let i = 0; i < m; i++) d += (i ? 'L' : 'M') + X(xs[i]).toFixed(1) + ' ' + Y(ys[i]).toFixed(1); return d; };
  /* ---------------- toy data (illustration only) ---------------- */
  const rng = seed => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
  const gauss = r => Math.sqrt(-2 * Math.log(r() + 1e-9)) * Math.cos(6.2832 * r());
  const TOY = (() => { const r = rng(11), n = 56, x = [], y = [], ph = []; for (let i = 0; i < n; i++) { const xi = (i + 0.5) / n, p = 0.2 + 0.45 * xi, g = 0.2 * Math.sin(6.2832 * 1.25 * xi) + 0.08 * Math.sin(6.2832 * 3.3 * xi); x.push(xi); ph.push(p); y.push(p + g + 0.045 * gauss(r)); } return { n, x, y, ph, res: y.map((v, i) => v - ph[i]) }; })();
  const TOY2 = (() => { const r = rng(5), n = 150, a = [], b = [], v = []; for (let i = 0; i < n; i++) { const p = r(), q = r(); a.push(p); b.push(q); v.push(cl(0.5 + 0.9 * Math.sin(4 * p) * 0.35 + 0.6 * (q - 0.5) + 0.06 * gauss(r), 0, 1)); } return { n, a, b, v }; })();
  const GRID = Array.from({ length: 121 }, (_, i) => i / 120);
  const boostCache = {};
  function boost(T, key) {   // gradient boosting with stumps (depth 1), learning rate 0.35, 14 rounds: the real algorithm on the toy data
    if (boostCache[key]) return boostCache[key]; const n = TOY.n, x = TOY.x, K = 14, lr = 0.35, m0 = T.reduce((s, v) => s + v, 0) / n, pred = new Array(n).fill(m0), stumps = [], rmse = [], curves = [];
    const rm_ = () => Math.sqrt(pred.reduce((s, p, i) => s + (T[i] - p) * (T[i] - p), 0) / n), ev = () => GRID.map(g => m0 + stumps.reduce((s, st) => s + (g < st.th ? st.l : st.r), 0));
    rmse.push(rm_()); curves.push(GRID.map(() => m0));
    for (let k = 0; k < K; k++) {
      let best = null; const res = T.map((v, i) => v - pred[i]);
      for (let j = 3; j < n - 3; j++) { let sl = 0, sr = 0; for (let i = 0; i < n; i++) { if (i < j) sl += res[i]; else sr += res[i]; } const l = sl / j, r = sr / (n - j); let e = 0; for (let i = 0; i < n; i++) { const d = res[i] - (i < j ? l : r); e += d * d; } if (!best || e < best.e) best = { e, th: (x[j - 1] + x[j]) / 2, l: l * lr, r: r * lr, j }; }
      stumps.push(best); for (let i = 0; i < n; i++) pred[i] += x[i] < best.th ? best.l : best.r; rmse.push(rm_()); curves.push(ev());
    }
    return (boostCache[key] = { K, rmse, curves, stumps, m0 });
  }
  /* ---------------- drawing helpers ---------------- */
  function frame(W, H, m, xr, yr, o) {   // axes + grid; returns X, Y and the svg string
    o = o || {}; const X = v => m.l + (v - xr[0]) / (xr[1] - xr[0]) * (W - m.l - m.r), Y = v => H - m.b - (v - yr[0]) / (yr[1] - yr[0]) * (H - m.t - m.b); let g = '';
    const ty = o.yt || ticks(yr[0], yr[1], 4), tx = o.xt || ticks(xr[0], xr[1], W < 480 ? 4 : 6), sy = ty.length > 1 ? ty[1] - ty[0] : 1, sx = tx.length > 1 ? tx[1] - tx[0] : 1;
    if (!o.noY) ty.forEach(v => { g += `<line class="grid-h" x1="${m.l}" x2="${W - m.r}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${m.l - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${o.yfmt ? o.yfmt(v) : F(v, dec(sy))}</text>`; });
    if (!o.noX) tx.forEach(v => { g += `<text x="${X(v).toFixed(1)}" y="${H - m.b + 15}" text-anchor="middle">${o.xfmt ? o.xfmt(v) : F(v, dec(sx))}</text>`; });
    if (o.xl) g += `<text x="${(m.l + W - m.r) / 2}" y="${H - 4}" text-anchor="middle">${o.xl}</text>`; if (o.yl) g += `<text x="${m.l}" y="${m.t - 10}">${o.yl}</text>`;
    return { X, Y, g };
  }
  const note = (x, y, s, cls, anchor) => `<text class="${cls || ''}" x="${x}" y="${y}"${anchor ? ` text-anchor="${anchor}"` : ''}>${s}</text>`;
  const trees = (x0, y0, n, cur, w) => { let g = ''; for (let k = 0; k < n; k++) { const x = x0 + k * w, on = k < cur, c = on ? 'var(--accent)' : 'var(--line2)'; g += `<g style="stroke:${c};fill:none;stroke-width:1.5;opacity:${on ? 1 : 0.55}"><path d="M${x + w * 0.4} ${y0}v-6M${x + w * 0.4} ${y0 - 6}l-${w * 0.3} -${6}M${x + w * 0.4} ${y0 - 6}l${w * 0.3} -${6}"/><circle cx="${x + w * 0.4}" cy="${y0}" r="1.6" style="fill:${c}"/></g>`; } return g; };
  /* ---------------- illustration scenes: each returns { dur, draw(W,H,t) -> {svg, cap} } ---------------- */
  const M0 = { l: 40, r: 10, t: 26, b: 30 };
  function act0(resid) {   // physics first, then the gap: only when the target is the residual
    const T = 3.8;
    return { dur: T, cap: 'Step 1 (physics + residual): the physics model gives a first guess (dashed line). The gap between it and the measured power is what the machine-learning model is asked to learn. The picture then switches to that leftover.', draw(W, H, t, side) {
      const mix = ease(seg(t, 2.6, 3.7)), yr = [lerp(0, -0.38, mix), lerp(1.0, 0.38, mix)], f = frame(W - side, H, M0, [0, 1], yr, { yt: mix > 0.5 ? [-0.3, 0, 0.3] : [0, 0.5, 1], noX: true, yl: mix > 0.5 ? 'leftover = measured − physics (toy units)' : 'battery power (toy units)', xl: 'driving conditions (toy)', yfmt: v => F(v, 1) }), X = f.X, Y = f.Y; let g = f.g;
      const pa = ease(seg(t, 0.6, 1.6)), ga = seg(t, 1.6, 2.4), nP = Math.round(TOY.n * seg(t, 0, 0.6));
      for (let i = 0; i < TOY.n; i++) { if (i >= nP) break; const yy = TOY.y[i] - mix * TOY.ph[i]; if (ga > 0 && mix < 1) g += `<line x1="${X(TOY.x[i]).toFixed(1)}" x2="${X(TOY.x[i]).toFixed(1)}" y1="${Y(TOY.ph[i] - mix * TOY.ph[i]).toFixed(1)}" y2="${Y(yy).toFixed(1)}" style="stroke:var(--accent);stroke-width:1.5;opacity:${(0.55 * ga).toFixed(2)}"/>`; g += `<circle cx="${X(TOY.x[i]).toFixed(1)}" cy="${Y(yy).toFixed(1)}" r="3" style="fill:var(--text2);fill-opacity:.8"/>`; }
      const np = Math.max(2, Math.round(60 * pa)); g += `<path class="ln" d="${path(GRID.slice(0, np), GRID.slice(0, np).map(x => 0.2 + 0.45 * x - mix * (0.2 + 0.45 * x)), X, Y)}" style="stroke:var(--text);stroke-width:1.75;stroke-dasharray:6 4"/>`;
      if (t > 1.0 && mix < 0.9) g += note(X(0.03), Y(0.2 + 0.45 * 0.03) - 10, 'physics model', 'mv-lab'); if (ga > 0.6 && mix < 0.5) g += note(X(0.97), Y(0.12), 'teal bars = what physics misses', 'mv-lab acc', 'end'); if (mix > 0.9) g += note(X(0.97), Y(0.34), 'next: the model learns this leftover', 'mv-lab acc', 'end');
      return g; } };
  }
  function sceneLgbm(resid) {
    const T = resid ? TOY.res : TOY.y, B = boost(T, resid ? 'r' : 'y'), per = 0.8, T0 = 0.6, dur = T0 + B.K * per + 1.6, yr = resid ? [-0.38, 0.38] : [0, 1.0];
    return { dur, cap: (resid ? 'Step 2: ' : '') + 'LightGBM builds small decision trees one after another. Each new tree is fitted to the error the trees before it leave behind, and its answer is added with a small weight, so the leftover error (bar, right) keeps shrinking. The real model uses 400 trees on your inputs; this sketch uses 14 one-split trees on made-up data.', draw(W, H, t, side) {
      const f = frame(W - side, H - 22, M0, [0, 1], yr, { noX: true, yfmt: v => F(v, 1), yl: (resid ? 'leftover' : 'power') + ' (toy units)' }), X = f.X, Y = f.Y; let g = f.g;
      const k = Math.min(B.K, Math.max(0, Math.floor((t - T0) / per))), u = ease(seg((t - T0) / per - k, 0.3, 1)), cur = t < T0 ? 0 : k, nxt = Math.min(B.K, cur + 1), showRes = t >= T0 && cur < B.K && (t - T0) / per - cur < 0.3;
      const c0 = B.curves[cur], c1 = B.curves[nxt], cv = c0.map((v, i) => lerp(v, c1[i], cur < B.K && t >= T0 ? u : 0));
      for (let i = 0; i < TOY.n; i++) { const yc = (t < T0 ? B.curves[0] : cv)[Math.round(TOY.x[i] * 120)]; if (showRes) g += `<line x1="${X(TOY.x[i]).toFixed(1)}" x2="${X(TOY.x[i]).toFixed(1)}" y1="${Y(yc).toFixed(1)}" y2="${Y(T[i]).toFixed(1)}" style="stroke:var(--accent);stroke-width:1.5;opacity:.5"/>`; g += `<circle cx="${X(TOY.x[i]).toFixed(1)}" cy="${Y(T[i]).toFixed(1)}" r="3" style="fill:var(--text2);fill-opacity:.8"/>`; }
      g += `<path class="ln" d="${path(GRID, t < T0 ? B.curves[0] : cv, X, Y)}" style="stroke:var(--accent);stroke-width:2.25"/>`;
      const sy = H - 8, w = Math.min(22, (W - side - 60) / B.K); g += note(M0.l, sy - 14, 'trees so far', 'mv-lab') + trees(M0.l + 70, sy, B.K, cur + (t >= T0 && cur < B.K && (t - T0) / per - cur > 0.3 ? 1 : 0), w);
      if (side) { const e = lerp(B.rmse[cur], B.rmse[nxt], cur < B.K && t >= T0 ? u : 0), x0 = W - side + 14, bw = side - 28, e0 = B.rmse[0]; g += note(x0, M0.t + 8, resid ? 'leftover error' : 'error', 'mv-lab') + `<rect x="${x0}" y="${M0.t + 18}" width="${bw}" height="9" rx="2" style="fill:var(--line)"/><rect x="${x0}" y="${M0.t + 18}" width="${(bw * e / e0).toFixed(1)}" height="9" rx="2" style="fill:var(--accent)"/>` + note(x0, M0.t + 48, F(e, 3), 'mv-big') + note(x0, M0.t + 64, 'toy units', 'mv-lab') + note(x0, M0.t + 96, 'tree ' + Math.min(B.K, cur + (t >= T0 && (t - T0) / per - cur > 0.3 ? 1 : 0)) + ' of ' + B.K, 'mv-lab'); }
      return g; } };
  }
  function sceneRidge(resid) {
    const T = resid ? TOY.res : TOY.y, n = TOY.n, x = TOY.x, mx = x.reduce((s, v) => s + v, 0) / n, my = T.reduce((s, v) => s + v, 0) / n; let sxx = 0, sxy = 0; for (let i = 0; i < n; i++) { sxx += (x[i] - mx) * (x[i] - mx); sxy += (x[i] - mx) * (T[i] - my); }
    const lam = 6, wO = sxy / sxx, wR = sxy / (sxx + lam), yr = resid ? [-0.38, 0.38] : [0, 1.0], dur = 6.5;
    return { dur, cap: (resid ? 'Step 2: ' : '') + 'Ridge fits one straight line. A penalty on the size of the slope (the "weight") stops it from growing large to chase noise, so the settled line (teal) is flatter than the unpenalised one (dashed). The real model has one weight per input; this sketch has one input and made-up data.', draw(W, H, t, side) {
      const f = frame(W - side, H, M0, [0, 1], yr, { noX: true, yfmt: v => F(v, 1), yl: (resid ? 'leftover' : 'power') + ' (toy units)', xl: 'one input (toy)' }), X = f.X, Y = f.Y; let g = f.g;
      for (let i = 0; i < n; i++) g += `<circle cx="${X(x[i]).toFixed(1)}" cy="${Y(T[i]).toFixed(1)}" r="3" style="fill:var(--text2);fill-opacity:.8"/>`;
      const u = seg(t, 0.4, 5.0), w = wR * (1 - Math.exp(-4 * u) * Math.cos(7 * u)), ln = (ww, s) => `<path class="ln" d="M${X(0).toFixed(1)} ${Y(my + ww * (0 - mx)).toFixed(1)}L${X(1).toFixed(1)} ${Y(my + ww * (1 - mx)).toFixed(1)}" style="${s}"/>`;
      g += (t > 0.2 ? ln(wO, 'stroke:var(--text3);stroke-width:1.5;stroke-dasharray:6 4') : '') + ln(u > 0 ? w : 0, 'stroke:var(--accent);stroke-width:2.25');
      if (t > 0.3) g += note(X(0.02), Y(my + wO * (0.02 - mx)) + (wO >= 0 ? 16 : -8), 'no penalty', 'mv-lab');
      if (side) { const x0 = W - side + 14, bw = side - 28, big = Math.max(Math.abs(wO), 1e-6); g += note(x0, M0.t + 8, 'size of the slope', 'mv-lab') + `<rect x="${x0}" y="${M0.t + 18}" width="${bw}" height="9" rx="2" style="fill:var(--line)"/><rect x="${x0}" y="${M0.t + 18}" width="${(bw * Math.min(1, Math.abs(u > 0 ? w : 0) / big)).toFixed(1)}" height="9" rx="2" style="fill:var(--accent)"/><rect x="${x0}" y="${M0.t + 34}" width="${bw}" height="4" rx="1" style="fill:var(--line)"/><rect x="${x0}" y="${M0.t + 34}" width="${bw}" height="4" rx="1" style="fill:var(--text3);opacity:.7"/>` + note(x0, M0.t + 62, 'penalised ' + F(Math.abs(u > 0 ? w : 0), 2), 'mv-lab acc') + note(x0, M0.t + 78, 'no penalty ' + F(Math.abs(wO), 2), 'mv-lab') + note(x0, M0.t + 106, 'toy units', 'mv-lab'); }
      return g; } };
  }
  function sceneKnn(resid) {
    const D = TOY2, q = { a: 0.58, b: 0.46 }, order = D.a.map((_, i) => ({ i, d: Math.hypot(D.a[i] - q.a, D.b[i] - q.b) })).sort((p, r) => p.d - r.d).slice(0, 25), rad = order[24].d, avg = order.reduce((s, o) => s + D.v[o.i], 0) / 25, dur = 8.4;
    return { dur, cap: (resid ? 'Step 2: ' : '') + 'KNN keeps the training moments it was given. For a new moment it finds the 25 most similar ones (here by two inputs; the real model compares all inputs), then averages what they did (closer neighbours count a little more). The average is the prediction. Made-up data.', draw(W, H, t, side) {
      const f = frame(W - side, H, M0, [0, 1], [0, 1], { noX: true, noY: true, xl: 'speed (toy)', yl: 'acceleration (toy)' }), X = f.X, Y = f.Y; let g = f.g;
      const lit = Math.floor(seg(t, 1.6, 5.0) * 25 + 1e-6), arrive = ease(seg(t, 0, 1.3)), qx = lerp(0.08, q.a, arrive), qy = lerp(0.9, q.b, arrive), isNb = new Array(D.n).fill(-1); for (let k = 0; k < lit; k++) isNb[order[k].i] = k;
      for (let i = 0; i < D.n; i++) if (isNb[i] < 0) g += `<circle cx="${X(D.a[i]).toFixed(1)}" cy="${Y(D.b[i]).toFixed(1)}" r="3" style="fill:var(--text3);fill-opacity:${(0.15 + 0.5 * D.v[i]).toFixed(2)}"/>`;
      if (t > 5.0) g += `<ellipse cx="${X(q.a).toFixed(1)}" cy="${Y(q.b).toFixed(1)}" rx="${(rad * (W - side - M0.l - M0.r) * ease(seg(t, 5.0, 5.8))).toFixed(1)}" ry="${(rad * (H - M0.t - M0.b) * ease(seg(t, 5.0, 5.8))).toFixed(1)}" style="fill:var(--accent-soft);stroke:var(--accent);stroke-width:1;stroke-dasharray:4 3"/>`;
      for (let k = 0; k < lit; k++) { const i = order[k].i; g += `<line x1="${X(q.a).toFixed(1)}" y1="${Y(q.b).toFixed(1)}" x2="${X(D.a[i]).toFixed(1)}" y2="${Y(D.b[i]).toFixed(1)}" style="stroke:var(--accent);stroke-width:1;opacity:.35"/><circle cx="${X(D.a[i]).toFixed(1)}" cy="${Y(D.b[i]).toFixed(1)}" r="4" style="fill:var(--accent);fill-opacity:${(0.3 + 0.7 * D.v[i]).toFixed(2)};stroke:var(--accent)"/>`; }
      g += `<circle cx="${X(qx).toFixed(1)}" cy="${Y(qy).toFixed(1)}" r="6" style="fill:var(--card);stroke:var(--text);stroke-width:2"/>` + note(X(qx) + 10, Y(qy) - 8, 'new moment', 'mv-lab');
      if (side) { const x0 = W - side + 14, bw = side - 28; g += note(x0, M0.t + 8, 'what the neighbours did', 'mv-lab'); for (let k = 0; k < lit; k++) g += `<rect x="${x0}" y="${M0.t + 16 + k * 7}" width="${(bw * D.v[order[k].i]).toFixed(1)}" height="5" rx="1" style="fill:var(--accent);opacity:.75"/>`; if (t > 5.8) { const a = ease(seg(t, 5.8, 6.6)); g += `<line x1="${x0 + bw * avg}" x2="${x0 + bw * avg}" y1="${M0.t + 12}" y2="${M0.t + 196}" style="stroke:var(--text);stroke-width:1.5;opacity:${a}"/>` + note(x0, M0.t + 214, 'average = prediction', 'mv-lab acc'); } }
      return g; } };
  }
  function sceneSvr(resid) {
    const T = resid ? TOY.res : TOY.y, n = TOY.n, x = TOY.x, bw = 0.07, ctr = GRID.map(g0 => { let s = 0, w = 0; for (let i = 0; i < n; i++) { const k = Math.exp(-0.5 * ((g0 - x[i]) / bw) ** 2); s += k * T[i]; w += k; } return s / w; }), at = v => ctr[Math.round(v * 120)], eps = 0.06, yr = resid ? [-0.38, 0.38] : [0, 1.0];
    const isSv = T.map((v, i) => Math.abs(v - at(x[i])) >= eps), order = x.map((_, i) => i).filter(i => isSv[i]), nSv = order.length, dur = 7.2;
    return { dur, cap: (resid ? 'Step 2: ' : '') + 'SVR fits a smooth curve with a tube of fixed width around it. Points inside the tube cost nothing. Only points on or outside the tube (lit, "support vectors") pull on the curve. Here the curve is a smooth stand-in drawn around made-up data; the real model finds its curve by an optimisation on your inputs.', draw(W, H, t, side) {
      const f = frame(W - side, H, M0, [0, 1], yr, { noX: true, yfmt: v => F(v, 1), yl: (resid ? 'leftover' : 'power') + ' (toy units)', xl: 'one input (toy)' }), X = f.X, Y = f.Y; let g = f.g;
      const cu = seg(t, 0.4, 2.4), np = Math.max(2, Math.round(120 * cu)), ta = ease(seg(t, 2.4, 3.4)), lit = Math.floor(seg(t, 3.4, 6.2) * nSv + 1e-6), litSet = new Set(order.slice(0, lit));
      if (ta > 0) g += `<path d="${path(GRID, ctr.map(v => v + eps), X, Y)}L${path(GRID.slice().reverse(), ctr.slice().reverse().map(v => v - eps), X, Y).slice(1)}Z" style="fill:var(--accent-soft);stroke:none;opacity:${ta}"/>`;
      for (let i = 0; i < n; i++) { const on = litSet.has(i); g += `<circle cx="${X(x[i]).toFixed(1)}" cy="${Y(T[i]).toFixed(1)}" r="${on ? 4.2 : 3}" style="fill:${on ? 'var(--accent)' : 'var(--text2)'};fill-opacity:${on ? 1 : 0.55};stroke:${on ? 'var(--accent)' : 'none'}"/>`; }
      g += `<path class="ln" d="${path(GRID.slice(0, np), ctr.slice(0, np), X, Y)}" style="stroke:var(--accent);stroke-width:2.25"/>`;
      if (side) { const x0 = W - side + 14; g += note(x0, M0.t + 8, 'support vectors', 'mv-lab') + note(x0, M0.t + 40, lit + ' of ' + n, 'mv-big') + note(x0, M0.t + 58, 'on or outside the tube', 'mv-lab'); }
      return g; } };
  }
  const SCENES = { lgbm: sceneLgbm, ridge: sceneRidge, knn: sceneKnn, svr: sceneSvr };
  function illustration(model, mode) {
    const resid = mode === 'resid', a0 = resid ? act0(true) : null, a1 = SCENES[model](resid), hold = 1.4, total = (a0 ? a0.dur : 0) + a1.dur + hold;
    return { dur: total, loop: true, draw(W, H, t) { const side = W >= 560 ? 170 : 0; let act = 1, tt = t - (a0 ? a0.dur : 0); if (a0 && t < a0.dur) { act = 0; tt = t; } return { svg: (act ? a1 : a0).draw(W, H, Math.min(tt, act ? a1.dur : a0.dur), side), cap: (act ? a1 : a0).cap, act }; } };
  }
  /* ---------------- real views from the worker ---------------- */
  function realTrip(V, show, model) {
    const tr = V.trip, dur = 2.8;
    return { dur, loop: false, cap: `Trip ${tr.id} of the 14 held-out trips of fold 0: the trip whose energy error (${F(tr.err_pct, 1)}%) is closest to the median of the 14 absolute errors. Measured battery power, your ${NAMES[model]} model's prediction${show ? ' and the physics model alone (dashed)' : ''}. RMSE on this trip: model ${F(tr.rmse_kw, 2)} kW, physics alone ${F(tr.phys_rmse_kw, 2)} kW. The line is drawn from every ${tr.stride === 1 ? '' : tr.stride + 'th '}sample of the 0.5 s data.`, draw(W, H, t) {
      const lo = Math.min(...tr.meas, ...tr.pred, ...tr.phys), hi = Math.max(...tr.meas, ...tr.pred, ...tr.phys), T = tr.t[tr.t.length - 1], f = frame(W, H, { l: 44, r: 12, t: 28, b: 34 }, [0, T], [lo, hi], { yl: 'battery power, kW', xl: 'time in the trip, s' }), p = ease(seg(t, 0, 2.6)), n = Math.max(2, Math.round(tr.t.length * p)); let g = f.g;
      if (show) g += `<path class="ln" d="${path(tr.t, tr.phys, f.X, f.Y, n)}" style="stroke:var(--text3);stroke-width:1.25;stroke-dasharray:5 4"/>`;
      g += `<path class="ln" d="${path(tr.t, tr.meas, f.X, f.Y, n)}" style="stroke:var(--text);stroke-width:1.5"/><path class="ln" d="${path(tr.t, tr.pred, f.X, f.Y, n)}" style="stroke:var(--accent);stroke-width:2"/>`;
      g += `<g transform="translate(${W - 12},${22})" text-anchor="end"><text class="mv-lab" x="0" y="0">measured <tspan style="fill:var(--text)">—</tspan>  model <tspan style="fill:var(--accent)">—</tspan>${show ? '  physics only <tspan style="fill:var(--text3)">- -</tspan>' : ''}</text></g>`; return { svg: g, cap: this.cap }; } };
  }
  function realLgbm(V) {
    const tr = V.trees, dur = 2.6, mn = Math.min(...tr.rmse_kw), imin = tr.rmse_kw.indexOf(mn), last = tr.rmse_kw[tr.rmse_kw.length - 1];
    return { dur, loop: false, cap: `Held-out RMSE of your LightGBM model (all 14 held-out trips) when only the first k trees are used. It ${imin === tr.k.length - 1 ? 'is lowest with all trees' : 'is lowest with ' + tr.k[imin] + ' trees (' + F(mn, 3) + ' kW); with all ' + tr.k[tr.k.length - 1] + ' trees it is ' + F(last, 3) + ' kW, the number reported above'}. Dashed line: the physics model alone (${F(V.phys_rmse_kw, 2)} kW). The model was not changed: the first k trees are read from the fitted model.`, draw(W, H, t) {
      const ys = tr.rmse_kw.concat([V.phys_rmse_kw]), lo = Math.min(...ys) * 0.96, hi = Math.max(...ys) * 1.04, K = tr.k[tr.k.length - 1], f = frame(W, H, { l: 44, r: 14, t: 28, b: 34 }, [0, K], [lo, hi], { yl: 'held-out RMSE, kW', xl: 'number of trees used', xt: [0, 100, 200, 300, 400] }), p = seg(t, 0, 2.2) * (tr.k.length - 1), full = Math.floor(p), fr = p - full; let g = f.g;
      g += `<line x1="${f.X(0)}" x2="${f.X(K)}" y1="${f.Y(V.phys_rmse_kw).toFixed(1)}" y2="${f.Y(V.phys_rmse_kw).toFixed(1)}" style="stroke:var(--text3);stroke-width:1.25;stroke-dasharray:5 4"/>` + note(f.X(K), f.Y(V.phys_rmse_kw) - 6, 'physics alone', 'mv-lab', 'end');
      const xs = tr.k.slice(0, full + 1), ysd = tr.rmse_kw.slice(0, full + 1); if (full < tr.k.length - 1) { xs.push(lerp(tr.k[full], tr.k[full + 1], fr)); ysd.push(lerp(tr.rmse_kw[full], tr.rmse_kw[full + 1], fr)); }
      g += `<path class="ln" d="${path(xs, ysd, f.X, f.Y)}" style="stroke:var(--accent);stroke-width:2.25"/>`; tr.k.forEach((k, i) => { if (i <= full) g += `<circle cx="${f.X(k).toFixed(1)}" cy="${f.Y(tr.rmse_kw[i]).toFixed(1)}" r="${i === imin && t > 2.2 ? 5 : 3.5}" style="fill:${i === imin ? 'var(--accent)' : 'var(--card)'};stroke:var(--accent);stroke-width:1.5"><title>${k} trees: ${F(tr.rmse_kw[i], 3)} kW</title></circle>`; });
      if (t > 2.2) g += note(f.X(tr.k[imin]) + (imin > tr.k.length / 2 ? -8 : 8), f.Y(mn) + 18, (imin === tr.k.length - 1 ? 'lowest: ' : 'lowest: ') + F(mn, 3) + ' kW at ' + tr.k[imin] + ' trees', 'mv-lab acc', imin > tr.k.length / 2 ? 'end' : 'start'); return { svg: g, cap: this.cap }; } };
  }
  function realRidge(V) {
    const c = V.coef, idx = c.names.map((_, i) => i).sort((a, b) => Math.abs(c.kw_per_sd[b]) - Math.abs(c.kw_per_sd[a])), mx = Math.max(...c.kw_per_sd.map(Math.abs)), dur = 2.4;
    return { dur, loop: false, cap: `The fitted Ridge weights (penalty alpha ${c.alpha}), each for one input after it is standardised (kW of the model's output per 1 standard deviation of that input). Teal: pushes the output up; grey: pushes it down. Speed and its lagged copies are almost the same number, so the model shares weight between them with opposite signs that largely cancel: read them as a group, not one by one.${V.target === 'residual' ? ' The output is the leftover added to the physics model.' : ''}`, draw(W, H, t) {
      const rows = idx.length, rh = Math.min(17, (H - 40) / rows), m = { l: 150, r: 20, t: 26 }, half = (W - m.l - m.r) / 2 - 32, xc = m.l + 30 + half; let g = note(m.l, 14, 'weight, kW per standard deviation of the input', 'mv-lab') + `<line x1="${xc}" x2="${xc}" y1="${m.t - 4}" y2="${m.t + rows * rh}" style="stroke:var(--line2)"/>`;
      idx.forEach((ix, r) => { const v = c.kw_per_sd[ix], a = ease(seg(t, r * 0.05, r * 0.05 + 1.2)), w = half * Math.abs(v) / mx * a, y = m.t + r * rh; g += note(m.l - 8, y + rh * 0.68, esc(FN[c.names[ix]] || c.names[ix]), 'mv-lab', 'end') + `<rect x="${(v >= 0 ? xc : xc - w).toFixed(1)}" y="${(y + 2).toFixed(1)}" width="${w.toFixed(1)}" height="${(rh - 5).toFixed(1)}" rx="2" style="fill:${v >= 0 ? 'var(--accent)' : 'var(--text3)'}"><title>${esc(c.names[ix])}: ${F(v, 2)} kW per SD</title></rect>` + (a > 0.9 ? note(v >= 0 ? xc + w + 5 : xc - w - 5, y + rh * 0.68, F(v, 1), 'mv-lab', v >= 0 ? 'start' : 'end') : ''); });
      return { svg: g, cap: this.cap }; } };
  }
  function realKnn(V) {
    const k = V.knn, dur = 3.8, nb = k.nb, side = 0;
    return { dur, loop: false, cap: `One held-out moment from trip ${V.trip.id} (at ${F(k.q.t, 0)} s: ${F(k.q.v * 3.6, 0)} km/h, acceleration ${F(k.q.a, 2)} m/s²; picked by a fixed rule, not by result: the moment with about the 90th-percentile acceleration while moving). Your KNN model found the 25 nearest of its ${k.n_fit.toLocaleString('en-US')} stored moments. Distance is measured over all inputs, so in this speed-acceleration picture neighbours need not look close. ${V.target === 'residual' ? 'Each neighbour’s value is its leftover (measured minus physics)' : 'Each neighbour’s value is its measured power'}; the distance-weighted average is ${F(k.avg_kw, 1)} kW${V.target === 'residual' ? ', and physics (' + F(k.phys_kw, 1) + ' kW) plus that gives the prediction ' + F(k.pred_kw, 1) + ' kW against ' + F(k.meas_kw, 1) + ' kW measured' : ' against ' + F(k.meas_kw, 1) + ' kW measured'}.`, draw(W, H, t) {
      const sd = W >= 560 ? 190 : 0, m = { l: 44, r: 12, t: 28, b: 34 }, vs = nb.map(n => n.v * 3.6).concat([k.q.v * 3.6]), as = nb.map(n => n.a).concat([k.q.a]), cv = k.cloud.map(c => c[0] * 3.6), ca = k.cloud.map(c => c[1]), xlo = Math.max(0, Math.min(...vs) - 12), xhi = Math.max(...vs) + 12, alo = Math.min(...as) - 0.3, ahi = Math.max(...as) + 0.3;
      const f = frame(W - sd, H, m, [xlo, xhi], [alo, ahi], { xl: 'speed, km/h', yl: 'acceleration, m/s²', xfmt: v => F(v, 0), yfmt: v => F(v, 1) }); let g = f.g; const lit = Math.floor(seg(t, 0.3, 2.6) * 25 + 1e-6);
      for (let i = 0; i < cv.length; i++) if (cv[i] >= xlo && cv[i] <= xhi && ca[i] >= alo && ca[i] <= ahi) g += `<circle cx="${f.X(cv[i]).toFixed(1)}" cy="${f.Y(ca[i]).toFixed(1)}" r="2" style="fill:var(--text3);fill-opacity:.3"/>`;
      for (let i = 0; i < lit; i++) g += `<line x1="${f.X(k.q.v * 3.6).toFixed(1)}" y1="${f.Y(k.q.a).toFixed(1)}" x2="${f.X(nb[i].v * 3.6).toFixed(1)}" y2="${f.Y(nb[i].a).toFixed(1)}" style="stroke:var(--accent);stroke-width:1;opacity:.3"/><circle cx="${f.X(nb[i].v * 3.6).toFixed(1)}" cy="${f.Y(nb[i].a).toFixed(1)}" r="${(3 + 7 * nb[i].w).toFixed(1)}" style="fill:var(--accent);fill-opacity:.55;stroke:var(--accent)"><title>neighbour ${i + 1}: ${F(nb[i].v * 3.6, 0)} km/h, ${F(nb[i].a, 2)} m/s², value ${F(nb[i].val_kw, 1)} kW, weight ${(100 * nb[i].w).toFixed(1)}%</title></circle>`;
      g += `<circle cx="${f.X(k.q.v * 3.6).toFixed(1)}" cy="${f.Y(k.q.a).toFixed(1)}" r="6" style="fill:var(--card);stroke:var(--text);stroke-width:2"/>`;
      if (sd) { const x0 = W - sd + 14, bw = sd - 30, vals = nb.map(n => n.val_kw), lo = Math.min(0, ...vals, k.avg_kw), hi = Math.max(0, ...vals, k.avg_kw), X2 = v => x0 + (v - lo) / (hi - lo) * bw, rh = 5.6; g += note(x0, 18, 'neighbours’ values, kW', 'mv-lab') + `<line x1="${X2(0)}" x2="${X2(0)}" y1="24" y2="${28 + 25 * rh + 4}" style="stroke:var(--line2)"/>`;
        for (let i = 0; i < lit; i++) g += `<rect x="${Math.min(X2(0), X2(vals[i])).toFixed(1)}" y="${(28 + i * rh).toFixed(1)}" width="${Math.abs(X2(vals[i]) - X2(0)).toFixed(1)}" height="4" rx="1" style="fill:var(--accent);opacity:.75"/>`;
        const a = ease(seg(t, 2.8, 3.6)); if (a > 0) g += `<line x1="${X2(k.avg_kw)}" x2="${X2(k.avg_kw)}" y1="24" y2="${28 + 25 * rh + 4}" style="stroke:var(--text);stroke-width:1.5;opacity:${a}"/>` + note(x0, 28 + 25 * rh + 20, 'average ' + F(k.avg_kw, 1) + ' kW', 'mv-lab acc'); x0; }
      return { svg: g, cap: this.cap }; } };
  }
  function realSvr(V) {
    const s = V.svr, dur = 4.2;
    return { dur, loop: false, cap: `Your fitted SVR: ${s.n_sv.toLocaleString('en-US')} of its ${s.n_fit.toLocaleString('en-US')} training samples (${F(100 * s.n_sv / s.n_fit, 0)}%) are support vectors. The curve is the model's ${V.target === 'residual' ? 'leftover (the part added to physics)' : 'power'} as the speed alone changes (speed-derived inputs move with it; every other input is held at its median in the training sample); the band is the tube of ±${F(s.eps_kw, 2)} kW. Dots: 160 support vectors (teal) and 160 other training samples (grey). In the full space a support vector is on or outside the tube, which a one-input slice cannot show. The view is cut at the 3rd and 97th percentile of the dots, so a few far outliers are not drawn.`, draw(W, H, t) {
      const pts = s.sv_pts.concat(s.other_pts).map(p => p[1]).sort((p, q) => p - q), p3 = pts[Math.floor(0.03 * (pts.length - 1))], p97 = pts[Math.ceil(0.97 * (pts.length - 1))], lo = Math.min(p3, ...s.pred_kw.map(v => v - s.eps_kw)), hi = Math.max(p97, ...s.pred_kw.map(v => v + s.eps_kw)), vx = s.v.map(v => v * 3.6), xmax = vx[vx.length - 1], pad = (hi - lo) * 0.04, f = frame(W, H, { l: 44, r: 12, t: 28, b: 34 }, [0, xmax], [lo - pad, hi + pad], { xl: 'speed, km/h', yl: (V.target === 'residual' ? 'leftover added to physics' : 'battery power') + ', kW', xfmt: v => F(v, 0), yfmt: v => F(v, 0) });
      let g = f.g; const cu = seg(t, 0, 1.8), np = Math.max(2, Math.round(vx.length * cu)), ta = ease(seg(t, 1.6, 2.4)), la = ease(seg(t, 2.4, 3.6));
      const inV = p => p[1] >= lo - pad && p[1] <= hi + pad; s.other_pts.filter(inV).forEach(p => { g += `<circle cx="${f.X(p[0] * 3.6).toFixed(1)}" cy="${f.Y(p[1]).toFixed(1)}" r="2.4" style="fill:var(--text3);fill-opacity:.35"/>`; });
      if (ta > 0) g += `<path d="${path(vx, s.pred_kw.map(v => v + s.eps_kw), f.X, f.Y)}L${path(vx.slice().reverse(), s.pred_kw.slice().reverse().map(v => v - s.eps_kw), f.X, f.Y).slice(1)}Z" style="fill:var(--accent-soft);stroke:none;opacity:${ta}"/>`;
      s.sv_pts.filter(inV).forEach(p => { g += `<circle cx="${f.X(p[0] * 3.6).toFixed(1)}" cy="${f.Y(p[1]).toFixed(1)}" r="${(2.4 + 1.2 * la).toFixed(1)}" style="fill:var(--accent);fill-opacity:${(0.18 + 0.6 * la).toFixed(2)}"/>`; });
      g += `<path class="ln" d="${path(vx.slice(0, np), s.pred_kw.slice(0, np), f.X, f.Y)}" style="stroke:var(--accent);stroke-width:2.25"/>`; return { svg: g, cap: this.cap }; } };
  }
  /* ---------------- the card ---------------- */
  const S = { model: 'lgbm', mode: 'resid', n: 0, real: null, src: 'ill', sub: 'trip', phys: false, scene: null, t0: 0, raf: 0, lastCap: '', ever: false };
  card.innerHTML = '<div class="mv-head"><h2 class="proc-t" id="mv-title">Model view</h2><span class="mv-badge" id="mv-badge"></span></div>' +
    '<div class="mv-ctl"><div class="seg" role="radiogroup" aria-label="Model view: illustration or your model" id="mv-src"><label><input type="radio" name="mvsrc" value="ill" checked><span>How it learns</span></label><label><input type="radio" name="mvsrc" value="real" id="mv-real-r" disabled><span>Your model</span></label></div>' +
    '<div class="seg" role="radiogroup" aria-label="Which view of your model" id="mv-sub" hidden><label><input type="radio" name="mvsub" value="trip" checked><span>Predicted vs measured</span></label><label><input type="radio" name="mvsub" value="model"><span id="mv-sub-l">Inside the model</span></label></div>' +
    '<label class="check" id="mv-phys-l" hidden><input type="checkbox" id="mv-phys"><span>Show physics-only line</span></label><button type="button" class="alt sm" id="mv-replay">Replay</button></div>' +
    '<div class="mv-stage chart" id="mv-stage" role="img" aria-label=""></div><p class="lim mut mv-cap" id="mv-cap"></p>';
  const stage = $('mv-stage'), capEl = $('mv-cap'), badge = $('mv-badge');
  function build() {
    const real = S.src === 'real' && S.real && S.real.views;
    if (!real) { S.scene = illustration(S.model, S.mode); return; }
    const V = S.real.views; S.scene = S.sub === 'trip' ? realTrip(V, S.phys, S.model) : ({ lgbm: realLgbm, ridge: realRidge, knn: realKnn, svr: realSvr }[S.model] || realTrip)(V, S.phys, S.model);
  }
  function ui() {
    const real = S.src === 'real' && S.real && S.real.views, hasReal = !!(S.real && S.real.views);
    badge.textContent = real ? 'From your trained model, held-out trips of fold 0' : 'Illustration on made-up toy data, not your data or your model'; badge.dataset.k = real ? 'real' : 'ill';
    $('mv-real-r').disabled = !hasReal; $('mv-sub').hidden = !real; $('mv-phys-l').hidden = !(real && S.sub === 'trip'); $('mv-sub-l').textContent = { lgbm: 'Error vs number of trees', ridge: 'Fitted weights', knn: 'The 25 neighbours', svr: 'Support vectors and tube' }[S.model];
    document.querySelectorAll('input[name=mvsrc]').forEach(r => { r.checked = r.value === S.src; }); document.querySelectorAll('input[name=mvsub]').forEach(r => { r.checked = r.value === S.sub; });
    $('mv-title').textContent = 'Model view: ' + NAMES[S.model] + ', ' + (S.mode === 'resid' ? 'physics + ML residual' : 'pure ML');
  }
  function paint(t) {
    const W = Math.max(300, Math.floor(stage.clientWidth)), H = W < 480 ? 280 : (innerHeight < 780 ? 252 : 320), r = S.scene.draw(W, H, t), cap = r.cap || S.scene.cap;
    stage.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="mv-svg">${r.svg}</svg>`; if (cap !== S.lastCap) { S.lastCap = cap; capEl.textContent = cap; stage.setAttribute('aria-label', (S.src === 'real' ? 'View of your trained model. ' : 'Illustration of how the model learns. ') + cap); }
  }
  const visible = () => card.offsetParent !== null && !document.hidden;
  function tick(ts) {
    S.raf = 0; if (!visible()) return; const D = S.scene.dur, el = (ts - S.t0) / 1000;
    if (S.scene.loop) paint(el % D); else paint(Math.min(el, D));
    if (S.scene.loop || el < D) S.raf = requestAnimationFrame(tick);
  }
  function play() {
    cancelAnimationFrame(S.raf); S.raf = 0; S.lastCap = ''; if (!S.scene) build(); if (!visible()) return;
    if (rm()) { paint(S.scene.loop ? S.scene.dur - 1.4 : S.scene.dur); return; }   // reduced motion: the final frame, no loop
    S.t0 = performance.now(); S.raf = requestAnimationFrame(tick);
  }
  function restart() { build(); ui(); play(); }
  document.querySelectorAll('input[name=mvsrc]').forEach(r => { r.onchange = () => { if (r.checked) { S.src = r.value; restart(); } }; });
  document.querySelectorAll('input[name=mvsub]').forEach(r => { r.onchange = () => { if (r.checked) { S.sub = r.value; restart(); } }; });
  $('mv-phys').onchange = () => { S.phys = $('mv-phys').checked; restart(); };
  $('mv-replay').onclick = () => { play(); };
  const stg = document.querySelector('.stage'); if (stg && window.MutationObserver) new MutationObserver(() => { if (visible()) { if (!S.raf) play(); } else { cancelAnimationFrame(S.raf); S.raf = 0; } }).observe(stg, { attributes: true, attributeFilter: ['class'] });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && visible() && !S.raf) play(); });
  let rt = 0; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (visible()) play(); }, 150); });
  window.MV = {
    start(model, mode, n) { S.model = model; S.mode = mode; S.n = n; S.real = null; S.src = 'ill'; S.sub = 'trip'; S.scene = null; ui(); restart(); },
    setReal(r, model, mode) { S.model = model; S.mode = mode; S.real = r; S.src = r && r.views ? 'real' : 'ill'; S.sub = 'trip'; S.scene = null; ui(); if (visible()) restart(); },
    paintAt(t) { if (!S.scene) build(); S.lastCap = ''; paint(t); },
    state: S
  };
  ui();
})();
