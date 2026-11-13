'use strict';
/* Road view: a side view of one lane, replayed from the same traces the charts draw (lead speed, gaps, speeds, cumulative energy).
   Positions: the lead car's position is the integral of its speed; every follower is placed at (lead position - its own gap), so the picture only
   shows what the traces contain. Cars are drawn at 4.5 m. No Python runtime is needed, so the hero strip works before (or without) the engine.
   Charts and this view share one event: window 'ev:scrub' {t, src, scope}; t = null clears the marker. */
(function () {
  const ICON = { play: '<polygon points="6 3 20 12 6 21 6 3"/>', pause: '<rect x="14" y="4" width="4" height="16" rx="1"/><rect x="6" y="4" width="4" height="16" rx="1"/>' };
  const icon = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
  const CAR = 4.5, ALL = [];
  let uid = 0;
  const fin = v => v !== null && v !== undefined && Number.isFinite(v);
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function lerp(arr, f) {
    const n = arr.length, i0 = clamp(Math.floor(f), 0, n - 1), i1 = Math.min(i0 + 1, n - 1), a = arr[i0], b = arr[i1], u = clamp(f - i0, 0, 1);
    if (fin(a) && fin(b)) return a + (b - a) * u; return fin(a) ? a : (fin(b) ? b : null);
  }
  function colors() {
    const s = getComputedStyle(document.documentElement), g = n => s.getPropertyValue(n).trim();
    return { text: g('--text'), text2: g('--text2'), text3: g('--text3'), raised: g('--raised'), card: g('--card'), accent: g('--accent'), line2: g('--line2'), mono: g('--mono') || 'ui-monospace,monospace' };
  }

  class Road {
    constructor(host, o) {
      o = o || {}; this.id = o.id || 'rv' + (++uid); this.scope = o.scope || this.id; this.h = o.height || 120; this.loop = !!o.loop; this.mult = o.speed || 10;
      this.t = 0; this.playing = false; this.data = null; this.vis = true; this.W = 0; this.dpr = 1; this.raf = 0; this.last = 0; this.hold = 0; this.lastIdx = -1; this.hover = null;
      this.st = { n: 0, sum: 0, max: 0 }; this.col = colors();
      host.classList.add('rv');
      host.innerHTML = `<div class="rv-cv" style="height:${this.h}px"><canvas role="img" aria-label="Side view of the lead car, the recorded follower and our car, replayed at the chosen speed"></canvas></div>` +
        `<div class="rv-ctl"><button type="button" class="rv-play" aria-label="Play">${icon('play')}</button>` +
        `<div class="seg" role="radiogroup" aria-label="Replay speed">${[5, 10, 20].map(m => `<label><input type="radio" name="${this.id}-spd" value="${m}"${m === this.mult ? ' checked' : ''}><span>${m}x</span></label>`).join('')}</div>` +
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
      ALL.push(this);
    }
    recolor() { this.col = colors(); this.draw(); }
    /* d = { t, lead, ego: {name, accent, v, gap, wh|null}, rec: {v, gap, wh|null} | null } */
    setData(d, o) {
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
      this.data = { n, dt, T: (n - 1) * dt, L, ego, rec, lead, ahead: ahead + CAR, behind: behind + CAR + 1 };
      this.t = 0; this.lastIdx = -1; this.hold = 0;
      this.sl.max = this.data.T.toFixed(1); this.sl.value = 0;
      this.lg.innerHTML = `<span class="lg"><span class="rv-sw is-lead"></span>Lead car</span>` + (rec ? `<span class="lg"><span class="rv-sw is-rec"></span>Recorded follower</span>` : '') +
        `<span class="lg"><span class="rv-sw ${ego.accent ? 'is-ours' : 'is-other'}"></span>${ego.accent ? 'Our car (MPC)' : ego.name}</span>`;
      this.layout(); this.ui();
      if (o.autoplay && !reduced()) this.play();
    }
    layout() {
      const cv = this.cv, W = Math.floor(cv.parentNode.clientWidth); if (!W) return;
      this.W = W; this.dpr = window.devicePixelRatio || 1; cv.width = Math.round(W * this.dpr); cv.height = Math.round(this.h * this.dpr);
      const D = this.data; if (D) { const tot = (D.ahead + D.behind) * 1.04; this.ppm = clamp((W - 24) / tot, 4, 16); this.x0 = 12 + D.behind * this.ppm; }
      this.ui(); this.draw();
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
    /* hover on a chart previews that time here; leaving restores the previous frame and resumes playback if it was running */
    onScrub(d) {
      if (d.scope !== this.scope || d.src !== 'chart' || !this.data) return;
      if (d.t === null || d.t === undefined) { if (this.hover) { const h = this.hover; this.hover = null; this.t = h.t; this.frame(true); if (h.was) this.play(); } return; }
      if (!this.hover) { this.hover = { t: this.t, was: this.playing }; this.pause(); }
      this.t = clamp(d.t, 0, this.data.T); this.draw(); this.ui();
    }
    draw() {
      const D = this.data; if (!D || !this.W || !this.vis) return;
      const c = this.ctx, W = this.W, H = this.h, C = this.col, ppm = this.ppm, f = this.t / D.dt;
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); c.clearRect(0, 0, W, H);
      const pE = lerp(D.ego.pos, f), pL = lerp(D.L, f), X = m => this.x0 + (m - pE) * ppm, roadTop = H - 34, roadH = 16, w0 = pE - this.x0 / ppm - 30, w1 = pE + (W - this.x0) / ppm + 30;
      c.fillStyle = C.raised; c.fillRect(0, roadTop, W, roadH); c.fillStyle = C.line2; c.fillRect(0, roadTop, W, 1); c.fillRect(0, roadTop + roadH - 1, W, 1);
      c.globalAlpha = 0.55; c.fillStyle = C.text3;
      for (let k = Math.floor(w0 / 24); k * 24 < w1; k++) { const a = X(k * 24), b = X(k * 24 + 10); c.fillRect(a, roadTop + roadH / 2 - 0.75, b - a, 1.5); }
      c.globalAlpha = 1;
      const steps = [10, 20, 50, 100, 200, 500], ls = steps.find(s => s * ppm >= 64) || 1000; c.font = `400 10px ${C.mono}`; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
      for (let k = Math.ceil(Math.max(0, w0) / 10); k * 10 < w1; k++) { const m = k * 10, x = X(m), big = m % ls === 0; c.fillStyle = C.text3; c.fillRect(Math.round(x), roadTop + roadH, 1, big ? 5 : 3); if (big) c.fillText(m + ' m', x, roadTop + roadH + 16); }
      const carH = Math.max(10, CAR * ppm * 0.4), wr = Math.max(2.5, carH * 0.19), bodyH = carH * 0.72, bodyBottom = roadTop - wr * 1.1, bodyTop = bodyBottom - bodyH, len = CAR * ppm;
      const car = (front, kind, col) => {
        const x2 = X(front), x1 = x2 - len; if (x2 < -4 || x1 > W + 4) return;
        c.lineWidth = 1.5; c.strokeStyle = col; c.fillStyle = kind === 'rec' ? 'rgba(0,0,0,0)' : col;
        c.beginPath(); if (c.roundRect) c.roundRect(x1, bodyTop, len, bodyH, 3); else c.rect(x1, bodyTop, len, bodyH); if (kind !== 'rec') c.fill(); else c.stroke();
        for (const u of [0.22, 0.78]) { c.beginPath(); c.arc(x1 + len * u, roadTop - wr, wr, 0, 6.2832); c.fillStyle = C.card; c.fill(); c.stroke(); }
      };
      const rp = D.rec ? lerp(D.rec.pos, f) : null;
      if (pL !== null) {
        c.strokeStyle = C.text3; c.lineWidth = 1; c.beginPath(); const gy = bodyTop - 7, gx1 = Math.round(X(pE)) + 0.5, gx2 = Math.round(X(pL)) + 0.5; c.moveTo(gx1, gy - 3); c.lineTo(gx1, gy + 3); c.moveTo(gx1, gy); c.lineTo(gx2, gy); c.moveTo(gx2, gy - 3); c.lineTo(gx2, gy + 3); c.stroke();
        car(pL + CAR, 'lead', C.text3);
      }
      if (rp !== null) car(rp, 'rec', C.text);
      car(pE, 'ours', D.ego.accent ? C.accent : C.text2);
      c.textAlign = 'left'; c.font = `400 12px ${C.mono}`;
      const num = (v, d) => (v === null ? '-' : v.toFixed(d)), seg = (x, y, parts) => { for (const [s, col] of parts) { c.fillStyle = col; c.fillText(s, x, y); x += c.measureText(s).width; } return x; };
      const v = lerp(D.ego.v, f), g = lerp(D.ego.gap, f), gp = 14;
      let x = seg(12, 20, [['t ', C.text3], [(this.t).toFixed(1), C.text], [' s', C.text3]]);
      x = seg(x + gp, 20, [[v === null ? '-' : String(Math.round(v * 3.6)), C.text], [' km/h', C.text3]]);
      seg(x + gp, 20, [['gap ', C.text3], [num(g, 1), C.text], [' m', C.text3]]);
      if (D.ego.wh) { const e = lerp(D.ego.wh, f); x = seg(12, 38, [[num(e, 1), D.ego.accent ? C.accent : C.text], [' Wh', C.text3]]); if (D.rec && D.rec.wh) seg(x + gp, 38, [['recorded ', C.text3], [num(lerp(D.rec.wh, f), 1), C.text], [' Wh', C.text3]]); }
    }
  }

  const RoadView = { create: (el, o) => new Road(el, o), all: ALL, hero: null, reduced };
  window.RoadView = RoadView;
  /* hero strip: autoplays the hero window from the data embedded in the page (no engine, no fetch) */
  const hh = document.getElementById('rv-hero'), hd = document.getElementById('hero-data');
  if (hh && hd) {
    const H = JSON.parse(hd.textContent); RoadView.hero = new Road(hh, { id: 'rv-hero', scope: 'hero', height: 120, loop: true, speed: 10 });
    RoadView.hero.setData({ t: H.t, lead: H.lead, ego: { name: 'Our car (MPC)', accent: true, v: H.mpc_v, gap: H.mpc_gap, wh: null }, rec: { v: H.rec_v, gap: H.rec_gap, wh: null } }, { autoplay: true });
  }
})();
