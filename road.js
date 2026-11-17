'use strict';
/* Road view: a side view of one lane, replayed from the same traces the charts draw (lead speed, gaps, speeds, cumulative energy).
   Positions: the lead car's position is the integral of its speed; every follower is placed at (lead position - its own gap), so the picture only
   shows what the traces contain. Cars are drawn at 4.88 m (the length of the Polestar sprite, see media/roadview/sprites.json) as pre-rendered side-view pictures: a body sprite, two wheel sprites that turn with the distance travelled, a brake-light glow when the lane decelerates (a < -0.5 m/s^2). If the sprites cannot load the old boxes are drawn. No Python runtime is needed, so the hero strip works before (or without) the engine.
   Charts and this view share one event: window 'ev:scrub' {t, src, scope}; t = null clears the marker. */
(function () {
  const ICON = { play: '<polygon points="6 3 20 12 6 21 6 3"/>', pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>' };
  const icon = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
  const CAR = 4.8777, ALL = [], SP = { st: 0, imgs: {}, meta: null }, BRAKE_A = -0.5;   // SP.st: 0 not requested, 1 loading, 2 ready, 3 failed (boxes are drawn)
  const mkCv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const probe = mkCv(1, 1).getContext('2d');
  const hex = s => { probe.fillStyle = '#000'; probe.fillStyle = s || '#000'; return probe.fillStyle; };
  const isDark = col => { const h = hex(col.card); return (parseInt(h.slice(1, 3), 16) * 0.3 + parseInt(h.slice(3, 5), 16) * 0.59 + parseInt(h.slice(5, 7), 16) * 0.11) < 128; };
  function scaled(src, w, h) {   // repeated halving, then a final draw: crisp at any size
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h)); let cur = src, cw = src.width, ch = src.height;
    while (cw >= 2 * w && ch >= 2 * h) { const nw = cw >> 1, nh = ch >> 1, cv = mkCv(nw, nh), x = cv.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, nw, nh); cur = cv; cw = nw; ch = nh; }
    const out = mkCv(w, h), x = out.getContext('2d'); x.imageSmoothingQuality = 'high'; x.drawImage(cur, 0, 0, w, h); return out;
  }
  function loadSprites() {
    if (SP.st) return; SP.st = 1; const v = typeof SITE_V !== 'undefined' ? '?v=' + SITE_V : '', base = '/media/roadview/';
    fetch(base + 'sprites.json' + v).then(r => { if (!r.ok) throw new Error('sprites.json ' + r.status); return r.json(); }).then(m => {
      SP.meta = m; const names = Object.assign({}, m.files, { sil: 'car_silhouette.png', wheel: 'wheel.png', glow: 'brake_glow.png' });
      return Promise.all(Object.keys(names).map(k => new Promise((res, rej) => { const im = new Image(); im.onload = () => res([k, im]); im.onerror = () => rej(new Error(names[k] + ' failed')); im.src = base + names[k] + v; })));
    }).then(a => { a.forEach(p => { SP.imgs[p[0]] = p[1]; }); SP.st = 2; ALL.forEach(r => r.spritesReady()); })
      .catch(e => { SP.st = 3; console.warn('road view: sprites not available (' + (e && e.message || e) + '), drawing boxes'); });
  }
  function accel(v, dt) {   // m/s^2 from a speed trace: central difference, then a 5-sample mean (0.5 s at dt 0.1) so the brake light does not flicker
    const n = v.length, a = new Array(n).fill(null), o = new Array(n).fill(null);
    for (let i = 0; i < n; i++) { const p = fin(v[i - 1]) ? v[i - 1] : v[i], q = fin(v[i + 1]) ? v[i + 1] : v[i]; if (fin(p) && fin(q)) a[i] = (q - p) / ((i > 0 && i < n - 1 ? 2 : 1) * dt); }
    for (let i = 0; i < n; i++) { let s = 0, k = 0; for (let j = Math.max(0, i - 2); j <= Math.min(n - 1, i + 2); j++) if (a[j] !== null) { s += a[j]; k++; } o[i] = k ? s / k : null; }
    return o;
  }
  let uid = 0;
  const fin = v => v !== null && v !== undefined && Number.isFinite(v);
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function lerp(arr, f) {
    const n = arr.length, i0 = clamp(Math.floor(f), 0, n - 1), i1 = Math.min(i0 + 1, n - 1), a = arr[i0], b = arr[i1], u = clamp(f - i0, 0, 1);
    if (fin(a) && fin(b)) return a + (b - a) * u; return fin(a) ? a : (fin(b) ? b : null);
  }
  function colors(el) {
    const s = getComputedStyle(el || document.documentElement), g = n => s.getPropertyValue(n).trim();
    return { text: g('--text'), text2: g('--text2'), text3: g('--text3'), raised: g('--raised'), card: g('--card'), accent: g('--accent'), line2: g('--line2'), mono: g('--mono') || 'ui-monospace,monospace' };
  }

  class Road {
    constructor(host, o) {
      o = o || {}; this.id = o.id || 'rv' + (++uid); this.scope = o.scope || this.id; this.h = o.height || 120; this.loop = !!o.loop; this.multi = !!o.multi; this.mult = o.speed || 10;
      this.t = 0; this.playing = false; this.data = null; this.vis = true; this.W = 0; this.dpr = 1; this.raf = 0; this.last = 0; this.hold = 0; this.lastIdx = -1; this.hover = null;
      this.st = { n: 0, sum: 0, max: 0 }; this.col = colors(host); this.sc = null; this.cl = 0; this.cr = 0;
      host.classList.add('rv');
      host.innerHTML = `<div class="rv-cv" style="height:${this.h}px"><canvas role="img" aria-label="Side view of the lead car, the recorded follower and our car, replayed at the chosen speed"></canvas></div>` +
        `<div class="rv-ctl"><button type="button" class="rv-play" aria-label="Play">${icon('play')}</button>` +
        `<div class="seg" role="radiogroup" aria-label="Replay speed (1x is real time)">${[1, 2, 5, 10, 20].map(m => `<label><input type="radio" name="${this.id}-spd" value="${m}"${m === this.mult ? ' checked' : ''}><span>${m}x</span></label>`).join('')}</div>` +
        `<input type="range" class="rv-sl" min="0" max="1" step="0.1" value="0" aria-label="Replay time"><span class="rv-t mono"></span></div><div class="rv-leg"></div>`;
      this.host = host; this.cv = host.querySelector('canvas'); this.ctx = this.cv.getContext('2d'); this.btn = host.querySelector('.rv-play'); this.sl = host.querySelector('.rv-sl'); this.tl = host.querySelector('.rv-t'); this.lg = host.querySelector('.rv-leg');
      this.btn.onclick = () => (this.playing ? this.pause() : this.play());
      host.querySelectorAll('input[type=radio]').forEach(r => { r.onchange = () => { this.mult = +r.value; }; });
      this.sl.addEventListener('input', () => { const t = +this.sl.value; this.pause(); this.t = t; this.frame(true); });
      this.ro = new ResizeObserver(() => this.layout()); this.ro.observe(host.querySelector('.rv-cv'));
      this.io = new IntersectionObserver(es => { this.vis = es[es.length - 1].isIntersecting; if (this.vis) { this.draw(); this.sched(); } }); this.io.observe(host);
      document.addEventListener('visibilitychange', () => { if (!document.hidden) { this.draw(); this.sched(); } });
      const mq = matchMedia('(prefers-color-scheme: dark)'); (mq.addEventListener ? mq.addEventListener('change', () => this.recolor()) : mq.addListener(() => this.recolor()));
      if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => this.draw());
      window.addEventListener('ev:scrub', e => this.onScrub(e.detail || {}));
      ALL.push(this); loadSprites(); if (SP.st === 2) this.spritesReady();
    }
    spritesReady() { this.buildSprites(); this.draw(); }
    recolor() { this.col = colors(this.host); this.buildSprites(); this.draw(); }
    /* d = { t, lead, ego: {name, accent, v, gap, wh|null}, rec: {v, gap, wh|null} | null } */
    setData(d, o) {
      if (this.multi) return this.setDataMulti(d, o);
      o = o || {}; this.pause();
      const n = Math.min(d.t.length, d.lead.length, d.ego.v.length, d.ego.gap.length), dt = d.t[1] - d.t[0], lead = d.lead.slice(0, n), L = [d.ego.gap[0]];
      for (let i = 1; i < n; i++) { const a = fin(lead[i - 1]) ? lead[i - 1] : 0, b = fin(lead[i]) ? lead[i] : a; L.push(L[i - 1] + 0.5 * (a + b) * dt); }
      const ego = { name: d.ego.name, accent: !!d.ego.accent, v: d.ego.v.slice(0, n), gap: d.ego.gap.slice(0, n), wh: d.ego.wh ? d.ego.wh.slice(0, n) : null };
      ego.pos = L.map((p, i) => p - ego.gap[i]);
      let rec = null;
      if (d.rec && d.rec.v && d.rec.gap) {
        const m = Math.min(n, d.rec.v.length, d.rec.gap.length), pos = [];
        for (let i = 0; i < m; i++) { const g = d.rec.gap[i]; pos.push(fin(g) ? L[i] - g : (i ? pos[i - 1] + (fin(d.rec.v[i]) ? d.rec.v[i] : 0) * dt : ego.pos[0])); }
        rec = { v: d.rec.v.slice(0, m), pos, wh: d.rec.wh ? d.rec.wh.slice(0, m) : null };
      }
      let ahead = 0, behind = 0;
      for (let i = 0; i < n; i++) { ahead = Math.max(ahead, ego.gap[i]); if (rec && i < rec.pos.length) { ahead = Math.max(ahead, rec.pos[i] - ego.pos[i]); behind = Math.max(behind, ego.pos[i] - rec.pos[i]); } }
      ego.acc = accel(ego.v, dt); this.data = { n, dt, T: (n - 1) * dt, L, ego, rec, lead, leadAcc: accel(lead, dt), ahead: ahead + CAR, behind: behind + CAR + 1 };
      this.t = 0; this.lastIdx = -1; this.hold = 0;
      this.sl.max = this.data.T.toFixed(1); this.sl.value = 0;
      this.lg.innerHTML = `<span class="lg"><span class="rv-sw is-lead"></span>Lead car</span>` + (rec ? `<span class="lg"><span class="rv-sw is-rec"></span>Recorded follower</span>` : '') +
        `<span class="lg"><span class="rv-sw ${ego.accent ? 'is-ours' : 'is-other'}"></span>${ego.accent ? 'Our car (MPC)' : ego.name}</span>`;
      this.layout(); this.ui();
      if (o.autoplay && !reduced()) this.play();
    }

    /* multi-lane view: one lane per controller, same lead trajectory in every lane, recorded follower as an outline ghost in every lane.
       d = { t, lead, lanes: [{id, name, short, accent, v, gap, wh|null}], rec: {v, gap, wh|null} | null }; with no lanes the recorded data alone is shown. */
    setDataMulti(d, o) {
      o = o || {}; const keepT = o.keep ? this.t : 0, wasPlaying = o.keep && this.playing; this.pause();
      const lanes = d.lanes || [], rec0 = d.rec && d.rec.v && d.rec.gap ? d.rec : null;
      let n = Math.min(d.t.length, d.lead.length); lanes.forEach(l => { n = Math.min(n, l.v.length, l.gap.length); }); if (rec0) n = Math.min(n, rec0.v.length, rec0.gap.length);
      const dt = d.t[1] - d.t[0], lead = d.lead.slice(0, n), g0 = fin(d.x0) ? d.x0 : (lanes.length ? lanes[0].gap[0] : (rec0 ? rec0.gap[0] : 30)), L = [fin(g0) ? g0 : 30];
      for (let i = 1; i < n; i++) { const a = fin(lead[i - 1]) ? lead[i - 1] : 0, b = fin(lead[i]) ? lead[i] : a; L.push(L[i - 1] + 0.5 * (a + b) * dt); }
      let maxGap = 0; const allGaps = [];
      const ls = lanes.map(l => { const gap = l.gap.slice(0, n); gap.forEach(g => { if (fin(g)) { maxGap = Math.max(maxGap, g); allGaps.push(g); } }); return { id: l.id, name: l.name, short: l.short || l.name, accent: !!l.accent, v: l.v.slice(0, n), gap, pos: L.map((p, i) => p - (fin(gap[i]) ? gap[i] : (i ? L[i - 1] - gap[i - 1] : 0))), wh: l.wh ? l.wh.slice(0, n) : null, acc: null }; }); ls.forEach(l => { l.acc = accel(l.v, dt); });
      let rec = null;
      if (rec0) { const pos = []; for (let i = 0; i < n; i++) { const g = rec0.gap[i]; if (fin(g)) { maxGap = Math.max(maxGap, g); allGaps.push(g); } pos.push(fin(g) ? L[i] - g : (i ? pos[i - 1] + (fin(rec0.v[i]) ? rec0.v[i] : 0) * dt : L[0] - 30)); } rec = { v: rec0.v.slice(0, n), gap: rec0.gap.slice(0, n), pos, wh: rec0.wh ? rec0.wh.slice(0, n) : null }; }
      const leadAcc = accel(lead, dt);
      const nl = Math.max(1, ls.length), single = nl === 1; let range = maxGap;
      if (single && allGaps.length) { allGaps.sort((a, b) => a - b); range = Math.min(maxGap, allGaps[Math.floor(0.9 * (allGaps.length - 1))]); }   // single lane: zoom to where the data lives, the rare extreme gap may leave the picture
      const LH = single ? 74 : 56;
      this.data = { multi: true, n, dt, T: (n - 1) * dt, L, lanes: ls, rec, lead, leadAcc, maxGap: range + 2, single, LH, H: 24 + nl * LH + 26, obst: d.obst || null };
      this.t = clamp(keepT, 0, this.data.T); this.lastIdx = -1; this.hold = 0; this.sl.max = this.data.T.toFixed(1); this.sl.value = this.t;
      const anyOurs = ls.some(l => l.accent), anyOther = ls.some(l => !l.accent);
      this.lg.innerHTML = `<span class="lg"><span class="rv-sw is-lead"></span>Lead car</span>` + (rec ? `<span class="lg"><span class="rv-sw is-rec"></span>Recorded follower (outline)</span>` : '') +
        (anyOurs ? `<span class="lg"><span class="rv-sw is-ours"></span>Our car (${(ls.find(l => l.accent) || {}).short || 'MPC'})</span>` : '') + (anyOther ? `<span class="lg"><span class="rv-sw is-other"></span>Other controllers</span>` : '') +
        (d.obst && d.obst.breakers && d.obst.breakers.length ? `<span class="lg"><span class="rv-sw is-bump"></span>Speed breaker</span>` : '') + (d.obst && d.obst.potholes && d.obst.potholes.length ? `<span class="lg"><span class="rv-sw is-pit"></span>Pothole (demo only, not part of the paper's results)</span>` : '');
      this.layout(); this.ui();
      if (o.keep) { this.frame(true); if (wasPlaying) this.play(); } else if (o.autoplay && !reduced()) this.play();
    }
    buildSprites() {   // scaled copies of the sprites for this size and pixel ratio (built on resize / theme change, never per frame)
      if (SP.st !== 2 || !this.ppm) { this.sc = null; return; }
      const M = SP.meta, C = this.col, dark = isDark(C), dpr = this.dpr, key = (this.ppm * dpr).toFixed(3) + (dark ? 'd' : 'l') + C.text;
      if (this.sc && this.sc.key === key) return;
      const k = this.ppm * dpr / M.pxPerM, w = M.sprite.w * k, h = M.sprite.h * k, I = SP.imgs, ws = 2 * M.wheelRadiusM * 1.02 * this.ppm * dpr, sc = { key, s: this.ppm / M.pxPerM };
      sc.ours = scaled(I[dark ? 'ours_dark' : 'ours_light'], w, h); sc.lead = scaled(I.lead, w, h); sc.other = scaled(I.other, w, h); sc.w = sc.ours.width; sc.h = sc.ours.height;
      sc.wheel = scaled(I.wheel, ws, ws); sc.glow = scaled(I.glow, I.glow.width * k, I.glow.height * k);
      const pad = Math.ceil(2.5 * dpr), sil = scaled(I.sil, w, h), oc = mkCv(sil.width + 2 * pad, sil.height + 2 * pad), ox = oc.getContext('2d'), r = 1.5 * dpr;   // recorded follower: a 1.5 px outline derived from the silhouette alpha (grow it, cut the silhouette out, tint)
      for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8; ox.drawImage(sil, pad + Math.cos(a) * r, pad + Math.sin(a) * r); }
      ox.globalCompositeOperation = 'destination-out'; ox.drawImage(sil, pad, pad); ox.globalCompositeOperation = 'source-in'; ox.fillStyle = C.text; ox.fillRect(0, 0, oc.width, oc.height);
      sc.outline = oc; sc.pad = pad; this.sc = sc;
    }
    carH() { if (SP.st === 2 && this.sc) return SP.meta.carHeightM * this.ppm; const carH = clamp(CAR * this.ppm * 0.4, 10, this.data.single ? 30 : 17); return Math.max(2.5, carH * 0.19) * 1.1 + carH * 0.72; }   // height of a drawn car (px) above the road
    lift(xw) {   // height (px) of the road under a wheel at world position xw: speed-breaker hump (+) or pothole dip (-); drawing only
      const D = this.data, O = D.obst; if (!O) return 0;
      const ppm = this.ppm, hwm = Math.max(9, 1.6 * ppm) / ppm, pk = (D.single ? 9 : 7) * 0.95, B = O.breakers, P = O.potholes; let h = 0, i;
      if (B) for (i = 0; i < B.length; i++) { const dd = Math.abs(xw - B[i]); if (dd < hwm) h = Math.max(h, pk * (1 - (dd / hwm) * (dd / hwm))); }
      if (P) for (i = 0; i < P.length; i++) if (xw >= P[i][0] && xw <= P[i][1]) h = Math.min(h, -2.5);
      return h;
    }
    /* one car: x2 = front bumper in px (= the simulated position), front = same in metres, kind lead | ours | other | rec, acc = its acceleration (brake glow below BRAKE_A) */
    drawCar(x2, front, kind, col, roadTop, acc) {
      const c = this.ctx, ppm = this.ppm, len = CAR * ppm, x1 = x2 - len, S = this.sc;
      if (x2 < this.cl - 4 || x1 > this.cr + 4) return;
      if (!S) {   // fallback: the old box car
        const carH = clamp(len * 0.4, 10, this.data.single ? 30 : 17), wr = Math.max(2.5, carH * 0.19), bodyH = carH * 0.72, bb = roadTop - wr * 1.1, bt = bb - bodyH;
        const lr = this.lift(front - CAR * 0.78), lf = this.lift(front - CAR * 0.22), tilted = lr !== 0 || lf !== 0;
        if (tilted) { const xm = x1 + len / 2, k = -(lf - lr) / (len * 0.56); c.save(); c.translate(xm, -(lf + lr) / 2); c.transform(1, k, 0, 1, 0, 0); c.translate(-xm, 0); }
        c.lineWidth = 1.5; c.strokeStyle = col; c.fillStyle = col;
        c.beginPath(); if (c.roundRect) c.roundRect(x1, bt, len, bodyH, 3); else c.rect(x1, bt, len, bodyH); if (kind === 'rec') c.stroke(); else c.fill();
        for (const u of [0.22, 0.78]) { c.beginPath(); c.arc(x1 + len * u, roadTop - wr, wr, 0, 6.2832); c.fillStyle = this.col.card; c.fill(); c.stroke(); }
        if (tilted) c.restore(); return;
      }
      const M = SP.meta, s = S.s, dpr = this.dpr, wF = (M.bumperX.front - M.wheels.front[0]) / M.pxPerM, wR = (M.bumperX.front - M.wheels.rear[0]) / M.pxPerM;   // wheel centres, metres behind the front bumper
      const lf = this.lift(front - wF), lr = this.lift(front - wR), tilted = lf !== 0 || lr !== 0;
      if (tilted) { const xm = x2 - (wF + wR) / 2 * ppm, k = -(lf - lr) / ((wR - wF) * ppm); c.save(); c.translate(xm, -(lf + lr) / 2); c.transform(1, k, 0, 1, 0, 0); c.translate(-xm, 0); }
      const dx = Math.round((x2 - M.bumperX.front * s) * dpr) / dpr, dy = Math.round((roadTop - M.groundY * s) * dpr) / dpr, ang = front / M.wheelRadiusM;
      if (kind === 'rec') {
        const p = S.pad / dpr; c.drawImage(S.outline, dx - p, dy - p, S.outline.width / dpr, S.outline.height / dpr);
        c.lineWidth = 1.5; c.strokeStyle = col; c.beginPath();
        for (let i = 0; i < 2; i++) { const w = i ? M.wheels.rear : M.wheels.front, cx = dx + w[0] * s, cy = dy + w[1] * s, r = M.wheelRadiusM * ppm; c.moveTo(cx + r, cy); c.arc(cx, cy, r, 0, 6.2832); c.moveTo(cx + Math.cos(ang) * r * 0.35, cy + Math.sin(ang) * r * 0.35); c.lineTo(cx + Math.cos(ang) * r * 0.9, cy + Math.sin(ang) * r * 0.9); }
        c.stroke();
      } else {
        c.drawImage(S[kind], dx, dy, S.w / dpr, S.h / dpr);
        const ww = S.wheel.width / dpr;
        for (let i = 0; i < 2; i++) { const w = i ? M.wheels.rear : M.wheels.front; c.save(); c.translate(dx + w[0] * s, dy + w[1] * s); c.rotate(ang); c.drawImage(S.wheel, -ww / 2, -ww / 2, ww, ww); c.restore(); }
        if (acc !== null && acc < BRAKE_A) { c.globalAlpha = Math.min(1, (BRAKE_A - acc) * 4); c.drawImage(S.glow, dx + M.glow.x * s, dy + M.glow.y * s, S.glow.width / dpr, S.glow.height / dpr); c.globalAlpha = 1; }
      }
      if (tilted) c.restore();
    }
    drawMulti() {
      const D = this.data, c = this.ctx, W = this.W, C = this.col, ppm = this.ppm, f = this.t / D.dt, gl = this.gl, gr = this.gr, RW = W - gl - gr, xl = this.xl, HEAD = 24, LH = D.LH, single = D.single;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.clearRect(0, 0, W, D.H);
      const pL = lerp(D.L, f), X = m => xl + (m - pL) * ppm, chPx = this.carH(); this.cl = gl; this.cr = W - gr;
      const num = (v, d) => (v === null ? '-' : v.toFixed(d)), seg = (x, y, parts) => { for (const [s, col] of parts) { c.fillStyle = col; c.fillText(s, x, y); x += c.measureText(s).width; } return x; };
      c.textBaseline = 'alphabetic'; c.textAlign = 'left'; c.font = `400 12px ${C.mono}`;
      const lv = lerp(D.lead, f), tt = [['lead ', C.text3], [lv === null ? '-' : String(Math.round(lv * 3.6)), C.text], [' km/h', C.text3], ['   t ', C.text3], [this.t.toFixed(1), C.text], [' s', C.text3]];
      let tw = 0; tt.forEach(p => { tw += c.measureText(p[0]).width; }); seg(W - 12 - tw, 18, tt);
      const lanes = D.lanes.length ? D.lanes : [null], rp = D.rec ? lerp(D.rec.pos, f) : null;
      lanes.forEach((ln, i) => {
        const y0 = HEAD + i * LH, roadTop = y0 + LH - 20, roadH = single ? 16 : 12;
        c.save(); c.beginPath(); c.rect(gl, y0, RW, LH); c.clip();
        c.fillStyle = C.raised; c.fillRect(gl, roadTop, RW, roadH); c.fillStyle = C.line2; c.fillRect(gl, roadTop, RW, 1); c.fillRect(gl, roadTop + roadH - 1, RW, 1);
        c.globalAlpha = 0.55; c.fillStyle = C.text3; const w0 = pL - (xl - gl) / ppm - 30, w1 = pL + (W - gr - xl) / ppm + 30;
        for (let k = Math.floor(w0 / 24); k * 24 < w1; k++) { const a = X(k * 24), b = X(k * 24 + 10); c.fillRect(a, roadTop + roadH / 2 - 0.75, b - a, 1.5); }
        c.globalAlpha = 1;
        if (D.obst) {   // speed breakers: a raised hump on the road (drawn as a point of fixed width: the simulation treats a breaker as a point); potholes: a dark dip over their real length (the rough stretch)
          const lo = pL - (xl - gl) / ppm - 20, hi = pL + (W - gr - xl) / ppm + 20;
          (D.obst.potholes || []).forEach(p => { if (p[1] < lo || p[0] > hi) return; const a = X(p[0]), b = X(p[1]), w = Math.max(5, b - a); c.fillStyle = 'rgba(0,0,0,0.78)'; c.beginPath(); if (c.ellipse) c.ellipse(a + (b - a) / 2, roadTop + roadH * 0.62, w / 2, roadH * 0.42, 0, 0, 6.2832); else c.rect(a, roadTop + 3, w, roadH - 6); c.fill(); c.strokeStyle = C.text3; c.lineWidth = 1; c.stroke(); });
          (D.obst.breakers || []).forEach(xb => { if (xb < lo || xb > hi) return; const a = X(xb), hw = Math.max(9, 1.6 * ppm), hh = single ? 9 : 7; c.fillStyle = C.text2; c.beginPath(); c.moveTo(a - hw, roadTop + 1); c.quadraticCurveTo(a, roadTop - hh * 1.9, a + hw, roadTop + 1); c.closePath(); c.fill(); });
        }
        this.drawCar(X(pL + CAR), pL + CAR, 'lead', C.text3, roadTop, lerp(D.leadAcc, f));
        if (rp !== null) this.drawCar(X(rp), rp, 'rec', C.text, roadTop, null);
        let pE = null;
        if (ln) { pE = lerp(ln.pos, f); this.drawCar(X(pE), pE, ln.accent ? 'ours' : 'other', ln.accent ? C.accent : C.text2, roadTop, lerp(ln.acc, f)); }
        if (pE !== null && lv !== null) {
          c.strokeStyle = C.text3; c.lineWidth = 1; c.beginPath(); const gy = roadTop - chPx - 6, a = Math.round(X(pE)) + 0.5, b = Math.round(X(pL)) + 0.5; c.moveTo(a, gy - 3); c.lineTo(a, gy + 3); c.moveTo(a, gy); c.lineTo(b, gy); c.moveTo(b, gy - 3); c.lineTo(b, gy + 3); c.stroke();
        }
        c.restore();
        c.font = `${ln && ln.accent ? 500 : 400} 12px ${C.mono}`; c.fillStyle = ln && ln.accent ? C.accent : C.text2; c.textAlign = 'left';
        let lab = ln ? ln.short : 'Recorded data'; while (lab.length > 3 && c.measureText(lab).width > gl - 20) lab = lab.slice(0, -2) + '…'; const cy = roadTop - chPx / 2; c.fillText(lab, 12, cy + 4);
        c.font = `400 12px ${C.mono}`;
        const sv = ln ? lerp(ln.v, f) : (D.rec ? lerp(D.rec.v, f) : null), sg = ln ? lerp(ln.gap, f) : (D.rec ? lerp(D.rec.gap, f) : null), swh = ln ? (ln.wh ? lerp(ln.wh, f) : null) : (D.rec && D.rec.wh ? lerp(D.rec.wh, f) : null), x = W - gr + 12;
        const l1 = [[sv === null ? '-' : String(Math.round(sv * 3.6)), C.text], [' km/h', C.text3]];
        if (gr > 100) { l1.push(['  ', C.text3], [num(sg, 1), C.text], [' m', C.text3]); seg(x, cy - 2, l1); if (swh !== null) seg(x, cy + 12, [[num(swh, 1), ln && ln.accent ? C.accent : C.text], [' Wh', C.text3]]); }
        else { seg(x, cy - 2, l1); seg(x, cy + 12, [[num(sg, 1), C.text], [' m gap', C.text3]]); }
      });
      const ry = HEAD + lanes.length * LH + 4; c.fillStyle = C.text3; c.font = `400 10px ${C.mono}`; c.textAlign = 'left'; c.fillText('behind lead', 12, ry + 14); c.textAlign = 'center';
      const stepM = [10, 20, 50].find(s => s * ppm >= 40) || 100;
      for (let m = 0; xl - m * ppm >= gl + 4; m += stepM) { const x = Math.round(xl - m * ppm); c.fillRect(x, ry, 1, 4); c.fillText(m + ' m', x, ry + 14); }
    }
    layout() {
      const cv = this.cv, W = Math.floor(cv.parentNode.clientWidth); if (!W) return;
      const D = this.data; if (D && D.multi) { this.h = D.H; cv.parentNode.style.height = D.H + 'px'; }
      this.W = W; this.dpr = window.devicePixelRatio || 1; cv.width = Math.round(W * this.dpr); cv.height = Math.round(this.h * this.dpr);
      if (D && D.multi) { const nar = W < 600; this.gl = nar ? 76 : 112; this.gr = nar ? 84 : 156; this.ppm = clamp((W - this.gl - this.gr - 36) / (D.maxGap + 2 * CAR), 3, D.single ? 24 : 16); this.xl = W - this.gr - 14 - CAR * this.ppm; }
      else if (D) { const tot = (D.ahead + D.behind) * 1.04; this.ppm = clamp((W - 24) / tot, 4, 16); this.x0 = 12 + D.behind * this.ppm; }
      this.buildSprites(); this.ui(); this.draw();
    }
    ui() {
      const D = this.data; if (!D) return;
      this.btn.innerHTML = icon(this.playing ? 'pause' : 'play'); this.btn.setAttribute('aria-label', this.playing ? 'Pause' : 'Play');
      this.sl.value = this.t; this.tl.textContent = this.W < 480 ? this.t.toFixed(1) + ' s' : this.t.toFixed(1) + ' / ' + D.T.toFixed(1) + ' s';
    }
    play() { const D = this.data; if (!D) return; if (this.t >= D.T - 1e-6) this.t = 0; this.playing = true; this.last = 0; this.ui(); this.sched(); }
    pause() { this.playing = false; this.last = 0; this.hold = 0; this.ui(); }
    seek(t) { if (!this.data) return; this.t = clamp(t, 0, this.data.T); this.frame(true); }
    sched() { if (!this.raf && this.playing && this.vis && !document.hidden) this.raf = requestAnimationFrame(ts => this.tick(ts)); }
    tick(ts) {
      this.raf = 0; if (!this.playing || !this.vis || document.hidden) { this.last = 0; return; }
      const D = this.data, dtS = this.last ? Math.min(0.05, (ts - this.last) / 1000) : 0; this.last = ts;
      if (this.hold) { if (ts < this.hold) { this.sched(); return; } this.hold = 0; this.t = 0; }
      this.t += dtS * this.mult;
      if (this.t >= D.T) { this.t = D.T; if (this.loop) this.hold = ts + 1500; else this.playing = false; }
      this.frame(); this.sched();
    }
    frame(force) {
      const D = this.data, t0 = performance.now(); this.draw(); const ms = performance.now() - t0; this.st.n++; this.st.sum += ms; this.st.max = Math.max(this.st.max, ms);
      this.ui(); const idx = Math.round(this.t / D.dt);
      if (force || idx !== this.lastIdx) { this.lastIdx = idx; this.emit(this.t); }
    }
    emit(t) { window.dispatchEvent(new CustomEvent('ev:scrub', { detail: { t, src: this.id, scope: this.scope } })); }
    /* scrubber, not hover: a press or drag on a chart (phase down / drag) pauses and sets the time; release (up) leaves it paused there until Play is pressed. Hover (phase hover) never moves the view. */
    onScrub(d) {
      if (d.scope !== this.scope || d.src !== 'chart' || !this.data) return;
      if (d.phase !== 'down' && d.phase !== 'drag') return;
      if (d.t === null || d.t === undefined) return;
      if (this.playing) this.pause(); this.t = clamp(d.t, 0, this.data.T); this.frame(true);
    }
    draw() {
      const D = this.data; if (!D || !this.W || !this.vis) return;
      if (D.multi) return this.drawMulti();
      const c = this.ctx, W = this.W, H = this.h, C = this.col, ppm = this.ppm, f = this.t / D.dt;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.clearRect(0, 0, W, H);
      const pE = lerp(D.ego.pos, f), pL = lerp(D.L, f), X = m => this.x0 + (m - pE) * ppm, roadTop = H - 34, roadH = 16, w0 = pE - this.x0 / ppm - 30, w1 = pE + (W - this.x0) / ppm + 30;
      c.fillStyle = C.raised; c.fillRect(0, roadTop, W, roadH); c.fillStyle = C.line2; c.fillRect(0, roadTop, W, 1); c.fillRect(0, roadTop + roadH - 1, W, 1);
      c.globalAlpha = 0.55; c.fillStyle = C.text3;
      for (let k = Math.floor(w0 / 24); k * 24 < w1; k++) { const a = X(k * 24), b = X(k * 24 + 10); c.fillRect(a, roadTop + roadH / 2 - 0.75, b - a, 1.5); }
      c.globalAlpha = 1;
      const steps = [10, 20, 50, 100, 200, 500], ls = steps.find(s => s * ppm >= 64) || 1000; c.font = `400 10px ${C.mono}`; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
      for (let k = Math.ceil(Math.max(0, w0) / 10); k * 10 < w1; k++) { const m = k * 10, x = X(m), big = m % ls === 0; c.fillStyle = C.text3; c.fillRect(Math.round(x), roadTop + roadH, 1, big ? 5 : 3); if (big) c.fillText(m + ' m', x, roadTop + roadH + 16); }
      const chPx = this.carH(); this.cl = 0; this.cr = W;
      const rp = D.rec ? lerp(D.rec.pos, f) : null;
      if (pL !== null) {
        c.strokeStyle = C.text3; c.lineWidth = 1; c.beginPath(); const gy = roadTop - chPx - 7, gx1 = Math.round(X(pE)) + 0.5, gx2 = Math.round(X(pL)) + 0.5; c.moveTo(gx1, gy - 3); c.lineTo(gx1, gy + 3); c.moveTo(gx1, gy); c.lineTo(gx2, gy); c.moveTo(gx2, gy - 3); c.lineTo(gx2, gy + 3); c.stroke();
        this.drawCar(X(pL + CAR), pL + CAR, 'lead', C.text3, roadTop, lerp(D.leadAcc, f));
      }
      if (rp !== null) this.drawCar(X(rp), rp, 'rec', C.text, roadTop, null);
      this.drawCar(X(pE), pE, D.ego.accent ? 'ours' : 'other', D.ego.accent ? C.accent : C.text2, roadTop, lerp(D.ego.acc, f));
      c.textAlign = 'left'; c.font = `400 12px ${C.mono}`;
      const num = (v, d) => (v === null ? '-' : v.toFixed(d)), seg = (x, y, parts) => { for (const [s, col] of parts) { c.fillStyle = col; c.fillText(s, x, y); x += c.measureText(s).width; } return x; };
      const v = lerp(D.ego.v, f), g = lerp(D.ego.gap, f), gp = 14;
      let x = seg(12, 20, [['t ', C.text3], [(this.t).toFixed(1), C.text], [' s', C.text3]]);
      x = seg(x + gp, 20, [[v === null ? '-' : String(Math.round(v * 3.6)), C.text], [' km/h', C.text3]]);
      seg(x + gp, 20, [['gap ', C.text3], [num(g, 1), C.text], [' m', C.text3]]);
      if (D.ego.wh) { const e = lerp(D.ego.wh, f); x = seg(12, 38, [[num(e, 1), D.ego.accent ? C.accent : C.text], [' Wh', C.text3]]); if (D.rec && D.rec.wh) seg(x + gp, 38, [['recorded ', C.text3], [num(lerp(D.rec.wh, f), 1), C.text], [' Wh', C.text3]]); }
    }
  }

  const RoadView = { create: (el, o) => new Road(el, o), all: ALL, hero: null, reduced, carLen: CAR, sprites: SP };
  window.RoadView = RoadView;
  /* hero strip: autoplays the hero window from the data embedded in the page (no engine, no fetch) */
  const hh = document.getElementById('rv-hero'), hd = document.getElementById('hero-data');
  if (hh && hd) {
    const H = JSON.parse(hd.textContent); RoadView.hero = new Road(hh, { id: 'rv-hero', scope: 'hero', height: 120, loop: true, speed: 10 });
    RoadView.hero.setData({ t: H.t, lead: H.lead, ego: { name: 'Our car (MPC)', accent: true, v: H.mpc_v, gap: H.mpc_gap, wh: null }, rec: { v: H.rec_v, gap: H.rec_gap, wh: null } }, { autoplay: true });
  }
})();
