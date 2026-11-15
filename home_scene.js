'use strict';
/* Home scene (round s): a dark, calm scene card with two STYLISED 3D cars driving the real recorded window (data/hero.json, embedded in the page as #hm-data).
   Lead car = recorded lead speed; our car = our MPC controller's simulated run behind it; gaps to scale; battery power per step computed at build time with the project's own
   plant functions (demo_v2/export_hero_power.py, python/mpc_acc.py). Four hotspots anchored to 3D points (the gap, the battery, regen, the planner) open detail views over the card.
   The playback time is ONE clock shared with the window chart card beside it: this script announces its time as ev:scrub (scope hero) and follows the chart when it is hovered.
   three.js r170 is loaded from the jsDelivr CDN as hero3d.js did; without WebGL or on a load error a pre-rendered still with the same hotspots is shown.
   The hotspot interaction is inspired by the VEYRA interactive car by Amir Music (MIT); no VEYRA code or media is used here. */
(function () {
  var root = document.getElementById('hs'), dataEl = document.getElementById('hm-data');
  if (!root || !dataEl) return;
  var DATA = JSON.parse(dataEl.textContent), H = DATA.hero, SYSTEMS = DATA.systems, HOT = DATA.hotspots, PR = DATA.params, STILL = DATA.still || {};
  var THREE_URL = window.__THREE_URL || 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
  var $ = function (s, r) { return (r || root).querySelector(s); }, html = document.documentElement;
  var ICON = {
    plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5v14"/></svg>',
    arrow: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg>',
    back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7M19 12H5"/></svg>',
    play: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>',
    pause: '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>'
  };
  function el(tag, cls, attrs, inner) {
    var n = document.createElement(tag); if (cls) n.className = cls;
    if (attrs) for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    if (inner !== undefined) n.innerHTML = inner; return n;
  }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); }, lerp = function (a, b, u) { return a + (b - a) * u; };
  var ease = function (u) { u = clamp(u, 0, 1); return u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };
  var fx = function (v, d) { return v.toFixed(d).replace('-', '−'); };

  /* ------------------------------------------------------------ DOM */
  var stage = $('.hs-stage'), plane = $('.hs-plane'), glCanvas = $('.hm-gl'), stillImg = $('.hm-still'), fadeEl = $('.hm-fade'), ov = $('.hm-ov'),
      hotLayer = $('.hs-hotlayer'), annoLayer = $('.hs-annolayer'), backSlot = $('.hs-backslot'), detail = $('.hs-detail'),
      statusEl = $('.hs-status'), sr = $('.hs-sr'), errEl = $('.hs-error'), bar = $('.hm-bar'), playBtn = $('[data-play]'), scrub = $('.hm-scrub'),
      speedBtns = Array.prototype.slice.call(root.querySelectorAll('[data-speed]'));
  var RD = {}; Array.prototype.forEach.call(root.querySelectorAll('[data-r]'), function (n) { RD[n.getAttribute('data-r')] = n; });

  /* ------------------------------------------------------------ data */
  var N = H.v.length, DT = H.dt, TEND = (N - 1) * DT, LANE = -1.75, CARL = 4.5, HALF = CARL / 2;
  var X = [0], XL = [0];
  for (var i = 0; i < N - 1; i++) { X.push(X[i] + 0.5 * (H.v[i] + H.v[i + 1]) * DT); XL.push(XL[i] + 0.5 * (H.lead[i] + H.lead[i + 1]) * DT); }
  function samp(a, t) { var f = clamp(t / DT, 0, a.length - 1), i = Math.min(Math.floor(f), a.length - 2); return a[i] + (a[i + 1] - a[i]) * (f - i); }
  function stepSamp(a, t) { var f = clamp(t / DT - 0.5, 0, a.length - 1), i = Math.min(Math.floor(f), a.length - 2); return a[i] + (a[i + 1] - a[i]) * (f - i); }
  function posAt(t) { var k = Math.min(Math.floor(t / DT), N - 2), tau = t - k * DT, a = (H.v[k + 1] - H.v[k]) / DT; return X[k] + H.v[k] * tau + 0.5 * a * tau * tau; }
  function leadTravel(t0, t1) { return samp2(XL, t1) - samp2(XL, t0); }
  function samp2(a, t) { var f = clamp(t / DT, 0, N - 1), i = Math.min(Math.floor(f), N - 2), u = f - i, k = a === XL ? H.lead : null; var v0 = k[i], v1 = k[i + 1], tau = u * DT; return a[i] + v0 * tau + 0.5 * (v1 - v0) / DT * tau * tau; }
  function snap(t) {
    t = clamp(t, 0, TEND); var k = Math.min(Math.floor(t / DT), N - 2);
    return { t: t, xe: posAt(t), gap: samp(H.gap, t), v: samp(H.v, t), lead: samp(H.lead, t), pb: stepSamp(H.pb, t), pw: stepSamp(H.pw, t), rg: stepSamp(H.rg, t), bk: stepSamp(H.bk, t), acc: (H.v[k + 1] - H.v[k]) / DT };
  }
  var T_STILL = (function () { var m = 0, mi = 0; for (var i = 0; i < H.rg.length; i++) if (H.rg[i] > m) { m = H.rg[i]; mi = i; } return clamp((mi + 0.5) * DT, 0, TEND); })();

  /* ------------------------------------------------------------ state */
  var S = { phase: 'overview', selected: 'gap', hovered: null, annotation: null, mode: 'loading', reduced: false, playing: true, speed: 4, t: 0, error: '' };
  var mqReduce = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  S.reduced = !!((mqReduce && mqReduce.matches) || html.classList.contains('rm'));
  if (S.reduced) { S.playing = false; S.t = T_STILL; }
  var phone = function () { return window.innerWidth <= 600; }, PANEL_MIN = 640;
  var fitMode = function () { return window.innerWidth >= 1024 && window.innerHeight >= 560; };   // desktop: the hero band is exactly one screen high and the scene fills its card
  var panel = function () { return stage.clientWidth >= (fitMode() ? 500 : PANEL_MIN); };   // wide card: the detail card overlays the scene (else it opens under the scene, inside the card)
  var panelFrac = function () { if (!panel()) return 0; var w = detail.offsetWidth || Math.min(380, Math.max(290, stage.clientWidth * 0.42)); return clamp((w + 14) / Math.max(1, plane.clientWidth), 0, 0.55); };
  var ASPECT = 16 / 9, G = null, failed = false, visible = true, raf = 0, rendering = false;
  var transT0 = 0, transDur = 0, kDet = 0, kFrom = 0, kTo = 0, request = 0, timer = 0;
  var vis = { gap: 0, xray: 0, regen: 0, planner: 0 }, spd = 4, scrubbing = false, loopState = 0, loopT = 0, wall = 0, lastTextAt = 0;
  var fpsLog = { n: 0, t0: 0, v: 0, min: 1e9, total: 0 };

  /* ------------------------------------------------------------ plane geometry */
  function updatePlane() {
    setNavH();
    var pw = plane.clientWidth, ph = plane.clientHeight;
    ASPECT = pw > 20 && ph > 20 ? pw / ph : (phone() ? 1.25 : 16 / 9);   // the plane has the card's real shape (it is no longer fixed at 16:9 on desktop)
    root.style.setProperty('--hs-h', ph + 'px');
    var po = panel(); if (po !== lastPanel) { lastPanel = po; render(); }
    if (G) { G.resize(); G.cs.fresh = 1; } requestDraw(); placeStillHot();
  }
  var lastPanel = null;
  var navEl = document.querySelector('header.nav');
  function setNavH() { if (navEl) document.documentElement.style.setProperty('--nav-h', navEl.getBoundingClientRect().height + 'px'); }

  /* ------------------------------------------------------------ small DOM pieces: hotspots, overlay tags, back button, detail card */
  var hotBtn = {}, annoBtn = [], tags = {};
  HOT.forEach(function (item) {
    var b = el('button', 'hs-hotspot', { type: 'button', 'aria-label': item.aria, 'data-id': item.id }, '<span class="hs-ring">' + ICON.plus + '</span><span class="hs-label">' + esc(item.label) + ICON.arrow + '</span>');
    b.addEventListener('pointerenter', function () { var ae = document.activeElement; if (ae && ae !== b && ae.classList && ae.classList.contains('hs-hotspot')) ae.blur(); if (S.phase === 'overview') set({ hovered: item.id }); });
    b.addEventListener('pointerleave', function () { set({ hovered: null }); });
    b.addEventListener('focus', function () { if (S.phase === 'overview') set({ hovered: item.id }); });
    b.addEventListener('blur', function () { set({ hovered: null }); });
    b.addEventListener('click', function () { enter(item.id); });
    hotLayer.appendChild(b); hotBtn[item.id] = b;
  });
  function tag(id, cls) { var t = el('div', 'hm-tag ' + (cls || ''), { 'data-t': id }); ov.appendChild(t); tags[id] = { n: t, x: 0, y: 0, on: 0 }; return tags[id]; }
  tag('gap', ''); tag('dstar', 'soft'); tag('floor', 'soft'); tag('batt', ''); tag('regen', 'wide'); tag('pl1', 'soft'); tag('pl2', 'soft'); tag('pl3', 'soft'); tag('plc', 'soft');
  var backBtn = null, detailBuilt = null, detailShownOnce = 0;
  function buildDetail(id) {
    var s = SYSTEMS[id];
    var h = '<div class="hs-detail-introduction"><p class="hs-eyebrow">' + esc(s.category) + '</p><h2>' + s.title.split('\n').map(function (l) { return '<span>' + esc(l) + '</span>'; }).join('') + '</h2><p class="hs-system-description">' + esc(s.description) + '</p></div>' +
      '<div class="hs-detail-components"><div class="hs-part-list">';
    s.points.forEach(function (p, i) { h += '<button type="button" data-i="' + i + '" aria-expanded="false"><span class="hs-part-row"><small>' + ('0' + (i + 1)).slice(-2) + '</small>' + esc(p.label) + ICON.plus + '</span><span class="hs-part-description" hidden>' + esc(p.text) + '</span></button>'; });
    h += '</div><div class="hs-benefit"><span>' + esc(s.benefitHead) + '</span><p>' + esc(s.benefit) + '</p></div></div>';
    detail.innerHTML = h;
    Array.prototype.forEach.call(detail.querySelectorAll('.hs-part-list button'), function (b) { b.addEventListener('click', function () { var i = +b.getAttribute('data-i'); set({ annotation: S.annotation === i ? null : i }); }); });
    annoLayer.innerHTML = ''; annoBtn = [];
    s.points.forEach(function (p, i) {
      var a = el('button', 'hs-annotation', { type: 'button', 'aria-label': p.label, 'aria-expanded': 'false' }, '<span>' + ('0' + (i + 1)).slice(-2) + '</span><span class="hs-annotation-label">' + esc(p.label) + '</span>');
      a.addEventListener('click', function () { set({ annotation: S.annotation === i ? null : i }); }); annoLayer.appendChild(a); annoBtn.push(a);
    });
    detailBuilt = id;
  }

  /* ------------------------------------------------------------ phases: overview -> entering -> detail -> returning -> overview (camera eases, no cut) */
  function busy() { return S.phase === 'entering' || S.phase === 'returning'; }
  function enter(id) {
    if (S.phase !== 'overview') return;
    var token = ++request; S.selected = id; S.hovered = null; S.annotation = null; S.phase = 'entering';
    kFrom = kDet; kTo = 1; transT0 = performance.now(); transDur = S.reduced ? 0 : 950;
    clearTimeout(timer); timer = setTimeout(function () { if (request !== token) return; S.phase = 'detail'; kDet = 1; render(); setTimeout(function () { var b = $('.hs-back'); if (b) b.focus({ preventScroll: true }); }, 0); }, transDur);
    render();
  }
  function back() {
    if (S.phase !== 'detail') return;
    var token = ++request; S.phase = 'returning'; S.annotation = null; kFrom = kDet; kTo = 0; transT0 = performance.now(); transDur = S.reduced ? 0 : 800;
    clearTimeout(timer); timer = setTimeout(function () { if (request !== token) return; S.phase = 'overview'; kDet = 0; render(); var b = hotBtn[S.selected]; if (b) b.focus({ preventScroll: true }); }, transDur);
    render();
  }
  window.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') back(); });
  function set(patch) { for (var k in patch) S[k] = patch[k]; render(); }

  /* ------------------------------------------------------------ render(): sync DOM from S (not per frame) */
  function render() {
    if (rendering) return; rendering = true;
    try {
      var b = busy(), cur = SYSTEMS[S.selected], overview = S.phase === 'overview';
      root.className = 'hs hs-hm phase-' + S.phase + (panel() ? ' panel-on' : '') + (S.reduced ? ' reduced' : '') + (S.mode === 'gl' ? ' gl-on' : '') + (S.mode === 'still' ? ' still-on' : '');
      root.setAttribute('aria-busy', b ? 'true' : 'false');
      hotLayer.hidden = !(overview && S.mode !== 'loading');
      HOT.forEach(function (item) { hotBtn[item.id].className = 'hs-hotspot' + (S.hovered === item.id ? ' active' : ''); });
      if (!overview) {
        if (!backBtn) { backBtn = el('button', 'hs-back', { type: 'button', 'aria-label': 'Back to the moving cars' }, ICON.back + '<span></span><kbd>Esc</kbd>'); backBtn.addEventListener('click', back); backSlot.appendChild(backBtn); }
        backBtn.disabled = b; backBtn.querySelector('span').textContent = S.phase === 'returning' ? 'Returning' : 'Back to the cars';
      } else if (backBtn) { backBtn.remove(); backBtn = null; }
      if (detailBuilt !== S.selected) buildDetail(S.selected);
      if (S.phase === 'detail' && !panel() && !detailShownOnce) { detailShownOnce = 1; try { detail.scrollIntoView({ block: 'nearest', behavior: S.reduced ? 'auto' : 'smooth' }); } catch (e) { } } else if (S.phase === 'overview') { if (detailShownOnce && !panel()) { try { plane.scrollIntoView({ block: 'nearest', behavior: S.reduced ? 'auto' : 'smooth' }); } catch (e) { } } detailShownOnce = 0; }
      detail.className = 'hs-detail' + (S.phase === 'detail' ? ' shown' : ''); detail.setAttribute('aria-hidden', S.phase === 'detail' ? 'false' : 'true');
      Array.prototype.forEach.call(detail.querySelectorAll('.hs-part-list button'), function (pb, i) {
        var sel = S.annotation === i; pb.className = sel ? 'selected' : ''; pb.setAttribute('aria-expanded', sel ? 'true' : 'false'); pb.tabIndex = S.phase === 'detail' ? 0 : -1;
        pb.querySelector('.hs-part-description').hidden = !sel;
      });
      annoLayer.hidden = S.phase !== 'detail';
      annoBtn.forEach(function (a, i) { a.className = 'hs-annotation' + (S.annotation === i ? ' open' : ''); a.setAttribute('aria-expanded', S.annotation === i ? 'true' : 'false'); a.tabIndex = S.phase === 'detail' ? 0 : -1; });
      var st = S.mode === 'loading' ? 'Preparing the scene' : b ? (S.phase === 'returning' ? 'Returning to the cars' : 'Moving in on ' + cur.label.toLowerCase()) : '';
      statusEl.hidden = !st; statusEl.innerHTML = st ? '<span class="hs-small-dot"></span>' + esc(st) : '';
      sr.textContent = b ? (S.phase === 'entering' ? 'Opening ' : 'Closing ') + cur.label : S.phase === 'detail' ? cur.label + ' view. Press Escape to return.' : 'Moving cars. Choose a point.';
      errEl.hidden = !S.error; errEl.querySelector('span').textContent = S.error || '';
      var base = document.querySelector('.hs-baseline-r'); if (base) base.textContent = overview ? 'Hover or tap a point. Press Escape to come back.' : 'Playback is paused while you read.';
      playBtn.innerHTML = S.playing ? ICON.pause : ICON.play; playBtn.setAttribute('aria-label', S.playing ? 'Pause' : 'Play');
      speedBtns.forEach(function (sb) { sb.setAttribute('aria-pressed', +sb.getAttribute('data-speed') === S.speed ? 'true' : 'false'); });
      var ctl = !S.reduced; playBtn.hidden = !ctl; $('.hm-speeds').hidden = !ctl;
      bar.classList.toggle('dim', !overview);
      if (G === null && S.mode === 'still') placeStillHot();
      requestDraw();
    } finally { rendering = false; }
  }
  errEl.querySelector('button').addEventListener('click', function () { set({ error: '' }); });
  playBtn.addEventListener('click', function () { set({ playing: !S.playing }); });
  speedBtns.forEach(function (b) { b.addEventListener('click', function () { set({ speed: +b.getAttribute('data-speed') }); }); });
  scrub.addEventListener('pointerdown', function () { scrubbing = true; });
  scrub.addEventListener('input', function () { S.t = +scrub.value / 1000 * TEND; if (G) G.cs.fresh = 1; loopState = 0; fadeEl.style.opacity = 0; requestDraw(); });
  ['pointerup', 'change', 'blur', 'pointercancel'].forEach(function (ev) { scrub.addEventListener(ev, function () { scrubbing = false; }); });

  /* ------------------------------------------------------------ fallback: pre-rendered still with the same hotspots */
  var STILLHOT = STILL.hot || { gap: [47, 52], battery: [36, 78], regen: [27, 72], planner: [36, 30] };
  function coverXY(p) {   // image percent (16:9) -> frame percent when the frame is narrower (object-fit: cover, centred)
    var fr = ASPECT, im = 16 / 9; if (Math.abs(fr - im) < 0.001) return p;
    if (fr > im) { var hh = im / fr; return [p[0], clamp(50 + (p[1] - 50) / hh, 6, 94)]; }   // frame wider than the picture: top and bottom are cropped
    var w = fr / im; return [clamp(50 + (p[0] - 50) / w, 3, 97), p[1]];
  }
  function placeStillHot() {
    if (S.mode !== 'still') return;
    HOT.forEach(function (item) { var p = coverXY(STILLHOT[item.id] || [50, 50]); hotBtn[item.id].style.left = p[0] + '%'; hotBtn[item.id].style.top = p[1] + '%'; });
    var f = coverXY(STILLHOT[S.selected] || [50, 50]); stillImg.style.transformOrigin = f[0] + '% ' + f[1] + '%';
    annoBtn.forEach(function (a, i) { var o = [[0, -9], [9, 6], [-9, 8]][i]; a.style.left = clamp(f[0] + o[0], 5, 95) + '%'; a.style.top = clamp(f[1] + o[1], 8, 92) + '%'; });
  }
  function toStill(msg) {
    failed = true; S.mode = 'still'; if (msg) console.warn('home scene: 3D not available (' + msg + '), showing the still'); render(); placeStillHot();
    // the still has no moving parts: readout shows the still moment, and the controls are hidden
    paintReadout(snap(STILL.t !== undefined ? STILL.t : T_STILL), true); bar.classList.add('static');
  }

  /* ------------------------------------------------------------ readout */
  function paintReadout(s, force) {
    var now = performance.now(); if (!force && now - lastTextAt < 90) return; lastTextAt = now;
    RD.t.textContent = fx(s.t, 1) + ' s'; RD.v.textContent = fx(s.v, 1) + ' m/s'; RD.vk.textContent = fx(s.v * 3.6, 0) + ' km/h'; RD.g.textContent = fx(s.gap, 1) + ' m';
    RD.p.textContent = (s.pb > 0 ? '+' : s.pb < 0 ? '−' : '') + fx(Math.abs(s.pb), 1) + ' kW'; RD.ps.textContent = s.pb >= 0 ? 'from the battery' : 'to the battery'; RD.l.textContent = fx(s.lead, 1) + ' m/s';
    if (!scrubbing) scrub.value = Math.round(s.t / TEND * 1000);
    if (!chartHold && (force || Math.abs(s.t - lastAnn) > 1e-6)) { lastAnn = s.t; window.dispatchEvent(new CustomEvent('ev:scrub', { detail: { t: s.t, src: 'scene', scope: 'hero' } })); }   // the window chart card draws its cursor and readout from this one clock
  }
  var chartHold = false, lastAnn = -1;
  window.addEventListener('ev:scrub', function (e) {   // hovering or dragging on the chart scrubs the scene; leaving it lets the clock run on
    var d = e.detail || {}; if (d.scope !== 'hero' || d.src !== 'chart') return;
    if (d.t === null || d.t === undefined) { chartHold = false; return; }
    chartHold = true; S.t = clamp(d.t, 0, TEND); loopState = 0; fadeEl.style.opacity = 0; if (G) G.cs.fresh = 1; requestDraw(); if (S.reduced) paintReadout(snap(S.t), true);
  });

  /* ------------------------------------------------------------ three.js scene */
  var mqDark = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  function pal() {   // scene colours follow the site theme (the CSS variables of styles.css), recomputed when the system theme changes
    var dark = !mqDark || mqDark.matches;
    return dark ? { dark: true, bg: 0x141415, floor: 0x1d1e21, grid: 0x3b3e44, road: 0.05, dash: 0xb4b9bf, edge: 0x6b7077, pool: 0.20, env: 0x30353b, envK: 0.8, hemiSky: 0xcfd8e2, hemiGnd: 0x26282c, hemiI: 0.55, key: 1.15, rim: 1.9, shadow: 0.7, accent: 0x2dd4bf }
                : { dark: false, bg: 0xfafafa, floor: 0xe7e8ea, grid: 0xc4c7cc, road: 0.10, dash: 0xf2f3f4, edge: 0xe3e5e7, pool: 0.16, env: 0xb8c0c8, envK: 1.0, hemiSky: 0xffffff, hemiGnd: 0x9aa2aa, hemiI: 0.75, key: 1.3, rim: 1.3, shadow: 0.5, accent: 0x14b8a6 };
  }
  var PAL = pal();
  var CAMP = [16, 11, 24, 0.42, 0.9, 1.5];   // azimuth deg, elevation deg, vertical fov, look-at weight toward the lead, target height
  function sceneBuild(THREE) {
    var P_ = PAL, BG = P_.bg, renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: false, powerPreference: 'default' });
    renderer.setClearColor(BG, 1); renderer.outputColorSpace = THREE.SRGBColorSpace;
    var scene = new THREE.Scene(); scene.fog = new THREE.Fog(BG, 38, 125);
    var camera = new THREE.PerspectiveCamera(CAMP[2], 16 / 9, 0.5, 400);
    var sc = new THREE.Color(BG);

    // studio light: a procedural environment (soft boxes) for reflections + one soft key + sky fill
    var pm = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.BoxGeometry(60, 30, 60), new THREE.MeshBasicMaterial({ color: P_.env, side: THREE.BackSide })));
    var sb = function (w, h, d, x, y, z, k) { var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: new THREE.Color(k * P_.envK, k * P_.envK, k * P_.envK * 1.04) })); m.position.set(x, y, z); envScene.add(m); };
    sb(26, 0.5, 9, 0, 13, 2, 3.2); sb(0.5, 9, 22, -20, 7, 0, 2.0); sb(0.5, 9, 22, 20, 7, 0, 1.6); sb(22, 7, 0.5, 0, 6, -22, 1.4); sb(8, 0.5, 8, 0, 0.2, 14, 0.7);
    var envTex = pm.fromScene(envScene, 0.035).texture; pm.dispose();
    var hemi = new THREE.HemisphereLight(P_.hemiSky, P_.hemiGnd, P_.hemiI); scene.add(hemi);
    var key = new THREE.DirectionalLight(0xffffff, P_.key); key.position.set(-8, 16, 9); scene.add(key);
    var rim = new THREE.DirectionalLight(0xb9d4ff, P_.rim); rim.position.set(16, 9, -13); scene.add(rim);   // cool rim light from behind the cars: edges of roof, shoulders and tail read on the dark floor
    var rim2 = new THREE.DirectionalLight(0xcdeee9, P_.rim * 0.5); rim2.position.set(-12, 6, -14); scene.add(rim2);

    // ground + road (follow the camera, so the road scrolls under the cars)
    var glowTex = (function () { var c = document.createElement('canvas'); c.width = c.height = 256; var x = c.getContext('2d'), g = x.createRadialGradient(128, 128, 0, 128, 128, 128); g.addColorStop(0, 'rgba(255,255,255,' + P_.pool + ')'); g.addColorStop(.5, 'rgba(255,255,255,' + (P_.pool * 0.35) + ')'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 256, 256); var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    var GS = 4, hx = function (n) { return '#' + ('000000' + n.toString(16)).slice(-6); };
    var gridTex = (function () { var c = document.createElement('canvas'); c.width = c.height = 256; var x = c.getContext('2d'); x.fillStyle = hx(P_.floor); x.fillRect(0, 0, 256, 256); x.strokeStyle = hx(P_.grid); x.lineWidth = 4; x.strokeRect(0, 0, 256, 256);
      var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); t.repeat.set(700 / GS, 400 / GS); return t; })();
    var floorM = new THREE.Mesh(new THREE.PlaneGeometry(700, 400).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: gridTex, depthWrite: false, depthTest: false })); floorM.position.y = -0.004; floorM.renderOrder = -3; scene.add(floorM);   // dark floor with a faint 4 m grid that fades into the backdrop through mip-maps and fog
    var pool = new THREE.Mesh(new THREE.PlaneGeometry(90, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, fog: false })); pool.position.y = 0.004; scene.add(pool);
    var RW = 7.2, rg = new THREE.PlaneGeometry(320, RW, 1, 8).rotateX(-Math.PI / 2), rc = [];
    for (var j = 0; j <= 8; j++) { var u = Math.abs(j / 8 - 0.5) * 2, shade = P_.road * (1.0 - 0.28 * Math.pow(u, 2.2)); for (var q = 0; q < 2; q++) rc.push(shade * 0.99, shade, shade * 1.03); }
    rg.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3));
    var road = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 })); road.position.y = 0.012; scene.add(road);
    var lineMat = new THREE.MeshBasicMaterial({ color: P_.dash }), edgeMat = new THREE.MeshBasicMaterial({ color: P_.edge }), edgeG = new THREE.PlaneGeometry(320, 0.13).rotateX(-Math.PI / 2), edges = [];
    [-RW / 2 + 0.28, RW / 2 - 0.28].forEach(function (z) { var m = new THREE.Mesh(edgeG, edgeMat); m.position.set(0, 0.02, z); scene.add(m); edges.push(m); });
    var DP = 9, DN = 40, dashes = new THREE.InstancedMesh(new THREE.PlaneGeometry(3, 0.13).rotateX(-Math.PI / 2), lineMat, DN), dashBase = NaN, dm = new THREE.Matrix4(); dashes.frustumCulled = false; scene.add(dashes);
    function placeDashes(cx) { var b = Math.floor(cx / DP) * DP; if (b === dashBase) return; dashBase = b; for (var i = 0; i < DN; i++) { dm.makeTranslation(b + (i - DN / 2) * DP, 0.02, 0); dashes.setMatrixAt(i, dm); } dashes.instanceMatrix.needsUpdate = true; }

    // soft contact shadows (blob textures)
    var shTex = (function () { var c = document.createElement('canvas'); c.width = 256; c.height = 128; var x = c.getContext('2d'); x.shadowColor = '#000'; x.shadowBlur = 26; x.fillStyle = '#000'; x.beginPath(); if (x.roundRect) x.roundRect(48, 38, 160, 52, 24); else x.rect(48, 38, 160, 52); x.fill(); var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    var shGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

    // ---------- profiles and the loft that makes the stylised body
    function mono(pts) {
      var n = pts.length, xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; }), d = [], m = [], i;
      for (i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
      m[0] = d[0]; m[n - 1] = d[n - 2]; for (i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
      for (i = 0; i < n - 1; i++) { if (d[i] === 0) { m[i] = m[i + 1] = 0; } else { var a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b; if (s > 9) { var t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; } } }
      return function (x) {
        if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1]; var k = 0; while (x > xs[k + 1]) k++;
        var h = xs[k + 1] - xs[k], t = (x - xs[k]) / h, t2 = t * t, t3 = t2 * t;
        return (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1];
      };
    }
    var sgn = function (v) { return v < 0 ? -1 : 1; };
    function loft(xs, ringFn, M, a0, a1, trim) {
      var closed = a0 === undefined, pos = [], col = [], idx = [], R = closed ? M : M + 1;
      xs.forEach(function (x) {
        var r = ringFn(x);
        for (var j = 0; j < R; j++) {
          var th = closed ? 2 * Math.PI * j / M : a0 + (a1 - a0) * j / M, c = Math.cos(th), s = Math.sin(th);
          var xn = sgn(c) * Math.pow(Math.abs(c), 2 / r.n), yn = sgn(s) * Math.pow(Math.abs(s), 2 / r.n);
          pos.push(x, r.ym + r.hh * yn, r.hw * xn * (yn > 0 ? 1 - r.tum * yn : 1));
          var tr = trim ? clamp((-yn - 0.32) / 0.34, 0, 1) : 0, k = 1 - 0.86 * tr * tr * (3 - 2 * tr); col.push(k, k, k);
        }
      });
      for (var i = 0; i < xs.length - 1; i++) for (var j2 = 0; j2 < M; j2++) {
        var a = i * R + j2, b = i * R + (closed ? (j2 + 1) % M : j2 + 1), c2 = (i + 1) * R + j2, d2 = (i + 1) * R + (closed ? (j2 + 1) % M : j2 + 1);
        idx.push(a, c2, b, b, c2, d2);
      }
      var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
    }
    var cosx = function (a, b, S) { var o = []; for (var i = 0; i <= S; i++) o.push(lerp(a, b, 0.5 - 0.5 * Math.cos(Math.PI * i / S))); return o; };
    var endE = function (x, L, rr, mw, mh) { var ax = Math.abs(x) - (L - rr); if (ax <= 0) return [1, 1]; var u = Math.min(1, ax / rr), q = Math.sqrt(1 - u * u); return [mw + (1 - mw) * q, mh + (1 - mh) * q]; };
    var bTop = mono([[-2.25, 0.86], [-2.12, 0.94], [-1.8, 0.99], [-1.0, 1.0], [0.4, 0.98], [1.2, 0.93], [1.9, 0.80], [2.25, 0.69]]),
        bBot = mono([[-2.25, 0.40], [-2.05, 0.27], [-1.2, 0.21], [1.2, 0.21], [2.0, 0.26], [2.25, 0.36]]),
        bWid = mono([[-2.25, 0.80], [-2.0, 0.88], [-1.0, 0.91], [1.0, 0.91], [2.0, 0.87], [2.25, 0.80]]);
    var bodyRing = function (x) { var e = endE(x, 2.25, 0.36, 0.84, 0.9), yt = bTop(x), yb = bBot(x); return { ym: (yt + yb) / 2, hh: (yt - yb) / 2 * e[1], hw: bWid(x) * e[0], n: 5, tum: 0.13 }; };
    var geoBody = loft(cosx(-2.25, 2.25, 44), bodyRing, 40, undefined, undefined, true);
    function capGeo(x, nx) {
      var r = bodyRing(x), pos = [], col = [], idx = [], M = 40; pos.push(x, r.ym, 0); col.push(1, 1, 1);
      for (var j = 0; j < M; j++) { var th = 2 * Math.PI * j / M, c = Math.cos(th), sn = Math.sin(th), xn = sgn(c) * Math.pow(Math.abs(c), 2 / r.n), yn = sgn(sn) * Math.pow(Math.abs(sn), 2 / r.n); pos.push(x, r.ym + r.hh * yn, r.hw * xn * (yn > 0 ? 1 - r.tum * yn : 1)); var tr = clamp((-yn - 0.32) / 0.34, 0, 1), k = 1 - 0.86 * tr * tr * (3 - 2 * tr); col.push(k, k, k); }
      for (var q = 0; q < M; q++) { var a1 = 1 + q, b1 = 1 + (q + 1) % M; if (nx > 0) idx.push(0, b1, a1); else idx.push(0, a1, b1); }
      var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
    }
    var geoCapF = capGeo(2.25, 1), geoCapR = capGeo(-2.25, -1);
    var cTop = mono([[-1.4, 0.96], [-1.25, 1.18], [-0.9, 1.40], [-0.2, 1.47], [0.3, 1.45], [0.78, 1.27], [1.14, 0.98]]);
    var cabinRing = function (x) { var e1 = clamp((x + 1.4) / 0.16, 0, 1), e2 = clamp((1.14 - x) / 0.16, 0, 1), e = Math.sqrt(1 - (1 - e1) * (1 - e1)) * Math.sqrt(1 - (1 - e2) * (1 - e2)), yt = cTop(x), yb = 0.80; return { ym: (yt + yb) / 2, hh: (yt - yb) / 2 * e, hw: 0.71 * e, n: 2.4, tum: 0.3 }; };
    var geoCabin = loft(cosx(-1.4, 1.14, 30), cabinRing, 36);
    var geoRoof = loft(cosx(-0.98, 0.42, 14), function (x) { var r = cabinRing(x); r.hh *= 1.0; r.hw *= 1.012; r.ym += 0.012; return r; }, 22, 0.62, Math.PI - 0.62);
    var tyreG = (function () { var p = [[0.2, -0.11], [0.27, -0.118], [0.318, -0.095], [0.334, -0.045], [0.334, 0.045], [0.318, 0.095], [0.27, 0.118], [0.2, 0.11]].map(function (a) { return new THREE.Vector2(a[0], a[1]); }); return new THREE.LatheGeometry(p, 30).rotateX(Math.PI / 2); })();
    var rimG = new THREE.CylinderGeometry(0.21, 0.21, 0.03, 32).rotateX(Math.PI / 2), hubG = new THREE.CylinderGeometry(0.055, 0.055, 0.07, 16).rotateX(Math.PI / 2), spokeG = new THREE.BoxGeometry(0.2, 0.07, 0.03);

    function makeCar(cfg) {
      var g = new THREE.Group(), mats = [], fade = [];
      var body = new THREE.MeshPhysicalMaterial({ color: cfg.body, vertexColors: true, roughness: 0.34, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 1.0 });
      var roof = new THREE.MeshPhysicalMaterial({ color: cfg.roof, roughness: 0.3, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.1, side: THREE.DoubleSide });
      var glass = new THREE.MeshPhysicalMaterial({ color: 0x0d151b, roughness: 0.16, metalness: 0.0, clearcoat: 0.6, clearcoatRoughness: 0.12, envMapIntensity: 0.9 });
      var rimM = new THREE.MeshStandardMaterial({ color: 0xcfd6db, roughness: 0.28, metalness: 0.85, emissive: P_.accent, emissiveIntensity: 0 }), rimR = rimM.clone(), tyreM = new THREE.MeshStandardMaterial({ color: 0x15191c, roughness: 0.85 });
      var plateM = new THREE.MeshStandardMaterial({ color: 0x2a3136, roughness: 0.5, metalness: 0.6, envMap: envTex }), archM = new THREE.MeshBasicMaterial({ color: 0x04070a }), tailM = new THREE.MeshStandardMaterial({ color: 0x3a0306, emissive: 0xff1608, emissiveIntensity: 0.7, roughness: 0.3 }), headM = new THREE.MeshStandardMaterial({ color: 0xdfeaf2, emissive: 0xcfe6ff, emissiveIntensity: 1.1, roughness: 0.3 });
      [body, roof, glass, rimM, rimR, tyreM, tailM, headM].forEach(function (m) { m.envMap = envTex; }); tyreM.envMapIntensity = 0.25;
      var bodyMesh = new THREE.Mesh(geoBody, body); g.add(bodyMesh, new THREE.Mesh(geoCabin, glass), new THREE.Mesh(geoRoof, roof));
      [body, roof, glass, archM, tailM, headM, tyreM, plateM].forEach(function (m) { fade.push(m); });
      // lights (on the flat end faces) and mirrors
      g.add(new THREE.Mesh(geoCapF, body), new THREE.Mesh(geoCapR, body));
      var tail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.045, 0.9), tailM); tail.position.set(-2.262, 0.74, 0); g.add(tail);
      [-1, 1].forEach(function (s_) {
        var hl = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.045, 0.34), headM); hl.position.set(2.262, 0.6, s_ * 0.42); hl.rotation.y = s_ * 0.1; g.add(hl);
        var mir = new THREE.Mesh(new THREE.SphereGeometry(0.085, 14, 10), body); mir.scale.set(1.1, 0.7, 0.8); mir.position.set(0.66, 1.0, s_ * 0.86); g.add(mir);
      });
      // wheels with a dark arch behind each
      var wheels = [], rimMats = [rimM]; var WX = [1.38, -1.38], WZ = [0.80, -0.80];
      WX.forEach(function (x) { WZ.forEach(function (z) {
        var piv = new THREE.Group(); piv.position.set(x, 0.334, z); var spin = new THREE.Group(); piv.add(spin);
        spin.add(new THREE.Mesh(tyreG, tyreM)); var rm_ = x < 0 ? rimR : rimM, rim = new THREE.Mesh(rimG, plateM); rim.position.z = Math.sign(z) * 0.1; spin.add(rim);
        for (var k = 0; k < 6; k++) { var sp = new THREE.Mesh(spokeG, rm_); var a = k * 2 * Math.PI / 6; sp.position.set(Math.cos(a) * 0.105, Math.sin(a) * 0.105, Math.sign(z) * 0.128); sp.rotation.z = a; spin.add(sp); }
        var hub = new THREE.Mesh(hubG, rm_); hub.position.z = Math.sign(z) * 0.14; spin.add(hub); g.add(piv); wheels.push({ piv: piv, spin: spin, rear: x < 0, side: z > 0 });
        var arch = new THREE.Mesh(new THREE.CircleGeometry(0.405, 28), archM); arch.position.set(x, 0.334, Math.sign(z) * (bWid(x) + 0.006)); if (z < 0) arch.rotation.y = Math.PI; g.add(arch);
      }); });
      // shadows under the car
      var sh1 = new THREE.Mesh(shGeo, new THREE.MeshBasicMaterial({ map: shTex, color: 0x000000, transparent: true, depthWrite: false, opacity: 0.55 * P_.shadow / 0.55 })); sh1.scale.set(7.4, 1, 3.7); sh1.position.y = 0.022; g.add(sh1);
      var sh2 = new THREE.Mesh(shGeo, new THREE.MeshBasicMaterial({ map: shTex, color: 0x000000, transparent: true, depthWrite: false, opacity: 0.6 * P_.shadow / 0.55 })); sh2.scale.set(5.0, 1, 2.2); sh2.position.y = 0.026; g.add(sh2);
      return { g: g, wheels: wheels, body: body, roof: roof, glass: glass, tailM: tailM, rimM: rimM, rimR: rimR, fade: fade, bodyMesh: bodyMesh };
    }
    var lead = makeCar({ body: 0xaab2b8, roof: 0x2b3136 }), ours = makeCar({ body: P_.dark ? 0x1fb5a5 : 0x14a193, roof: 0xe9eff0 });
    (function () {   // name badge on the back of our car (decoration): "SAGNIK"
      var cv = document.createElement('canvas'); cv.width = 512; cv.height = 96; var x = cv.getContext('2d');
      x.clearRect(0, 0, 512, 96); x.font = '600 64px "IBM Plex Sans", Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      if (x.letterSpacing !== undefined) x.letterSpacing = '18px';
      var gr = x.createLinearGradient(0, 16, 0, 80); gr.addColorStop(0, '#ffffff'); gr.addColorStop(1, '#c9d2d6'); x.fillStyle = gr; x.fillText('SAGNIK', 256 + 9, 50);
      var tex = new THREE.CanvasTexture(cv); tex.anisotropy = 4; if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
      var bm = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
      var badge = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.116), bm); badge.position.set(-2.275, 0.6, 0); badge.rotation.y = -Math.PI / 2; badge.renderOrder = 2;
      ours.g.add(badge); ours.fade.push(bm);
      if (document.fonts && document.fonts.load) document.fonts.load('600 64px "IBM Plex Sans"').then(function () { x.clearRect(0, 0, 512, 96); x.fillStyle = gr; x.fillText('SAGNIK', 256 + 9, 50); tex.needsUpdate = true; }).catch(function () { });
    })();
    scene.add(lead.g, ours.g);

    // ---------- inside our car: battery pack, motor, cables and the energy-flow particles
    var inner = new THREE.Group(); ours.g.add(inner);
    var cellTex = (function () { var c = document.createElement('canvas'); c.width = 256; c.height = 128; var x = c.getContext('2d'); x.fillStyle = '#12303a'; x.fillRect(0, 0, 256, 128); x.strokeStyle = '#3fe0c8'; x.lineWidth = 2; for (var i = 0; i <= 256; i += 16) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 128); x.stroke(); } for (var j = 0; j <= 128; j += 16) { x.beginPath(); x.moveTo(0, j); x.lineTo(256, j); x.stroke(); } var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; })();
    var packM = new THREE.MeshStandardMaterial({ color: 0x10303a, map: cellTex, emissive: 0x2fe3c4, emissiveMap: cellTex, emissiveIntensity: 0.0, roughness: 0.5, metalness: 0.4, transparent: true });
    var pack = new THREE.Mesh(new THREE.BoxGeometry(2.55, 0.15, 1.28), packM); pack.position.set(-0.1, 0.3, 0); inner.add(pack);
    var motorM = new THREE.MeshStandardMaterial({ color: 0x6b7780, roughness: 0.35, metalness: 0.8, emissive: P_.accent, emissiveIntensity: 0, transparent: true });
    var motor = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.62, 24).rotateX(Math.PI / 2), motorM); motor.position.set(-1.38, 0.42, 0); inner.add(motor);
    var axle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 10).rotateX(Math.PI / 2), motorM); axle.position.set(-1.38, 0.334, 0); inner.add(axle);
    var PATHS = [[[0.95, 0.31, 0.42], [-0.2, 0.33, 0.42], [-1.05, 0.36, 0.40], [-1.36, 0.41, 0.2]], [[0.95, 0.31, -0.42], [-0.2, 0.33, -0.42], [-1.05, 0.36, -0.40], [-1.36, 0.41, -0.2]]].map(function (p) { return new THREE.CatmullRomCurve3(p.map(function (a) { return new THREE.Vector3(a[0], a[1], a[2]); })); });
    var cableM = new THREE.MeshBasicMaterial({ color: 0x9fb3bf, transparent: true, opacity: 0 });
    PATHS.forEach(function (c) { inner.add(new THREE.Mesh(new THREE.TubeGeometry(c, 30, 0.012, 5), cableM)); });
    var NP = 120, pPos = new Float32Array(NP * 3), pU = new Float32Array(NP), pPath = new Uint8Array(NP);
    for (var pi = 0; pi < NP; pi++) { pU[pi] = (pi * 0.6180339) % 1; pPath[pi] = pi % 2; pPos[pi * 3 + 1] = -50; }
    var dotTex = (function () { var c = document.createElement('canvas'); c.width = c.height = 32; var x = c.getContext('2d'), gg = x.createRadialGradient(16, 16, 0, 16, 16, 16); gg.addColorStop(0, 'rgba(255,255,255,1)'); gg.addColorStop(.45, 'rgba(255,255,255,.75)'); gg.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gg; x.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
    var pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    var pMat = new THREE.PointsMaterial({ size: 0.13, map: dotTex, color: P_.accent, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }); var pts = new THREE.Points(pGeo, pMat); pts.frustumCulled = false; inner.add(pts);
    var tmpV = new THREE.Vector3();
    function particles(dt, kW, k, frozen) {
      pMat.opacity = k * 0.95; pts.visible = k > 0.02; if (!pts.visible) return;
      var mag = Math.abs(kW), dir = kW >= 0 ? 1 : -1, speed = (0.12 + 0.9 * Math.min(1, mag / 40)) * dir, act = Math.round(NP * clamp(0.1 + mag / 36, 0.1, 1));
      pMat.color.set(kW >= 0 ? P_.accent : 0xbff5ec);
      for (var i = 0; i < NP; i++) {
        if (!frozen) pU[i] = (pU[i] + speed * dt + 1) % 1;
        if (i >= act) { pPos[i * 3 + 1] = -50; continue; }
        PATHS[pPath[i]].getPoint(pU[i], tmpV); pPos[i * 3] = tmpV.x; pPos[i * 3 + 1] = tmpV.y; pPos[i * 3 + 2] = tmpV.z;
      }
      pGeo.attributes.position.needsUpdate = true;
    }

    // ---------- overlays on the road: gap lines, planner dots
    var dashTex = (function () { var c = document.createElement('canvas'); c.width = 64; c.height = 4; var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, 38, 4); var t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t; })();
    function stripe(color, dashed, w) {
      var m = new THREE.Mesh(new THREE.PlaneGeometry(1, w).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0, depthWrite: false, map: dashed ? dashTex.clone() : null }));
      if (dashed) { m.material.map.wrapS = THREE.RepeatWrapping; m.material.map.needsUpdate = true; } m.renderOrder = 3; m.visible = false; scene.add(m); return m;
    }
    var gapLine = stripe(P_.accent, false, 0.14), dsLine = stripe(0xffffff, true, 0.11), flLine = stripe(0xa7adb3, true, 0.11);
    var tickG = new THREE.PlaneGeometry(0.1, 1).rotateX(-Math.PI / 2), ticks = [];
    [P_.accent, P_.accent, 0xffffff, 0xa7adb3].forEach(function (c) { var m = new THREE.Mesh(tickG, new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, depthWrite: false })); m.scale.z = 0.9; m.renderOrder = 3; m.visible = false; scene.add(m); ticks.push(m); });
    var NPL = 15, dotG = new THREE.CircleGeometry(0.42, 20).rotateX(-Math.PI / 2), ringG = new THREE.RingGeometry(0.42, 0.62, 24).rotateX(-Math.PI / 2);
    var plDots = new THREE.InstancedMesh(dotG, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false }), NPL), plAct = new THREE.InstancedMesh(ringG, new THREE.MeshBasicMaterial({ color: P_.accent, transparent: true, opacity: 0, depthWrite: false, fog: false }), NPL);
    plDots.renderOrder = plAct.renderOrder = 3; plDots.frustumCulled = plAct.frustumCulled = false; scene.add(plDots, plAct);
    var band = new THREE.Mesh(new THREE.PlaneGeometry(1, 2.2).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, fog: false })); band.renderOrder = 2; band.visible = false; scene.add(band);
    var m4 = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0);

    // ---------- camera state
    var cs = { cx: 0, D: 30, init: false }, camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), pA = new THREE.Vector3(), pB = new THREE.Vector3(), lA = new THREE.Vector3(), lB = new THREE.Vector3();
    var pv = new THREE.Vector3(), W = 1, Hh = 1;
    function resize() {
      var w = Math.max(2, Math.floor(plane.clientWidth)), h = Math.max(2, Math.floor(plane.clientHeight)); W = w; Hh = h;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, phone() ? 1 : 1.5)); renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    function pose(kind, s, k, out, look) {
      var xc = s.xe - HALF, az, el_, tx = cs.cx, ty = 0.85, tz = LANE, dist = cs.D;
      if (kind === 'over') { az = CAMP[0] + 3.5 * Math.sin(wall / 46 * 6.2832); el_ = CAMP[1] + 1.2 * Math.sin(wall / 37 * 6.2832 + 1) + (S.phase === 'overview' ? 0 : 9 * cache.pk); ty = CAMP[4]; }
      else if (kind === 'gap') { var spn = s.gap + 2 * CARL, fa = function (g) { return spn / 2 * Math.sin(THREE.MathUtils.degToRad(g)) + 2.6; }; az = 44; el_ = 27; dist = cs.D * fa(44) / fa(CAMP[0]) * (panelFrac() > 0 ? 1.55 / (1 - panelFrac()) : 1.3); tx = s.xe + s.gap / 2 - 1.5; ty = 0.3; }
      else if (kind === 'battery') { az = 62; el_ = 14; dist = 10.5; tx = xc - 0.1; ty = 0.5; }
      else if (kind === 'regen') { az = 66; el_ = 12; dist = 8.0; tx = xc - 1.0; ty = 0.45; tz = LANE + 0.2; }
      else { var spp = s.gap + 2 * CARL + s.lead * 3, thh = Math.tan(THREE.MathUtils.degToRad(CAMP[2] / 2)) * camera.aspect; az = 30; el_ = 26; dist = Math.max(cs.D, (spp * Math.sin(THREE.MathUtils.degToRad(az)) + 5) / (2 * thh * (panelFrac() > 0 ? 0.9 - panelFrac() : 0.7))); tx = s.xe - CARL + spp / 2 - (panel() ? 3 : 4); ty = 0.3; }
      var a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el_);
      out.set(tx - dist * Math.cos(e) * Math.cos(a), ty + dist * Math.sin(e), tz + dist * Math.cos(e) * Math.sin(a)); look.set(tx, ty, tz);
    }
    var meA = new THREE.Vector3(), meB = new THREE.Vector3();
    function frame(s, dt, k, kindDet, frozen) {
      var xc = s.xe - HALF, xl = s.xe + s.gap + HALF, tanH = Math.tan(THREE.MathUtils.degToRad(CAMP[2] / 2)) * camera.aspect;
      if (!cs.init) { cs.off = CAMP[3] * (s.gap + 2 * CARL); cs.D = 30; cs.init = true; cs.cx = xc + cs.off; cs.fresh = 1; }
      cs.cx = xc + cs.off;
      var rep = cs.fresh > 0 ? 30 : 1; cs.fresh = 0;
      for (var it = 0; it < rep; it++) {
        pose('over', s, 0, pA, lA); camera.clearViewOffset(); camera.position.copy(pA); camera.lookAt(lA); camera.updateMatrixWorld();
        // closed loop on the picture: keep our rear corner and the lead's front corner inside the frame (feed-forward on our position, so playback speed never lags)
        meA.set(xc - HALF, 0.5, LANE - 0.9).project(camera); var xaa = meA.x; meA.set(xc - HALF, 0.5, LANE + 0.9).project(camera); meA.x = Math.min(meA.x, xaa); meB.set(xl + HALF, 0.9, LANE + 0.9).project(camera); var xbb = meB.x; meB.set(xl + HALF, 0.9, LANE - 0.9).project(camera); meB.x = Math.max(meB.x, xbb);
        cs.xa = meA.x; cs.xb = meB.x; cs.za = meA.z; var ext = Math.max(0.3, meB.x - meA.x), mid = (meA.x + meB.x) / 2, a = rep > 1 ? 0.6 : 1 - Math.exp(-dt / 1.0);
        cs.D = clamp(cs.D + (cs.D * ext / (CAMP[5] || 1.56) - cs.D) * a, 12, 64);
        cs.off += (mid * cs.D * tanH / Math.max(0.2, Math.sin(THREE.MathUtils.degToRad(CAMP[0]))) * 0.9) * a; cs.cx = xc + cs.off;
      }
      pose('over', s, 0, pA, lA); pose(kindDet || 'over', s, 1, pB, lB);
      camPos.copy(pA).lerp(pB, k); camLook.copy(lA).lerp(lB, k); camera.position.copy(camPos); camera.lookAt(camLook);
      var fd = camPos.distanceTo(camLook); scene.fog.near = fd + 8; scene.fog.far = fd + 95;   // the fog (backdrop blend) keeps its distance from the subject in every camera pose
      var shift = panelFrac() * 0.5 * k;
      if (shift > 0.0005) camera.setViewOffset(W, Hh, Math.round(W * shift), 0, W, Hh); else camera.clearViewOffset();
      camera.updateMatrixWorld();
    }
    function project(x, y, z) { pv.set(x, y, z).project(camera); return { x: (pv.x * 0.5 + 0.5) * W, y: (-pv.y * 0.5 + 0.5) * Hh, ok: pv.z < 1 && pv.z > -1 }; }

    function wheelSpin(c, v, dt) { var a = v / 0.334 * dt; c.wheels.forEach(function (w) { w.spin.rotation.z -= a; }); }
    var xr = 0, brake = 0, regenK = 0, rotLast = 0;
    function update(s, dt, st) {
      // st: {xray, gapk, regenk, plk, det, kind, frozen}
      var xc = s.xe - HALF, xl = s.xe + s.gap + HALF;
      ours.g.position.set(xc, 0, LANE); lead.g.position.set(xl, 0, LANE);
      wheelSpin(ours, s.v, dt); wheelSpin(lead, s.lead, dt);
      // brake lights
      var bt = s.acc < -0.3 ? 1 : 0; brake += (bt - brake) * (1 - Math.exp(-dt * 10)); ours.tailM.emissiveIntensity = 0.7 + 3.0 * brake;
      var lb = 0; lead.tailM.emissiveIntensity = 0.7;
      // x-ray
      var k = st.xray, fadeOp = 1 - 0.88 * k;
      var tr = k > 0.01; ours.fade.forEach(function (m) { m.opacity = fadeOp; if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; } m.depthWrite = k < 0.4; });
      ours.bodyMesh.renderOrder = k > 0.4 ? 1 : 0;
      packM.emissiveIntensity = 0.08 + 1.6 * st.battk * (0.4 + 0.6 * Math.min(1, Math.abs(s.pb) / 25)); packM.opacity = 0.35 + 0.65 * Math.max(k, 0.0); inner.visible = k > 0.02;
      motorM.emissiveIntensity = 0.1 + 0.9 * st.regenk;
      cableM.opacity = k * 0.5;
      ours.wheels.forEach(function (w) { });
      particles(dt, s.pb, k * (st.battk > 0 ? 1 : 0.7), st.frozen);
      // regen highlight on the rear wheel(s) of our car: rim glow
      ours.rimR.emissiveIntensity = 0.85 * st.regenk;
      // gap lines
      var showG = st.gapk > 0.01, gp = st.gapk;
      var dstar = PR.d0 + PR.th * s.v, floor = PR.dmina + PR.dminb * s.v;
      [gapLine, dsLine, flLine].forEach(function (m) { m.visible = showG; }); ticks.forEach(function (m) { m.visible = showG; });
      if (showG) {
        var z0 = LANE + 0.55, z1 = LANE - 0.15, z2 = LANE - 0.85, g0 = Math.max(0.05, s.gap);
        gapLine.position.set(s.xe + g0 / 2, 0.05, z0); gapLine.scale.x = g0; gapLine.material.opacity = 0.95 * gp;
        dsLine.position.set(s.xe + dstar / 2, 0.05, z1); dsLine.scale.x = dstar; dsLine.material.map.repeat.x = dstar / 0.7; dsLine.material.opacity = 0.9 * gp;
        flLine.position.set(s.xe + floor / 2, 0.05, z2); flLine.scale.x = floor; flLine.material.map.repeat.x = floor / 0.7; flLine.material.opacity = st.detgap ? 0.85 * gp : 0;
        ticks[0].position.set(s.xe, 0.05, z0); ticks[1].position.set(s.xe + g0, 0.05, z0); ticks[2].position.set(s.xe + dstar, 0.05, z1); ticks[3].position.set(s.xe + floor, 0.05, z2);
        ticks.forEach(function (m, i) { m.scale.z = 0.7; m.material.opacity = (i === 3 ? (st.detgap ? 0.85 : 0) : 0.95) * gp; });
      }
      // planner
      var showP = st.plk > 0.01; plDots.visible = plAct.visible = band.visible = showP;
      if (showP) {
        var xf = xl + HALF, hz = PR.horizon; plDots.material.opacity = 0.95 * st.plk; plAct.material.opacity = (st.detpl ? 0.95 : 0) * st.plk; band.material.opacity = 0.3 * st.plk;
        for (var i = 0; i < NPL; i++) {
          var tau = (i + 1) * hz / NPL; m4.makeTranslation(xf + s.lead * tau, 0.05, LANE); plDots.setMatrixAt(i, m4);
          var tt = s.t + tau; if (tt <= TEND) { m4.makeTranslation(xf + leadTravel(s.t, tt), 0.06, LANE); plAct.setMatrixAt(i, m4); } else plAct.setMatrixAt(i, zero);
        }
        plDots.instanceMatrix.needsUpdate = plAct.instanceMatrix.needsUpdate = true;
        var Lh = Math.max(1, s.lead * hz); band.position.set(xf + Lh / 2, 0.035, LANE); band.scale.set(Lh, 1, 1);
      }
      placeDashes(cs.cx); floorM.position.x = cs.cx; gridTex.offset.x = cs.cx / GS; road.position.x = cs.cx; edges.forEach(function (m) { m.position.x = cs.cx; }); pool.position.x = (xc + xl) / 2;
    }
    return { renderer: renderer, scene: scene, camera: camera, resize: resize, frame: frame, update: update, project: project, draw: function () { renderer.render(scene, camera); }, dispose: function () { try { renderer.dispose(); } catch (e) { } }, THREE: THREE, ours: ours, lead: lead, cs: cs };
  }

  var Hw = function () { return plane.clientWidth; }, Hh_ = function () { return plane.clientHeight; };
  /* ------------------------------------------------------------ per-frame: state -> scene -> overlays */
  var tgt = { gap: 0, xray: 0, regen: 0, planner: 0 };
  function targets() {
    var f = S.phase === 'overview' ? S.hovered : S.selected; var d = S.phase !== 'overview';
    return { gap: f === 'gap' ? 1 : 0, xray: f === 'battery' ? 1 : f === 'regen' ? 0.7 : 0, battk: f === 'battery' ? 1 : 0, regen: f === 'regen' ? 1 : 0, planner: f === 'planner' ? 1 : 0, det: d && S.phase !== 'returning' };
  }
  var cache = { gk: 0, xk: 0, rk: 0, pk: 0, bk: 0 };
  function advance(dt) {
    wall += dt;
    var T = targets(), a = 1 - Math.exp(-dt * (S.reduced ? 200 : 7));
    cache.gk += (T.gap - cache.gk) * a; cache.xk += (T.xray - cache.xk) * a; cache.rk += (T.regen - cache.rk) * a; cache.pk += (T.planner - cache.pk) * a; cache.bk += (T.battk - cache.bk) * a;
    // playback speed: hover slows to 1x, detail pauses
    var want = (!S.playing || S.phase !== 'overview' || S.reduced) ? 0 : (S.hovered ? 1 : S.speed);
    spd += (want - spd) * (1 - Math.exp(-dt * 6)); if (Math.abs(spd - want) < 0.003 || S.reduced) spd = want;
    if (loopState === 0 && !scrubbing && !chartHold) {
      S.t += dt * spd;
      if (S.t >= TEND) { S.t = TEND; if (S.playing && S.phase === 'overview') { loopState = 1; loopT = 0; } }
    } else if (loopState === 1) { loopT += dt; fadeEl.style.opacity = Math.min(1, loopT / 0.4).toFixed(3); if (loopT >= 0.4) { S.t = 0; loopState = 2; loopT = 0; G.cs.init = false; } }
    else if (loopState === 2) { loopT += dt; fadeEl.style.opacity = (1 - Math.min(1, loopT / 0.5)).toFixed(3); if (loopT >= 0.5) { loopState = 0; fadeEl.style.opacity = 0; } }
    // camera blend
    if (transDur > 0 && busy()) kDet = lerp(kFrom, kTo, ease((performance.now() - transT0) / transDur)); else if (!busy()) kDet = kTo === 1 && S.phase === 'detail' ? 1 : (S.phase === 'overview' ? 0 : kDet);
  }
  function draw(dt, force) {
    if (!G) return; var s = snap(S.t), T = targets(), st = { xray: cache.xk, battk: cache.bk, regenk: cache.rk, gapk: cache.gk, plk: cache.pk, detgap: S.phase !== 'overview' && S.selected === 'gap', detpl: S.phase !== 'overview' && S.selected === 'planner', frozen: S.reduced };
    G.frame(s, dt, kDet, S.selected, S.reduced); G.update(s, dt, st); G.draw();
    // anchors -> hotspots, tags, annotations
    var xc = s.xe - HALF, xl = s.xe + s.gap + HALF, Z = LANE, P = function (x, y, z) { return G.project(x, y, z); };
    var anc = { gap: P(s.xe + s.gap / 2, 0.35, Z - 0.15), battery: P(xc + 0.25, 0.36, Z + 0.9), regen: P(xc - 1.38, 0.4, Z + 0.96), planner: P(xc, 2.15, Z) };
    HOT.forEach(function (item) { var p = anc[item.id], b = hotBtn[item.id]; b.style.left = p.x.toFixed(1) + 'px'; b.style.top = p.y.toFixed(1) + 'px'; });
    var dstar = PR.d0 + PR.th * s.v, floor = PR.dmina + PR.dminb * s.v, selD = S.phase !== 'overview' ? S.selected : null;
    // tags: a = anchor ('c' centred above the point, 'b' centred below, 'r' right-aligned left of the point)
    function put(id, p, on, text, a, dx, dy) {
      var t = tags[id]; if (text !== undefined && t.txt !== text) { t.n.innerHTML = text; t.txt = text; }
      if (a === 'r' && t.n.offsetWidth) { var mxl = t.n.offsetWidth + 10 - (dx || 0); if (p.x < mxl) p = { x: mxl, y: p.y, ok: p.ok }; }
      var tr = a === 'b' ? 'translate(-50%,0)' : a === 'r' ? 'translate(-100%,-50%)' : 'translate(-50%,-100%)';
      if (p.ok && (p.x < 6 || p.x > Hw() - 6 || p.y < 6 || p.y > Hh_() - 6)) p = { x: p.x, y: p.y, ok: false };
      t.n.style.opacity = on * (p.ok ? 1 : 0); t.n.style.transform = 'translate(' + (p.x + (dx || 0)).toFixed(1) + 'px,' + (p.y + (dy || 0)).toFixed(1) + 'px) ' + tr;
      var w = t.n.offsetWidth, h = t.n.offsetHeight, x = p.x + (dx || 0), y = p.y + (dy || 0); t.px = x; t.py = y; t.tr = tr; t.r = { x0: a === 'r' ? x - w : x - w / 2, y0: a === 'b' ? y : a === 'r' ? y - h / 2 : y - h, w: w, h: h, on: on * (p.ok ? 1 : 0) };
    }
    var gk = cache.gk, rk = cache.rk, pk = cache.pk, xk = cache.bk, fid = S.phase === 'overview' ? S.hovered : S.selected;
    var own = function (id) { return fid === id || fid === null ? 1 : 0; };
    gk *= own('gap'); rk *= own('regen'); pk *= own('planner'); xk *= own('battery');
    if (phone() && S.phase === 'overview') { gk = rk = pk = xk = 0; }   // on a phone the hotspot name stands alone; the overlay tags appear in the detail view
    put('gap', P(s.xe + s.gap * 0.5, 0.06, Z + 0.55), gk, 'gap <b>' + fx(s.gap, 1) + ' m</b> (measured)', 'b', 0, 24);
    put('dstar', P(s.xe + dstar * 0.2, 0.06, Z - 0.15), gk, 'd* = ' + fx(PR.d0, 0) + ' + ' + fx(PR.th, 1) + ' \u00d7 ' + fx(s.v, 1) + ' = <b>' + fx(dstar, 1) + ' m</b> (desired)', 'c', 0, -8);
    put('floor', P(s.xe + floor * 0.55, 0.06, Z - 0.85), gk * (selD === 'gap' ? 1 : 0), 'floor = ' + fx(PR.dmina, 0) + ' + ' + fx(PR.dminb, 1) + ' \u00d7 ' + fx(s.v, 1) + ' = <b>' + fx(floor, 1) + ' m</b>', 'c', 0, -8);
    var back = s.pb < 0, lp = P(xc - 2.2, 0.9, Z - 0.9); lp.y -= 46;
    put('batt', lp, xk * (selD === 'battery' || S.hovered === 'battery' ? 1 : 0), (back ? 'back to the battery ' : 'from the battery ') + '<b>' + fx(Math.abs(s.pb), 1) + ' kW</b>', 'r', -14, 0);
    var capw = clamp(s.bk / PR.cap, 0, 1) * 100, rgOn = rk * (selD === 'regen' || S.hovered === 'regen' ? 1 : 0);
    put('regen', lp, rgOn, 'regen to the battery <b>' + fx(s.rg, 1) + ' kW</b><span class="hm-cap"><i style="width:' + capw.toFixed(1) + '%"></i></span><small>braking at the wheels ' + fx(s.bk, 1) + ' kW of the ' + fx(PR.cap, 0) + ' kW cap (assumed)</small>', 'r', -14, 0);
    var xf = xl + HALF, pl = [5, 15];
    pl.forEach(function (tau, i) { put('pl' + (i === 0 ? 1 : 3), P(xf + s.lead * tau, 0.2, Z), pk * 0.95, '+' + tau + ' s', 'c', 0, -4); }); put('pl2', P(xf, 0, Z), 0, undefined, 'c');
    put('plc', P(xf + s.lead * 2.0, 0.3, Z + 0.5), pk, 'assumed: the lead keeps ' + fx(s.lead, 1) + ' m/s' + (selD === 'planner' ? '<br><i>rings: where it really was</i>' : ''), 'b', 0, 8);
    var ord = ['gap', 'dstar', 'floor', 'batt', 'regen', 'pl1', 'pl3', 'plc'], done = [];
    ord.forEach(function (k) {
      var t = tags[k], r = t.r; if (!r || r.on < 0.25 || !r.w) return;
      for (var pass = 0; pass < 4; pass++) { var hit = null; for (var q = 0; q < done.length; q++) { var o = done[q]; if (r.x0 < o.x0 + o.w + 4 && r.x0 + r.w + 4 > o.x0 && r.y0 < o.y0 + o.h + 4 && r.y0 + r.h + 4 > o.y0) { hit = o; break; } } if (!hit) break; var d = hit.y0 + hit.h + 4 - r.y0; r.y0 += d; t.py += d; }
      t.n.style.transform = 'translate(' + t.px.toFixed(1) + 'px,' + t.py.toFixed(1) + 'px) ' + t.tr; done.push(r);
    });
    if (S.phase === 'detail' || S.phase === 'entering') {
      var an = ({
        gap: [P(s.xe + dstar, 0.06, Z - 0.15), P(s.xe + floor, 0.06, Z - 0.85), P(s.xe + s.gap, 0.06, Z + 0.55)],
        battery: [P(xc - 0.3, 0.32, Z), P(xc - 0.6, 0.34, Z + 0.42), P(xc, 1.75, Z)],
        regen: [P(xc - 1.38, 0.33, Z + 0.95), P(xc - 1.38, 0.42, Z + 0.1), P(xc, 1.8, Z)],
        planner: [P(xc, 2.0, Z), P(xf + s.lead * 3, 0.2, Z), P(xl, 1.7, Z)]
      })[S.selected], mx = panel() ? 1 - panelFrac() : 1;
      var x1 = Hw() * mx - 24, y1 = Hh_() - 30, placed = [], rects = [];
      Object.keys(tags).forEach(function (k) { var r = tags[k].r; if (r && r.on > 0.25 && r.w) rects.push(r); });
      var hit = function (x, y) { for (var q = 0; q < rects.length; q++) { var r = rects[q]; if (x + 19 > r.x0 && x - 19 < r.x0 + r.w && y + 19 > r.y0 && y - 19 < r.y0 + r.h) return true; } for (q = 0; q < placed.length; q++) if (Math.hypot(x - placed[q][0], y - placed[q][1]) < 40) return true; return false; };
      var nud = [[0, 0], [0, -40], [0, 40], [-40, 0], [40, 0], [-40, -40], [40, -40], [-40, 40], [40, 40], [0, -80], [0, 80]];
      annoBtn.forEach(function (a, i) {
        var p = an[i], x = p.x, y = p.y, ok = p.ok && x >= 24 && x <= x1 && y >= 30 && y <= y1;
        if (ok) { ok = false; for (var q = 0; q < nud.length; q++) { var cx = x + nud[q][0], cy = y + nud[q][1]; if (cx < 24 || cx > x1 || cy < 30 || cy > y1) continue; if (!hit(cx, cy)) { x = cx; y = cy; ok = true; break; } } }
        if (ok) placed.push([x, y]);
        a.style.left = x.toFixed(1) + 'px'; a.style.top = y.toFixed(1) + 'px'; a.style.visibility = ok ? '' : 'hidden'; a.style.opacity = ''; a.classList.toggle('flip', x > Hw() * 0.4);
      });
    }
    paintReadout(s);
  }

  /* ------------------------------------------------------------ loop */
  var last = 0;
  function active() { return G && !failed && visible && !document.hidden; }
  function loop(ts) {
    raf = 0; if (!active()) return; var dt = Math.min(0.1, last ? (ts - last) / 1000 : 0.016); last = ts;
    if (!S.reduced) { advance(dt); draw(dt); fpsTick(ts); schedule(); } else { requestDrawNow(); }
  }
  function schedule() { if (!raf && active() && !S.reduced) raf = requestAnimationFrame(loop); }
  var drawPending = 0;
  function requestDraw() { if (!G || failed) return; if (!S.reduced) { schedule(); return; } if (!drawPending) drawPending = requestAnimationFrame(function () { drawPending = 0; requestDrawNow(); }); }
  function requestDrawNow() { if (!G) return; if (S.reduced) G.cs.fresh = 1; advance(0.016); if (S.reduced) { cache.gk = targets().gap; cache.xk = targets().xray; cache.rk = targets().regen; cache.pk = targets().planner; cache.bk = targets().battk; kDet = S.phase === 'overview' ? 0 : (S.phase === 'returning' ? 0 : 1); } draw(0.016); }
  function fpsTick(ts) { fpsLog.total++; if (!fpsLog.t0) { fpsLog.t0 = ts; fpsLog.n = 0; } fpsLog.n++; if (ts - fpsLog.t0 >= 1000) { fpsLog.v = fpsLog.n * 1000 / (ts - fpsLog.t0); fpsLog.min = Math.min(fpsLog.min, fpsLog.v); fpsLog.t0 = ts; fpsLog.n = 0; } }
  if (window.IntersectionObserver) new IntersectionObserver(function (es) { visible = es[es.length - 1].isIntersecting; last = 0; if (visible) { schedule(); requestDraw(); } }).observe(plane);
  document.addEventListener('visibilitychange', function () { last = 0; if (!document.hidden) { schedule(); requestDraw(); } });
  if (mqReduce) (mqReduce.addEventListener ? mqReduce.addEventListener('change', readReduced) : mqReduce.addListener(readReduced));
  new MutationObserver(readReduced).observe(html, { attributes: true, attributeFilter: ['class'] });
  function readReduced() {
    var r = !!((mqReduce && mqReduce.matches) || html.classList.contains('rm')); if (r === S.reduced) return;
    S.reduced = r; if (r) { S.playing = false; if (S.phase === 'overview') S.t = T_STILL; spd = 0; fadeEl.style.opacity = 0; loopState = 0; } render(); schedule();
  }

  /* ------------------------------------------------------------ boot */
  if (window.ResizeObserver) { var ro = new ResizeObserver(updatePlane); ro.observe(stage); }
  window.addEventListener('resize', updatePlane);
  if (window.ResizeObserver && navEl) new ResizeObserver(setNavH).observe(navEl);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(updatePlane);
  updatePlane(); render(); paintReadout(snap(S.t), true);
  function hasWebGL() { try { var c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } }
  if (!hasWebGL()) toStill('no WebGL');
  else {
    import(THREE_URL).then(function (THREE) {
      THREE_MOD = THREE;
      try { G = sceneBuild(THREE); } catch (err) { toStill(String(err && err.message || err)); return; }
      glCanvas.addEventListener('webglcontextlost', function (ev) { ev.preventDefault(); if (G) G.dispose(); G = null; toStill('context lost'); });
      S.mode = 'gl'; G.resize(); render(); draw(0.016); requestAnimationFrame(function () { draw(0.016); root.classList.add('gl-on'); schedule(); });
    }, function (err) { toStill(String(err && err.message || err)); });
  }
  var THREE_MOD = null;
  function onTheme() {
    PAL = pal(); if (!G || !THREE_MOD) return;
    try { G.dispose(); G = sceneBuild(THREE_MOD); G.resize(); G.cs.fresh = 1; requestDraw(); if (S.reduced) requestDrawNow(); } catch (err) { toStill(String(err && err.message || err)); }
  }
  if (mqDark) (mqDark.addEventListener ? mqDark.addEventListener('change', onTheme) : mqDark.addListener(onTheme));
  window.__hm = {
    cache: cache, S: S, state: function () { return JSON.parse(JSON.stringify(S)); }, fps: function () { return { now: fpsLog.v, min: fpsLog.min, total: fpsLog.total }; }, speed: function () { return spd; }, loop: function () { return loopState; }, enter: enter, back: back, snap: snap, TEND: TEND, T_STILL: T_STILL,
    gl: function () { return G; }, hot: function () { return HOT.map(function (h) { var b = hotBtn[h.id]; return { id: h.id, x: parseFloat(b.style.left), y: parseFloat(b.style.top) }; }); }, setT: function (t) { S.t = t; if (G) G.cs.fresh = 1; requestDraw(); }, still: function () { return { t: T_STILL }; }
  };
})();
