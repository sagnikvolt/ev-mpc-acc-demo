'use strict';
/* Static result charts: the hero replay and the 79-window dot strip. Data comes from JSON embedded in index.html by build_site.py
   (hero.json and per_window.csv); nothing here is typed by hand and no Python runtime is needed. Drawn at the real pixel width so text stays readable. */
(function () {
  const $ = id => document.getElementById(id);
  const M = x => (x < 0 ? '−' : '') + Math.abs(x).toFixed(2);   // one number format: true minus, two decimals for percentages
  const dataOf = id => { const n = $(id); return n ? JSON.parse(n.textContent) : null; };
  const path = (xs, ys, X, Y) => { let d = '', pen = false; ys.forEach((v, i) => { if (v === null || !Number.isFinite(v)) { pen = false; return; } d += (pen ? 'L' : 'M') + X(xs[i]).toFixed(1) + ' ' + Y(v).toFixed(1); pen = true; }); return d; };
  const nice = (hi, step) => Math.max(step, Math.ceil(hi / step) * step);

  /* ---------- hero: one real window, lead / recorded follower / our car ---------- */
  function hero(el, H) {
    const W = Math.max(280, Math.floor(el.clientWidth)), narrow = W < 480;
    const m = { l: 36, r: 6 }, hs = narrow ? 110 : 116, hg = narrow ? 56 : 60, hh = 18, gap = 16, bot = 20;
    const y1 = hh, y2 = hh + hs + gap + hh, Ht = y2 + hg + bot, T = H.t[H.t.length - 1];
    const X = v => m.l + (v / T) * (W - m.l - m.r);
    const vmax = nice(Math.max(...H.lead, ...H.rec_v, ...H.mpc_v), 5), gmax = nice(Math.max(...H.rec_gap.filter(Number.isFinite), ...H.mpc_gap.filter(Number.isFinite)), 10);
    const Y1 = v => y1 + hs - (v / vmax) * hs, Y2 = v => y2 + hg - (v / gmax) * hg;
    let g = `<text x="${m.l}" y="${y1 - 8}">speed, m/s</text><text x="${m.l}" y="${y2 - 8}">gap to the lead car, m</text>`;
    for (let v = 0; v <= vmax; v += 5) g += `<line class="grid-h" x1="${m.l}" x2="${W - m.r}" y1="${Y1(v)}" y2="${Y1(v)}"/><text x="${m.l - 8}" y="${Y1(v) + 4}" text-anchor="end">${v}</text>`;
    const gs = gmax > 40 ? 20 : 10; for (let v = 0; v <= gmax; v += gs) g += `<line class="grid-h" x1="${m.l}" x2="${W - m.r}" y1="${Y2(v)}" y2="${Y2(v)}"/><text x="${m.l - 8}" y="${Y2(v) + 4}" text-anchor="end">${v}</text>`;
    const ts = narrow ? 40 : 20; for (let v = 0; v <= T; v += ts) g += `<text x="${X(v)}" y="${Ht - 6}" text-anchor="${v === 0 ? 'start' : 'middle'}">${v} s</text>`;
    g += `<path class="ln ln-lead" d="${path(H.t, H.lead, X, Y1)}"/><path class="ln ln-rec" d="${path(H.t, H.rec_v, X, Y1)}"/><path class="ln ln-mpc" d="${path(H.t, H.mpc_v, X, Y1)}"/>`;
    g += `<path class="ln ln-rec" d="${path(H.t, H.rec_gap, X, Y2)}"/><path class="ln ln-mpc" d="${path(H.t, H.mpc_gap, X, Y2)}"/>`;
    g += `<g id="hx" style="display:none"><line class="grid-h" id="hxl" y1="${y1}" y2="${y2 + hg}" style="stroke:var(--text3)"/></g>`;
    el.innerHTML = `<svg viewBox="0 0 ${W} ${Ht}" width="${W}" height="${Ht}" role="img" aria-label="Speed and gap over time for the median test window: lead car, recorded follower and our MPC car">${g}<rect id="hhit" x="${m.l}" y="0" width="${W - m.l - m.r}" height="${Ht}" fill="transparent" style="touch-action:pan-y"/></svg>`;
    const sc = $('hero-scrub'), gx = $('hx'), gl = $('hxl'), hit = $('hhit'), f1 = v => v === null ? '-' : v.toFixed(1), iOf = t => Math.max(0, Math.min(H.t.length - 1, Math.round(t / 0.5)));
    const show = t => { if (t === null) { gx.style.display = 'none'; if (sc) sc.textContent = sc.dataset.idle; return; } const i = iOf(t);
      gx.style.display = ''; gl.setAttribute('x1', X(H.t[i])); gl.setAttribute('x2', X(H.t[i]));
      if (sc) sc.innerHTML = `t ${H.t[i].toFixed(1)} s &middot; lead ${f1(H.lead[i])} &middot; recorded ${f1(H.rec_v[i])} &middot; ours ${f1(H.mpc_v[i])} m/s &middot; gap ${f1(H.rec_gap[i])} / ${f1(H.mpc_gap[i])} m`; };
    heroShow = show; if (heroT !== null) show(heroT);
    const move = e => { const r = hit.getBoundingClientRect(), px = (e.clientX - r.left) / r.width * (W - m.l - m.r), t = H.t[iOf(px / (W - m.l - m.r) * T)];
      heroT = t; show(t); window.dispatchEvent(new CustomEvent('ev:scrub', { detail: { t, src: 'chart', scope: 'hero' } })); };
    hit.addEventListener('pointermove', move); hit.addEventListener('pointerdown', move);
    hit.addEventListener('pointerleave', () => { heroT = null; show(null); window.dispatchEvent(new CustomEvent('ev:scrub', { detail: { t: null, src: 'chart', scope: 'hero' } })); });
  }
  let heroShow = null, heroT = null;
  window.addEventListener('ev:scrub', e => { const d = e.detail || {}; if (d.scope !== 'hero' || d.src === 'chart') return; heroT = d.t; if (heroShow) heroShow(d.t); });

  /* ---------- main chart: one dot per window, change in Wh/km of our MPC vs the recorded commercial-ACC follower ---------- */
  function swarm(el, S) {
    const W = Math.max(280, Math.floor(el.clientWidth)), narrow = W < 520, r = narrow ? 4 : 5, d = 2 * r + 1;
    const m = { l: 16, r: 16, t: 46, b: 44 }, ch = S.rows.map(q => q.c), lo = Math.min(...ch, 0, -25), hi = Math.max(...ch, 0), pad = (hi - lo) * 0.06;
    const X = v => m.l + ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (W - m.l - m.r);
    const rows = S.rows.map(q => Object.assign({ x: X(q.c) }, q)).sort((a, b) => a.x - b.x), placed = [];
    rows.forEach(q => { const near = placed.filter(p => Math.abs(p.x - q.x) < d), cands = [0]; near.forEach(p => { const dy = Math.sqrt(d * d - (p.x - q.x) ** 2); cands.push(p.y + dy, p.y - dy); });
      cands.sort((a, b) => Math.abs(a) - Math.abs(b)); q.y = cands.find(c => near.every(p => (p.x - q.x) ** 2 + (p.y - c) ** 2 >= d * d - 0.01)); placed.push(q); });
    const half = Math.max(40, ...rows.map(q => Math.abs(q.y))) + r + 4, cy = m.t + half, Ht = cy + half + m.b, ay = cy + half;
    const rawStep = (hi - lo) / (narrow ? 5 : 8), step = [1, 2, 5, 10, 20].find(s => s >= rawStep) || 20;
    let g = '';
    const ticks = []; for (let v = Math.ceil((lo - pad) / step) * step; v <= hi + pad; v += step) ticks.push(v);
    if (!ticks.includes(-25)) ticks.push(-25);
    const tk = ticks.filter(v => v === 0 || v === -25 || (Math.abs(X(v) - X(-25)) > 30 && Math.abs(X(v) - X(0)) > 30));
    tk.sort((p, q) => p - q);
    for (const v of tk) g += `<line class="grid-h" x1="${X(v)}" x2="${X(v)}" y1="${m.t - 4}" y2="${ay}"/><text x="${X(v)}" y="${ay + 16}" text-anchor="middle" class="${v === 0 || v === -25 ? 'tx' : ''}">${v === 0 ? '0%' : M(v).replace('.00', '') + '%'}</text>`;
    g += `<line class="zero" x1="${X(0)}" x2="${X(0)}" y1="${m.t - 4}" y2="${ay}"/>`;
    g += `<line class="med" x1="${X(S.median)}" x2="${X(S.median)}" y1="${m.t - 4}" y2="${ay}"/>`;
    const lab = S.hero_win !== null ? `window ${S.hero_win}, hero chart` : '', fit = X(S.median) + 8 + 11 * 0.62 * Math.max(lab.length, 14) < W - m.r, lx = fit ? X(S.median) + 8 : X(S.median) - 8, an = fit ? 'start' : 'end';
    g += `<text class="acc" x="${lx}" y="${m.t - 26}" text-anchor="${an}">median ${M(S.median)}%</text>`;
    if (lab) g += `<text x="${lx}" y="${m.t - 12}" text-anchor="${an}">${lab}</text>`;
    const nl = rows.filter(q => q.c < 0).length, nh = rows.length - nl;
    g += `<text class="tx" x="${m.l}" y="${ay + 36}">← lower in ${nl} of ${rows.length}</text><text class="tx" x="${W - m.r}" y="${ay + 36}" text-anchor="end">higher in ${nh} →</text>`;
    rows.filter(q => q.w !== S.hero_win).forEach(q => { g += `<circle class="dot" cx="${q.x.toFixed(1)}" cy="${(cy + q.y).toFixed(1)}" r="${r}"><title>window ${q.w}, ${q.v}: ${M(q.c)}% (${q.r.toFixed(1)} to ${q.m.toFixed(1)} Wh/km)</title></circle>`; });
    rows.filter(q => q.w === S.hero_win).forEach(q => { g += `<circle class="dot hero" cx="${q.x.toFixed(1)}" cy="${(cy + q.y).toFixed(1)}" r="${r + 1.5}"><title>window ${q.w}, ${q.v}: ${M(q.c)}% (${q.r.toFixed(1)} to ${q.m.toFixed(1)} Wh/km)</title></circle>`; });
    el.innerHTML = `<svg class="swarm" viewBox="0 0 ${W} ${Ht}" width="${W}" height="${Ht}" role="img" aria-label="Change in battery energy for each of ${rows.length} windows; lower in ${nl}; median ${M(S.median)} percent">${g}</svg>`;
  }

  const HD = dataOf('hero-data'), SD = dataOf('swarm-data');
  let lastW = 0;
  const draw = () => { const a = $('hero-chart'), b = $('swarm-chart'); if (!a || !b) return; const w = a.clientWidth + '/' + b.clientWidth; if (w === lastW) return; lastW = w; if (HD) hero(a, HD); if (SD) swarm(b, SD); };
  const sc = $('hero-scrub'); if (sc) sc.dataset.idle = sc.textContent;
  draw(); let tm = 0; window.addEventListener('resize', () => { clearTimeout(tm); tm = setTimeout(draw, 120); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { lastW = 0; draw(); });
})();
