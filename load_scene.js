'use strict';
/* Round x: loading overlay for Run it and Train it. While the engine (worker.js, Pyodide) downloads and starts, a calm 3D film of our car (the same car.bin model as Home) is shown over the right-hand pane,
   with one real fact per shot and a progress bar at the bottom that is driven by the worker's real stages (EVLD events posted by worker.js and forwarded by common.js).
   Rules: shown only if loading is still going on 1.2 s after the page started; fades out when the engine is ready; Skip button / Esc; "Don't show this again" (localStorage, try/catch);
   never blocks scrolling (pointer-events: none except its two controls); rendering is capped at 30 fps, devicePixelRatio <= 1.25, paused while the tab is hidden; weak GPUs and a failed car.bin keep a stylised car;
   reduced motion (system setting or the footer box): six still frames that cross-fade every 5 s, no camera motion. No number is typed here: the facts come from #ld-facts (written by build_site.py from the result files).
   Test-only switches (not linked anywhere): window.__HM_FORCE_CAR (use the real car even on a software GPU, same flag as Home), window.__LD_STYL (live stylised car as on a weak but real GPU), window.__LD_NOGUARD (no frame-rate fallback), window.__LD_HOLD (keep the overlay after the engine is ready), window.__ldTest. */
(function () {
  if (typeof ENGINE === 'undefined' || !ENGINE || !DESKTOP) return;
  var main = document.querySelector('.app-ws'), factsEl = document.getElementById('ld-facts'); if (!main || !factsEl) return;
  var PAGE = document.body.dataset.page, FACTS = JSON.parse(factsEl.textContent), SHOTS = FACTS[PAGE] || FACTS.run, GAPM = FACTS.gap_m || 13.4;
  var THREE_URL = window.__THREE_URL || 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js', CAR_URL = '/media/home3d/car.bin?v=' + SITE_V;
  var T0 = performance.now(), html = document.documentElement;
  var lsGet = function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } }, lsSet = function (k, v) { try { localStorage.setItem(k, v); } catch (e) { } };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); }, lerp = function (a, b, u) { return a + (b - a) * u; }, ease = function (u) { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
  if (lsGet('ev_ld_off') === '1' && !window.__LD_HOLD) { EVLD.sink = function () { }; return; }

  /* ------------------------------------------------------------ real progress model (stages posted by worker.js) */
  var ST = ['runtime', 'packages', 'files', 'import', 'init', 'solve'];
  var NAME = document.body.dataset.page === 'train' ? { runtime: 'Python runtime (Pyodide)', packages: 'numpy, scipy, cvxpy, clarabel', files: 'The engine\'s Python files and data', import: 'Loading the engine code', init: 'Setting up the battery model', solve: 'Warm-up run of the engine' } : { runtime: 'Python runtime (Pyodide)', packages: 'numpy, scipy, cvxpy, clarabel', files: 'The paper\'s Python files and trained actors', import: 'Loading the solver stack', init: 'Setting up the energy model', solve: 'Warm-up solve of the MPC' };
  var EXP = { runtime: 12262932, packages: 19387909, files: 1947938 };   // bytes, measured (data/engine_size.json "stages" replaces these when it loads)
  var st = {}, bytes = { runtime: 0, packages: 0, files: 0 }, ready = false, failed = false, readySecs = 0;
  ST.forEach(function (k) { st[k] = { s: 0, t0: 0, t1: 0 }; });
  var saved = function () { return typeof engineSaved === 'function' && engineSaved(); }, KEYSECS = function () { return 'ev_ld_secs_' + (saved() ? 's' : 'c'); };
  function weights() {   // share of the bar per stage: the user's own measured stage times from their last load (saved/not saved kept apart); first time: downloads by their real bytes (60%), computing 40%
    var o = null; try { o = JSON.parse(lsGet(KEYSECS()) || 'null'); } catch (e) { }
    var w = {}, sum = 0;
    if (o && ST.every(function (k) { return o[k] > 0; })) { ST.forEach(function (k) { w[k] = o[k]; sum += o[k]; }); }
    else { var bt = EXP.runtime + EXP.packages + EXP.files, comp = { import: 0.06, init: 0.12, solve: 0.22 }; ST.forEach(function (k) { w[k] = EXP[k] ? 0.6 * EXP[k] / bt : comp[k]; sum += w[k]; }); }
    ST.forEach(function (k) { w[k] /= sum; }); return w;
  }
  var W = weights();
  fetch('/data/engine_size.json?v=' + SITE_V).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) { if (d && d.stages) { EXP = { runtime: d.stages.runtime_bytes, packages: d.stages.packages_bytes, files: d.stages.files_bytes }; W = weights(); } }).catch(function () { });
  function stageFrac(k) { var o = st[k]; if (o.s === 2) return 1; if (o.s === 0) return 0; return EXP[k] ? Math.min(0.97, bytes[k] / EXP[k]) : 0; }
  var prog = 0;
  function progress() { var p = 0; ST.forEach(function (k) { p += W[k] * stageFrac(k); }); if (ready) p = 1; prog = Math.max(prog, Math.min(1, p)); return prog; }
  function curStage() { for (var i = 0; i < ST.length; i++) if (st[ST[i]].s === 1) return ST[i]; for (var j = 0; j < ST.length; j++) if (st[ST[j]].s === 0) return ST[j]; return ST[ST.length - 1]; }
  function onEvent(m) {
    if (m.type === 'ready') { ready = true; readySecs = m.secs; if (st.solve.s === 1) { st.solve.s = 2; st.solve.t1 = m.at; } saveSecs(); if (!window.__LD_HOLD) finish(); return; }
    if (m.type === 'error') { failed = true; hide(true); return; }
    if (m.bytes) { bytes = m.bytes; return; }
    if (m.stage && st[m.stage]) { var o = st[m.stage]; if (m.state === 'start') { o.s = 1; o.t0 = m.at; } else { o.s = 2; o.t1 = m.at; } }
  }
  function saveSecs() {   // the user's own stage times, used for the bar's shares on the next visit (worker clock; saved and not-saved loads are kept apart)
    var o = {}, ok = true; ST.forEach(function (k) { var d = (st[k].t1 - st[k].t0) / 1000; if (!(st[k].s === 2 && d > 0)) ok = false; o[k] = Math.max(d, 0.005); });
    if (ok) lsSet(KEYSECS(), JSON.stringify(o));
  }
  EVLD.sink = onEvent; EVLD.q.splice(0).forEach(onEvent);
  /* one source of truth: the rail chip %, the rail bar and the overlay bar all use progress(); common.js setBar reads EVLD.prog */
  EVLD.prog = function () { return progress(); };
  function detText(k) {
    var o = st[k], isB = !!EXP[k], fr = stageFrac(k), tail = isB && o.s === 1 && fr >= 0.97, det;
    if (isB && !tail && o.s === 1) det = saved() ? 'from this device' : 'downloading ' + (bytes[k] / 1048576).toFixed(1) + ' of ' + (EXP[k] / 1048576).toFixed(1) + ' MB';
    else if (isB && o.s === 1) det = saved() ? 'from this device' : 'downloaded, starting';
    else if (isB) det = saved() ? 'from this device' : 'waiting'; else det = 'computing on this device';
    return det;
  }
  var railT = setInterval(function () {
    if (ready || failed || readyInfo) { clearInterval(railT); return; }
    var p = progress(), k = curStage(), lb = document.getElementById('lbar'), lm = document.getElementById('lmsg');
    if (lb) lb.style.transform = 'scaleX(' + p.toFixed(3) + ')';
    if (lm) lm.textContent = 'Step ' + (ST.indexOf(k) + 1) + ' of ' + ST.length + ' · ' + detText(k);
    if (window.__railChip) window.__railChip(p);
  }, 250);

  /* ------------------------------------------------------------ prefetch (low priority) and capability probes */
  var weakGL = false, softGL = false, glOK = true, carP = null, mode = 'none';
  function probeGL() {
    try { var c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl'); if (!gl) { glOK = false; return; }
      if (!window.__HM_FORCE_CAR) { var ext = gl.getExtension('WEBGL_debug_renderer_info'), name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : ''; if (/swiftshader|llvmpipe|software|softpipe/i.test(name)) softGL = true; if ((navigator.deviceMemory && navigator.deviceMemory < 2) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency < 2)) weakGL = true; }
      if (window.__LD_STYL) { weakGL = true; softGL = false; }   // test-only: live stylised car
      var le = gl.getExtension('WEBGL_lose_context'); if (le) le.loseContext(); } catch (e) { glOK = false; }
  }
  var prefetched = false;
  function prefetch() {
    if (prefetched || ready) return; prefetched = true; probeGL(); if (!glOK || softGL || isRM()) return;   // software rasterisers and reduced motion use the pre-rendered stills (no three.js, no car.bin)
    try { fetch(THREE_URL, { priority: 'low' }).catch(function () { }); } catch (e) { }
    if (!weakGL && window.fetch) carP = fetch(CAR_URL, { priority: 'low' }).then(function (r) { if (!r.ok) throw new Error('car.bin ' + r.status); return r.arrayBuffer(); }).then(decodeCarBin);
    if (carP) carP.catch(function () { });
  }
  setTimeout(prefetch, 400);

  /* ------------------------------------------------------------ DOM */
  var root = null, canvas = null, chipEl = null, bar = {}, shown = false, skipped = false, gone = false, shotNo = 0, stillImgs = [], rmMode = false;
  var mqRM = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null, isRM = function () { return !!((mqRM && mqRM.matches) || html.classList.contains('rm')); };
  var mqDark = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null, isDark = function () { return !mqDark || mqDark.matches; };
  function el(tag, cls, inner) { var n = document.createElement(tag); if (cls) n.className = cls; if (inner !== undefined) n.innerHTML = inner; return n; }
  var esc = function (t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  function build() {
    root = el('div', 'ldv'); root.id = 'ldv'; root.setAttribute('role', 'region'); root.setAttribute('aria-label', 'Getting the engine ready');
    root.innerHTML = '<canvas class="ldv-gl" aria-hidden="true"></canvas><div class="ldv-stills" aria-hidden="true"></div>' +
      '<div class="ldv-top"><span class="ldv-eb">While the engine loads</span><div class="ldv-ctl"><label class="check ldv-off"><input type="checkbox" id="ldv-off"><span>Don\'t show this again</span></label><button type="button" class="alt sm ldv-skip" id="ldv-skip">Skip <kbd>Esc</kbd></button></div></div>' +
      '<div class="ldv-chip" id="ldv-chip" aria-hidden="true"><div class="k"></div><div class="t"></div></div>' +
      '<div class="ldv-dots" aria-hidden="true">' + SHOTS.map(function () { return '<i></i>'; }).join('') + '</div>' +
      '<div class="ldv-bar"><div class="ldv-row"><span class="ldv-step" id="ldv-step"></span><span class="ldv-det mono" id="ldv-det"></span><span class="ldv-pct mono" id="ldv-pct"></span></div>' +
      '<div class="ldv-track" role="progressbar" aria-label="Engine loading progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" id="ldv-track"><i class="ldv-fill" id="ldv-fill"></i><i class="ldv-shim" id="ldv-shim"></i><span class="ldv-ticks" id="ldv-ticks"></span></div></div>';
    if (softGL || weakGL) root.classList.add('ldv-lite');   // cheaper paint (no backdrop blur, no moving shimmer) where graphics are weak
    main.appendChild(root);
    canvas = root.querySelector('.ldv-gl'); chipEl = $('ldv-chip');
    bar = { step: $('ldv-step'), det: $('ldv-det'), pct: $('ldv-pct'), track: $('ldv-track'), fill: $('ldv-fill'), shim: $('ldv-shim'), ticks: $('ldv-ticks') };
    $('ldv-skip').onclick = function () { hide(false); };
    $('ldv-off').checked = lsGet('ev_ld_off') === '1'; $('ldv-off').onchange = function () { lsSet('ev_ld_off', this.checked ? '1' : '0'); };
    document.addEventListener('keydown', onKey);
    // thin separators between the real stages
    var c = 0, h = ''; ST.forEach(function (k, i) { c += W[k]; if (i < ST.length - 1) h += '<b style="left:' + (c * 100).toFixed(2) + '%"></b>'; }); bar.ticks.innerHTML = h;
  }
  function onKey(e) { if (e.key === 'Escape' && shown && !gone) { hide(false); } }
  var lastTxt = 0, lastAria = -1;
  function paintBar() {
    if (!root) return; var p = progress(), k = curStage(), o = st[k], idx = ST.indexOf(k), fr = stageFrac(k);
    bar.fill.style.transform = 'scaleX(' + p.toFixed(4) + ')';
    var pc = Math.round(p * 100); bar.pct.textContent = pc + '% · ' + ((performance.now() - T0) / 1000).toFixed(1) + ' s'; if (pc !== lastAria && (pc % 5 === 0 || pc === 100)) { lastAria = pc; bar.track.setAttribute('aria-valuenow', pc); }
    if (ready) { bar.step.textContent = 'Engine ready'; bar.det.textContent = readySecs.toFixed(1) + ' s on this device'; bar.shim.style.opacity = 0; return; }
    var isB = !!EXP[k], tail = isB && o.s === 1 && fr >= 0.97, indet = o.s === 1 && (!isB || tail) || o.s === 0;
    bar.step.textContent = 'Step ' + (idx + 1) + ' of ' + ST.length + ' · ' + NAME[k];
    var det = ''; if (isB && !tail && o.s === 1) { det = saved() ? 'from this device' : 'downloading ' + (bytes[k] / 1048576).toFixed(1) + ' of ' + (EXP[k] / 1048576).toFixed(1) + ' MB'; } else if (isB && o.s === 1) det = saved() ? 'from this device' : 'downloaded, starting'; else if (isB) det = saved() ? 'from this device' : 'waiting'; else det = 'computing on this device';
    bar.det.textContent = det;
    var before = 0; for (var i = 0; i < idx; i++) before += W[ST[i]];
    if (indet && o.s === 1) { var a = before + W[k] * (isB ? fr : 0); bar.shim.style.left = (a * 100).toFixed(2) + '%'; bar.shim.style.width = (Math.max(0.5, (before + W[k] - a) * 100)).toFixed(2) + '%'; bar.shim.style.opacity = 1; } else bar.shim.style.opacity = 0;
  }

  /* ------------------------------------------------------------ show / hide */
  var textTimer = 0, showTimer = 0;
  function show() {
    if (shown || ready && !window.__LD_HOLD || failed || skipped) return; shown = true; build(); paintBar(); textTimer = setInterval(paintBar, 200);
    rmMode = isRM(); setChip(0, true); startScene();
  }
  function hide(now) {
    if (gone) return; skipped = true; gone = true; clearInterval(textTimer); document.removeEventListener('keydown', onKey); stopScene();
    if (!root) return; var r = root; if (now || isRM() || !r.animate) { r.remove(); root = null; return; }
    r.style.pointerEvents = 'none'; var a = r.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 400, easing: 'ease', fill: 'forwards' }); a.onfinish = function () { r.remove(); }; root = null;
  }
  function finish() {   // engine ready: show 100% for a moment, then fade out (400 ms)
    if (!shown) { gone = true; return; } paintBar(); var r = root; setTimeout(function () { if (r === root) hide(false); }, 450);
  }
  showTimer = setTimeout(show, Math.max(0, 1200 - performance.now()));

  /* ------------------------------------------------------------ fact chips (one per shot) */
  function setChip(i, instant) {
    shotNo = i; var f = SHOTS[i]; if (!chipEl) return; chipEl.querySelector('.k').textContent = f.label; chipEl.querySelector('.t').textContent = f.text; chipEl.setAttribute('aria-hidden', 'true');
    Array.prototype.forEach.call(root.querySelectorAll('.ldv-dots i'), function (d, j) { d.className = j === i ? 'on' : ''; });
  }
  var chipOn = false;
  function chipVis(v) { if (!chipEl || chipOn === v) return; chipOn = v; chipEl.classList.toggle('on', v); }

  /* ------------------------------------------------------------ the car (car.bin decoder shared in format with home_scene.js) */
  var CAR_KEY = [0x5a, 0xc3, 0x19, 0xe7, 0x82, 0x4d, 0xb0, 0x36, 0xf1, 0x6e, 0x27, 0x9c, 0xd5, 0x08, 0xab, 0x73];
  function decodeCarBin(buf) {
    var u = new Uint8Array(buf);
    if (u.length < 32 || u[0] !== 69 || u[1] !== 86 || u[2] !== 67 || u[3] !== 66 || u[4] !== 1) return Promise.reject(new Error('car.bin header'));
    if (typeof DecompressionStream === 'undefined' || typeof Blob === 'undefined') return Promise.reject(new Error('no DecompressionStream'));
    var dv = new DataView(buf), clen = dv.getUint32(8, true), pad = u[5], b = u.slice(16, 16 + clen), i;
    for (i = 0; i < b.length; i++) b[i] = b[i] ^ CAR_KEY[i & 15] ^ ((i * 7) & 255);
    return new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer().then(function (raw) {
      var rv = new DataView(raw), jl = rv.getUint32(0, true), meta = JSON.parse(new TextDecoder().decode(new Uint8Array(raw, 4, jl))), base = 4 + jl + pad, parts = [];
      meta.parts.forEach(function (m) {
        var q = new Uint16Array(raw, base + m.po, m.n * 3), nq = new Int16Array(raw, base + m.no, m.n * 2), ix = m.w ? new Uint32Array(raw, base + m.io, m.t * 3) : new Uint16Array(raw, base + m.io, m.t * 3);
        var pos = new Float32Array(m.n * 3), nor = new Float32Array(m.n * 3), k, a, c, d, e2, z, l;
        for (k = 0; k < m.n; k++) {
          pos[3 * k] = m.lo[0] + q[3 * k] / 65535 * m.rg[0]; pos[3 * k + 1] = m.lo[1] + q[3 * k + 1] / 65535 * m.rg[1]; pos[3 * k + 2] = m.lo[2] + q[3 * k + 2] / 65535 * m.rg[2];
          a = nq[2 * k] / 32767; c = nq[2 * k + 1] / 32767; z = 1 - Math.abs(a) - Math.abs(c);
          if (z < 0) { d = (1 - Math.abs(c)) * (a >= 0 ? 1 : -1); e2 = (1 - Math.abs(a)) * (c >= 0 ? 1 : -1); a = d; c = e2; }
          l = Math.sqrt(a * a + c * c + z * z) || 1; nor[3 * k] = a / l; nor[3 * k + 1] = c / l; nor[3 * k + 2] = z / l;
        }
        parts.push({ g: m.g, m: m.m, pos: pos, nor: nor, idx: m.w ? ix : new Uint16Array(ix) });
      });
      var wh = meta.wheels, xs = wh.map(function (w) { return w[0]; }), wf = Math.max.apply(null, xs), wr = Math.min.apply(null, xs), len = meta.size[0];
      var C = { model: true, len: len, wf: wf, wr: wr, R: meta.R || 0.4065, packX: (wf + wr) / 2, packY: 0.31, packL: 2.25, packW: 1.45, motorX: wr, motorY: 0.44, motorW: 0.62, axleY: wh[0][1], axleW: 1.66,
        plateY: meta.plate ? meta.plate[1] : 0.615, plateW: 0.52, plateH: 0.125, cab: [[(wf + wr) / 2 + 0.95, 0.32, 0.45], [(wf + wr) / 2 - 0.3, 0.34, 0.45], [wr + 0.4, 0.38, 0.44], [wr + 0.02, 0.45, 0.2]] };
      return { meta: meta, parts: parts, C: C };
    });
  }

  /* ------------------------------------------------------------ the shots: camera start/end poses in metres relative to our car's centre (x forward, y up, z to the viewer's side); wheel/ground speed and which highlight is on */
  var SH = [
    { a: [[8.4, 1.1, 7.0], [0.2, 0.7, 0]], b: [[9.2, 1.5, 4.4], [0.2, 0.7, 0]], fov: 26, v: 3, shift: 0.14, k: {} },                                     // 1 hero 3/4 front
    { a: [[4.5, 1.0, 12.0], [1.5, 0.7, 0]], b: [[-4.5, 1.0, 12.0], [-1.5, 0.7, 0]], fov: 26, v: 9, shift: 0.14, k: {} },                                // 2 side profile, wheels turning
    { a: [[-3.2, 1.7, 8.0], [0, 0.45, 0]], b: [[2.0, 1.8, 7.2], [0, 0.45, 0]], fov: 28, v: 4, shift: 0.14, k: { xray: 1, batt: 1 } },                    // 3 X-ray battery
    { a: [[-8.0, 1.0, 5.4], [-1.6, 0.5, 0.2]], b: [[-6.6, 0.85, 4.4], [-1.6, 0.5, 0.2]], fov: 28, v: 6, shift: 0.14, k: { xray: 0.7, regen: 1 } },       // 4 rear wheel + motor, regen
    { a: [[-12.5, 3.0, 3.8], [9.0, 0.5, 0]], b: [[-9.5, 2.4, 4.8], [9.0, 0.5, 0]], fov: 30, v: 8, shift: 0.1, k: { gap: 1 } },                           // 5 following the lead car at a gap
    { a: [[-8.2, 2.4, 5.8], [-1.4, 0.6, 0]], b: [[-7.0, 2.2, 4.4], [-1.4, 0.6, 0]], fov: 28, v: 3, shift: 0.14, k: {} }                                  // 6 rear 3/4 with the plate
  ];
  var PER = 5.6, TRANS = 1.0, N = SH.length;

  /* ------------------------------------------------------------ three.js scene */
  var fpsT0 = 0, fpsN = 0, degraded = false, G = null, THREE_MOD = null, sceneTried = false, rafId = 0, lastT = 0, tl = 0, acc = 0, hiddenTab = false, curShot = -1;
  var S = { xray: 0, batt: 0, regen: 0, gap: 0, v: 3 }, scroll = 0, modelData = null;
  function startScene() {
    if (sceneTried) return; sceneTried = true;
    if (!prefetched) { prefetched = true; probeGL(); }
    if (rmMode || softGL || !glOK) { stillsFromFiles(); return; }
    import(THREE_URL).then(function (THREE) {
      if (gone) return; THREE_MOD = THREE;
      try { G = buildScene(THREE); } catch (err) { console.warn('loading overlay: 3D not available (' + String(err && err.message || err) + ')'); noGL(); return; }
      canvas.addEventListener('webglcontextlost', function (ev) { ev.preventDefault(); if (!G) return; stopScene(); noGL(); });
      var useModel = false;
      var done = function () { if (gone) return; mode = 'live'; sizeScene(); loop(); };
      if (!weakGL && carP) {   // wait up to 1.5 s for the real car, then start with the stylised one and swap at the next shot change
        var tm = new Promise(function (r) { setTimeout(function () { r('late'); }, 1500); });
        Promise.race([carP.then(function (m) { return m; }), tm]).then(function (m) { if (m && m !== 'late') { modelData = m; G.useModel(m); } else if (m === 'late') carP.then(function (md) { modelData = md; G.pending = true; }, function (e) { console.warn('loading overlay: car model not available (' + String(e && e.message || e) + '), keeping the stylised car'); }); done(); }, function (e) { console.warn('loading overlay: car model not available (' + String(e && e.message || e) + '), keeping the stylised car'); done(); });
      } else done();
    }, function (err) { console.warn('loading overlay: three.js not available (' + String(err && err.message || err) + ')'); noGL(); });
  }
  function noGL() { stopScene(); stillsFromFiles(); }
  function homeStill() {   // last resort (the pre-rendered shots could not be loaded): the Home still, dimmed, with the same chips
    if (!root) return; mode = 'home'; clearInterval(stillTimer); var box = root.querySelector('.ldv-stills'); box.innerHTML = '';
    var im = el('img', 'ldv-still1'); im.alt = ''; im.src = '/media/home3d/' + (isDark() ? 'still.png' : 'still-light.png') + '?v=' + SITE_V; box.appendChild(im); im.style.opacity = 0.55; stillMode();
  }
  /* pre-rendered shots (media/loadscene/<dark|light>-N.jpg, one per shot, made headless from car.bin with this same scene): used for reduced motion, software rasterisers, no WebGL / three.js, and when the live film cannot hold 20 fps. They cross-fade every 5 s; nothing moves. */
  function stillsFromFiles() {
    stopScene(); if (!root) return; mode = 'stills'; canvas.style.display = 'none';
    var box = root.querySelector('.ldv-stills'), th = isDark() ? 'dark' : 'light', cur_ = 0, bad = false; box.innerHTML = ''; stillImgs = [];
    for (var i = 0; i < N; i++) { var im = el('img', 'ldv-still1'); im.alt = ''; im.style.opacity = 0; im.onerror = function () { if (!bad) { bad = true; homeStill(); } }; box.appendChild(im); stillImgs.push(im); }
    stillImgs[0].onload = function () { stillImgs[0].style.opacity = 1; for (var k = 1; k < N; k++) stillImgs[k].src = '/media/loadscene/' + th + '-' + (k + 1) + '.jpg?v=' + SITE_V; };
    stillImgs[0].src = '/media/loadscene/' + th + '-1.jpg?v=' + SITE_V; setChip(0); chipVis(true);
    function fade(a, b, ms) { var t0 = performance.now(); (function step() { var u = clamp((performance.now() - t0) / ms, 0, 1); if (stillImgs[a]) stillImgs[a].style.opacity = 1 - u; if (stillImgs[b]) stillImgs[b].style.opacity = u; if (u < 1 && root) setTimeout(step, 40); })(); }
    stillTimer = setInterval(function () { if (!root || bad) return; var nx = (cur_ + 1) % N; chipVis(false); fade(cur_, nx, 500); cur_ = nx; setTimeout(function () { if (!root) return; setChip(nx); chipVis(true); }, 500); }, 5000);
  }
  function stillMode() {   // chips only, changing every 5 s
    var i = 0; setChip(0); chipVis(true); clearInterval(stillTimer); stillTimer = setInterval(function () { if (!root) return; chipVis(false); setTimeout(function () { if (!root) return; i = (i + 1) % N; setChip(i); chipVis(true); }, 450); }, 5000);
  }
  var stillTimer = 0;
  function stopScene() { cancelAnimationFrame(rafId); rafId = 0; clearInterval(stillTimer); if (G) { try { G.dispose(); } catch (e) { } G = null; } document.removeEventListener('visibilitychange', onVis); }
  function onVis() { if (document.hidden) { cancelAnimationFrame(rafId); rafId = 0; } else if (G && !rafId && !rmMode) { lastT = 0; rafId = requestAnimationFrame(frame); } }

  function pal() {
    return isDark() ? { dark: true, bg: 0x141415, floor: 0x1d1e21, grid: 0x3b3e44, road: 0.05, dash: 0xb4b9bf, edge: 0x6b7077, pool: 0.20, env: 0x30353b, envK: 0.8, hemiSky: 0xcfd8e2, hemiGnd: 0x26282c, hemiI: 0.55, key: 1.15, rim: 1.9, shadow: 0.7, accent: 0x2dd4bf }
      : { dark: false, bg: 0xfafafa, floor: 0xe7e8ea, grid: 0xc4c7cc, road: 0.10, dash: 0xf2f3f4, edge: 0xe3e5e7, pool: 0.16, env: 0xb8c0c8, envK: 1.0, hemiSky: 0xffffff, hemiGnd: 0x9aa2aa, hemiI: 0.75, key: 1.3, rim: 1.3, shadow: 0.5, accent: 0x14b8a6 };
  }
  function buildScene(THREE) {
    var P_ = pal(), renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: false, powerPreference: 'default' });
    renderer.setClearColor(P_.bg, 1); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.25));
    var scene = new THREE.Scene(); scene.fog = new THREE.Fog(P_.bg, 26, 110); var camera = new THREE.PerspectiveCamera(26, 16 / 9, 0.3, 300);
    var pm = new THREE.PMREMGenerator(renderer), envScene = new THREE.Scene();
    envScene.add(new THREE.Mesh(new THREE.BoxGeometry(60, 30, 60), new THREE.MeshBasicMaterial({ color: P_.env, side: THREE.BackSide })));
    var sb = function (w, h, d, x, y, z, k) { var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshBasicMaterial({ color: new THREE.Color(k * P_.envK, k * P_.envK, k * P_.envK * 1.04) })); m.position.set(x, y, z); envScene.add(m); };
    sb(26, 0.5, 9, 0, 13, 2, 3.2); sb(0.5, 9, 22, -20, 7, 0, 2.0); sb(0.5, 9, 22, 20, 7, 0, 1.6); sb(22, 7, 0.5, 0, 6, -22, 1.4); sb(8, 0.5, 8, 0, 0.2, 14, 0.7);
    var envTex = pm.fromScene(envScene, 0.035).texture; pm.dispose();
    scene.add(new THREE.HemisphereLight(P_.hemiSky, P_.hemiGnd, P_.hemiI));
    var key = new THREE.DirectionalLight(0xffffff, P_.key); key.position.set(-8, 16, 9); scene.add(key);
    var rim = new THREE.DirectionalLight(0xb9d4ff, P_.rim); rim.position.set(16, 9, -13); scene.add(rim);
    var rim2 = new THREE.DirectionalLight(0xcdeee9, P_.rim * 0.5); rim2.position.set(-12, 6, -14); scene.add(rim2);
    var hx = function (n) { return '#' + ('000000' + n.toString(16)).slice(-6); };
    var glowTex = (function () { var c = document.createElement('canvas'); c.width = c.height = 128; var x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,' + P_.pool + ')'); g.addColorStop(.5, 'rgba(255,255,255,' + (P_.pool * 0.35) + ')'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    var GS = 4, gridTex = (function () { var c = document.createElement('canvas'); c.width = c.height = 128; var x = c.getContext('2d'); x.fillStyle = hx(P_.floor); x.fillRect(0, 0, 128, 128); x.strokeStyle = hx(P_.grid); x.lineWidth = 3; x.strokeRect(0, 0, 128, 128);
      var t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy()); t.repeat.set(300 / GS, 200 / GS); return t; })();
    var floorM = new THREE.Mesh(new THREE.PlaneGeometry(300, 200).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: gridTex, depthWrite: false, depthTest: false })); floorM.position.y = -0.004; floorM.renderOrder = -3; scene.add(floorM);
    var pool = new THREE.Mesh(new THREE.PlaneGeometry(70, 50).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, fog: false })); pool.position.set(8, 0.004, 0); scene.add(pool);
    var LANE = -1.75, RW = 7.2, rg = new THREE.PlaneGeometry(260, RW, 1, 8).rotateX(-Math.PI / 2), rc = [];
    for (var j = 0; j <= 8; j++) { var u = Math.abs(j / 8 - 0.5) * 2, shade = P_.road * (1.0 - 0.28 * Math.pow(u, 2.2)); for (var q = 0; q < 2; q++) rc.push(shade * 0.99, shade, shade * 1.03); }
    rg.setAttribute('color', new THREE.Float32BufferAttribute(rc, 3));
    var road = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 })); road.position.set(0, 0.012, 0); scene.add(road);
    var edgeMat = new THREE.MeshBasicMaterial({ color: P_.edge }), edgeG = new THREE.PlaneGeometry(260, 0.13).rotateX(-Math.PI / 2);
    [-RW / 2 + 0.28, RW / 2 - 0.28].forEach(function (z) { var m = new THREE.Mesh(edgeG, edgeMat); m.position.set(0, 0.02, z); scene.add(m); });
    var DP = 9, DN = 24, dashes = new THREE.InstancedMesh(new THREE.PlaneGeometry(3, 0.13).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: P_.dash }), DN), dm = new THREE.Matrix4(); dashes.frustumCulled = false; scene.add(dashes);
    function placeDashes(off) { var b = ((off % DP) + DP) % DP; for (var i = 0; i < DN; i++) { dm.makeTranslation((i - DN / 2) * DP - b, 0.02, 0); dashes.setMatrixAt(i, dm); } dashes.instanceMatrix.needsUpdate = true; }
    var shTex = (function () { var c = document.createElement('canvas'); c.width = 128; c.height = 64; var x = c.getContext('2d'); x.shadowColor = '#000'; x.shadowBlur = 13; x.fillStyle = '#000'; x.beginPath(); if (x.roundRect) x.roundRect(24, 19, 80, 26, 12); else x.rect(24, 19, 80, 26); x.fill(); var t = new THREE.CanvasTexture(c); return t; })();
    var shGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

    /* --- stylised car (fallback): lofted body, cabin, wheels --- */
    function mono(pts) {
      var n = pts.length, xs = pts.map(function (p) { return p[0]; }), ys = pts.map(function (p) { return p[1]; }), d = [], m = [], i;
      for (i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
      m[0] = d[0]; m[n - 1] = d[n - 2]; for (i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
      for (i = 0; i < n - 1; i++) { if (d[i] === 0) { m[i] = m[i + 1] = 0; } else { var a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b; if (s > 9) { var t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; } } }
      return function (x) { if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1]; var k = 0; while (x > xs[k + 1]) k++; var h = xs[k + 1] - xs[k], t = (x - xs[k]) / h, t2 = t * t, t3 = t2 * t; return (2 * t3 - 3 * t2 + 1) * ys[k] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * ys[k + 1] + (t3 - t2) * h * m[k + 1]; };
    }
    var sgn = function (v) { return v < 0 ? -1 : 1; };
    function loft(xs, ringFn, M) {
      var pos = [], idx = [];
      xs.forEach(function (x) { var r = ringFn(x); for (var j = 0; j < M; j++) { var th = 2 * Math.PI * j / M, c = Math.cos(th), s = Math.sin(th), xn = sgn(c) * Math.pow(Math.abs(c), 2 / r.n), yn = sgn(s) * Math.pow(Math.abs(s), 2 / r.n); pos.push(x, r.ym + r.hh * yn, r.hw * xn * (yn > 0 ? 1 - r.tum * yn : 1)); } });
      for (var i = 0; i < xs.length - 1; i++) for (var j2 = 0; j2 < M; j2++) { var a = i * M + j2, b = i * M + (j2 + 1) % M, c2 = (i + 1) * M + j2, d2 = (i + 1) * M + (j2 + 1) % M; idx.push(a, c2, b, b, c2, d2); }
      var g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
    }
    var cosx = function (a, b, S_) { var o = []; for (var i = 0; i <= S_; i++) o.push(lerp(a, b, 0.5 - 0.5 * Math.cos(Math.PI * i / S_))); return o; };
    var endE = function (x, L, rr, mw, mh) { var ax = Math.abs(x) - (L - rr); if (ax <= 0) return [1, 1]; var u = Math.min(1, ax / rr), q = Math.sqrt(1 - u * u); return [mw + (1 - mw) * q, mh + (1 - mh) * q]; };
    var bTop = mono([[-2.25, 0.86], [-2.12, 0.94], [-1.8, 0.99], [-1.0, 1.0], [0.4, 0.98], [1.2, 0.93], [1.9, 0.80], [2.25, 0.69]]), bBot = mono([[-2.25, 0.40], [-2.05, 0.27], [-1.2, 0.21], [1.2, 0.21], [2.0, 0.26], [2.25, 0.36]]), bWid = mono([[-2.25, 0.80], [-2.0, 0.88], [-1.0, 0.91], [1.0, 0.91], [2.0, 0.87], [2.25, 0.80]]);
    var bodyRing = function (x) { var e = endE(x, 2.25, 0.36, 0.84, 0.9), yt = bTop(x), yb = bBot(x); return { ym: (yt + yb) / 2, hh: (yt - yb) / 2 * e[1], hw: bWid(x) * e[0], n: 5, tum: 0.13 }; };
    var cTop = mono([[-1.4, 0.96], [-1.25, 1.18], [-0.9, 1.40], [-0.2, 1.47], [0.3, 1.45], [0.78, 1.27], [1.14, 0.98]]);
    var cabinRing = function (x) { var e1 = clamp((x + 1.4) / 0.16, 0, 1), e2 = clamp((1.14 - x) / 0.16, 0, 1), e = Math.sqrt(1 - (1 - e1) * (1 - e1)) * Math.sqrt(1 - (1 - e2) * (1 - e2)), yt = cTop(x), yb = 0.80; return { ym: (yt + yb) / 2, hh: (yt - yb) / 2 * e, hw: 0.71 * e, n: 2.4, tum: 0.3 }; };
    var stylGeo = null;
    var CS = { model: false, len: 4.5, wf: 1.38, wr: -1.38, R: 0.334, packX: -0.1, packY: 0.3, packL: 2.55, packW: 1.28, motorX: -1.38, motorY: 0.42, motorW: 0.62, axleY: 0.334, axleW: 1.6, plateY: 0.6, cab: [[0.95, 0.31, 0.42], [-0.2, 0.33, 0.42], [-1.05, 0.36, 0.40], [-1.36, 0.41, 0.2]] };
    function plateTex() {
      var cv = document.createElement('canvas'); cv.width = 512; cv.height = 128;
      var paint = function () { var x = cv.getContext('2d'); x.clearRect(0, 0, 512, 128); x.fillStyle = '#e8eef0'; if (x.roundRect) { x.beginPath(); x.roundRect(2, 2, 508, 124, 14); x.fill(); } else x.fillRect(2, 2, 508, 124); x.strokeStyle = '#14a193'; x.lineWidth = 5; if (x.roundRect) { x.beginPath(); x.roundRect(9, 9, 494, 110, 9); x.stroke(); }
        x.font = '700 70px "IBM Plex Sans", Arial, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; if (x.letterSpacing !== undefined) x.letterSpacing = '12px'; x.fillStyle = '#12313a'; x.fillText('SAGNIK', 256 + 6, 67); };
      paint(); var t = new THREE.CanvasTexture(cv); t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace;
      if (document.fonts && document.fonts.load) document.fonts.load('700 70px "IBM Plex Sans"').then(function () { paint(); t.needsUpdate = true; }).catch(function () { });
      return t;
    }
    function makeStylCar(cfg, isOurs) {
      if (!stylGeo) { var tyreG = (function () { var p = [[0.2, -0.11], [0.27, -0.118], [0.318, -0.095], [0.334, -0.045], [0.334, 0.045], [0.318, 0.095], [0.27, 0.118], [0.2, 0.11]].map(function (a) { return new THREE.Vector2(a[0], a[1]); }); return new THREE.LatheGeometry(p, 24).rotateX(Math.PI / 2); })();
        stylGeo = { body: loft(cosx(-2.25, 2.25, 40), bodyRing, 36), cabin: loft(cosx(-1.4, 1.14, 26), cabinRing, 32), tyre: tyreG, rim: new THREE.CylinderGeometry(0.21, 0.21, 0.03, 24).rotateX(Math.PI / 2), spoke: new THREE.BoxGeometry(0.2, 0.07, 0.03) }; }
      var g = new THREE.Group(), fade = [], meshes = [];
      var ph = function (o) { var m = new THREE.MeshPhysicalMaterial(o); m.envMap = envTex; return m; }, sd = function (o) { var m = new THREE.MeshStandardMaterial(o); m.envMap = envTex; return m; };
      var body = ph({ color: cfg.body, roughness: 0.34, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.12 }), glass = ph({ color: 0x0d151b, roughness: 0.16, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.12 });
      var rimM = new THREE.MeshStandardMaterial({ color: 0xcfd6db, roughness: 0.28, metalness: 0.85, emissive: P_.accent, emissiveIntensity: 0 }); rimM.envMap = envTex; var rimR = rimM.clone(); rimR.envMap = envTex;
      var tyreM = sd({ color: 0x15191c, roughness: 0.85 }), tailM = sd({ color: 0x3a0306, emissive: 0xff1608, emissiveIntensity: 0.7, roughness: 0.3 }), headM = sd({ color: 0xdfeaf2, emissive: 0xcfe6ff, emissiveIntensity: 1.1, roughness: 0.3 });
      var b1 = new THREE.Mesh(stylGeo.body, body), b2 = new THREE.Mesh(stylGeo.cabin, glass); g.add(b1, b2); meshes.push(b1, b2);
      var tail = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.045, 0.9), tailM); tail.position.set(-2.262, 0.74, 0); g.add(tail);
      [-1, 1].forEach(function (s_) { var hl = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.045, 0.34), headM); hl.position.set(2.262, 0.6, s_ * 0.42); hl.rotation.y = s_ * 0.1; g.add(hl); });
      var wheels = [];
      [1.38, -1.38].forEach(function (x) { [0.80, -0.80].forEach(function (z) {
        var piv = new THREE.Group(); piv.position.set(x, 0.334, z); var spin = new THREE.Group(); piv.add(spin); spin.add(new THREE.Mesh(stylGeo.tyre, tyreM)); var rm_ = x < 0 ? rimR : rimM, rimD = new THREE.Mesh(stylGeo.rim, rm_); rimD.position.z = Math.sign(z) * 0.1; spin.add(rimD);
        for (var k = 0; k < 6; k++) { var sp = new THREE.Mesh(stylGeo.spoke, rm_); var a = k * 2 * Math.PI / 6; sp.position.set(Math.cos(a) * 0.105, Math.sin(a) * 0.105, Math.sign(z) * 0.128); sp.rotation.z = a; spin.add(sp); }
        g.add(piv); wheels.push({ piv: piv, spin: spin });
      }); });
      [body, glass, tailM, headM].forEach(function (m) { fade.push(m); });
      var sh1 = new THREE.Mesh(shGeo, new THREE.MeshBasicMaterial({ map: shTex, color: 0, transparent: true, depthWrite: false, opacity: 0.55 * P_.shadow / 0.55 })); sh1.scale.set(7.4, 1, 3.7); sh1.position.y = 0.022; g.add(sh1);
      var rest = { g: g, wheels: wheels, fade: fade, rimR: rimR, R: 0.334, meshes: meshes, body: body };
      if (isOurs) { var pm_ = new THREE.MeshBasicMaterial({ map: plateTex(), transparent: true, depthWrite: false, toneMapped: false, color: 0xc4cccf }), plate = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.125), pm_); plate.position.set(-2.254, 0.6, 0); plate.rotation.y = -Math.PI / 2; plate.renderOrder = 2; g.add(plate); fade.push(pm_); }
      return rest;
    }
    /* --- the model car (from car.bin) --- */
    var geos = null;
    function makeModelCar(md, cfg, isOurs) {
      var C = md.C; if (!geos) geos = md.parts.map(function (p) { var gm = new THREE.BufferGeometry(); gm.setAttribute('position', new THREE.BufferAttribute(p.pos, 3)); gm.setAttribute('normal', new THREE.BufferAttribute(p.nor, 3)); gm.setIndex(new THREE.BufferAttribute(p.idx, 1)); gm.computeBoundingSphere(); return gm; });
      var g = new THREE.Group(), fade = [], wheels = [];
      var phys = function (o) { var m = new THREE.MeshPhysicalMaterial(o); m.envMap = envTex; return m; }, stdm = function (o) { var m = new THREE.MeshStandardMaterial(o); m.envMap = envTex; return m; };
      var M = {
        paint: phys({ color: cfg.body, roughness: 0.34, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.12 }), roof: phys({ color: cfg.roof, roughness: 0.3, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.1 }),
        glass: phys({ color: 0x0d151b, roughness: 0.16, metalness: 0.0, clearcoat: 0.6, clearcoatRoughness: 0.12, envMapIntensity: 0.9 }), trim: stdm({ color: 0x0c0e10, roughness: 0.55, metalness: 0.1 }), chrome: stdm({ color: 0xcfd6db, roughness: 0.28, metalness: 0.85 }),
        lamp: stdm({ color: 0xdfeaf2, emissive: 0xcfe6ff, emissiveIntensity: 0.9, roughness: 0.3 }), tail: stdm({ color: 0x3a0306, emissive: 0xff1608, emissiveIntensity: 0.7, roughness: 0.3 }), disc: stdm({ color: 0x8b9095, roughness: 0.45, metalness: 0.8 })
      };
      var rimM = new THREE.MeshStandardMaterial({ color: 0x6d7780, roughness: 0.3, metalness: 0.85, emissive: P_.accent, emissiveIntensity: 0 }); rimM.envMap = envTex; var rimR = rimM.clone(); rimR.envMap = envTex;
      var WM = { tyre: stdm({ color: 0x15191c, roughness: 0.85, envMapIntensity: 0.25 }), chrome: M.chrome.clone(), trim: M.trim.clone() };
      var piv = md.meta.wheels.map(function (w) { var pg = new THREE.Group(); pg.position.set(w[0], w[1], w[2]); g.add(pg); wheels.push({ piv: pg, spin: pg }); return pg; });
      md.parts.forEach(function (p, i) {
        var wm = /^wheel(\d)$/.exec(p.g), mat, mesh;
        if (wm) { mat = p.m === 'rim' ? (piv[+wm[1]].position.x < 0 && isOurs ? rimR : rimM) : WM[p.m] || WM.trim; mesh = new THREE.Mesh(geos[i], mat); piv[+wm[1]].add(mesh); }
        else { mat = M[p.m] || M.trim; mesh = new THREE.Mesh(geos[i], mat); g.add(mesh); }
      });
      ['paint', 'roof', 'glass', 'trim', 'chrome', 'lamp', 'tail'].forEach(function (k) { fade.push(M[k]); });
      var sc1 = C.len / 4.5, sh1 = new THREE.Mesh(shGeo, new THREE.MeshBasicMaterial({ map: shTex, color: 0, transparent: true, depthWrite: false, opacity: 0.55 * P_.shadow / 0.55 })); sh1.scale.set(7.4 * sc1, 1, 3.9); sh1.position.y = 0.022; g.add(sh1);
      var sh2 = new THREE.Mesh(shGeo, new THREE.MeshBasicMaterial({ map: shTex, color: 0, transparent: true, depthWrite: false, opacity: 0.6 * P_.shadow / 0.55 })); sh2.scale.set(5.0 * sc1, 1, 2.4); sh2.position.y = 0.026; g.add(sh2);
      if (isOurs) { var pm_ = new THREE.MeshBasicMaterial({ map: plateTex(), transparent: true, depthWrite: false, toneMapped: false, color: 0xc4cccf }), plate = new THREE.Mesh(new THREE.PlaneGeometry(C.plateW, C.plateH), pm_); plate.position.set(-C.len / 2 - 0.004, C.plateY, 0); plate.rotation.y = -Math.PI / 2; plate.renderOrder = 2; g.add(plate); fade.push(pm_); }
      return { g: g, wheels: wheels, fade: fade, rimR: rimR, R: C.R, body: M.paint };
    }
    /* --- inside our car: battery pack, motor, cables, energy particles --- */
    var cellTex = (function () { var c = document.createElement('canvas'); c.width = 128; c.height = 64; var x = c.getContext('2d'); x.fillStyle = '#12303a'; x.fillRect(0, 0, 128, 64); x.strokeStyle = '#3fe0c8'; x.lineWidth = 1; for (var i = 0; i <= 128; i += 8) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 64); x.stroke(); } for (var j = 0; j <= 64; j += 8) { x.beginPath(); x.moveTo(0, j); x.lineTo(128, j); x.stroke(); } var t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; })();
    var packM = new THREE.MeshStandardMaterial({ color: 0x10303a, map: cellTex, emissive: 0x2fe3c4, emissiveMap: cellTex, emissiveIntensity: 0, roughness: 0.5, metalness: 0.4, transparent: true });
    var motorM = new THREE.MeshStandardMaterial({ color: 0x6b7780, roughness: 0.35, metalness: 0.8, emissive: P_.accent, emissiveIntensity: 0, transparent: true }), cableM = new THREE.MeshBasicMaterial({ color: 0x9fb3bf, transparent: true, opacity: 0 });
    var inner = new THREE.Group(), PATHS = [], innerObj = [];
    function buildInner(C) {
      innerObj.forEach(function (o) { inner.remove(o); if (o.geometry) o.geometry.dispose(); }); innerObj = []; var add = function (o) { inner.add(o); innerObj.push(o); return o; };
      add(new THREE.Mesh(new THREE.BoxGeometry(C.packL, 0.15, C.packW), packM)).position.set(C.packX, C.packY, 0);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, C.motorW, 20).rotateX(Math.PI / 2), motorM)).position.set(C.motorX, C.motorY, 0);
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, C.axleW, 8).rotateX(Math.PI / 2), motorM)).position.set(C.motorX, C.axleY, 0);
      PATHS = [1, -1].map(function (sg) { return new THREE.CatmullRomCurve3(C.cab.map(function (a) { return new THREE.Vector3(a[0], a[1], a[2] * sg); })); });
      PATHS.forEach(function (c) { add(new THREE.Mesh(new THREE.TubeGeometry(c, 24, 0.012, 5), cableM)); });
    }
    var NP = 110, pPos = new Float32Array(NP * 3), pU = new Float32Array(NP), pPath = new Uint8Array(NP);
    for (var pi = 0; pi < NP; pi++) { pU[pi] = (pi * 0.6180339) % 1; pPath[pi] = pi % 2; pPos[pi * 3 + 1] = -50; }
    var dotTex = (function () { var c = document.createElement('canvas'); c.width = c.height = 32; var x = c.getContext('2d'), gg = x.createRadialGradient(16, 16, 0, 16, 16, 16); gg.addColorStop(0, 'rgba(255,255,255,1)'); gg.addColorStop(.45, 'rgba(255,255,255,.75)'); gg.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gg; x.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
    var pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    var pMat = new THREE.PointsMaterial({ size: 0.13, map: dotTex, color: P_.accent, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true }), pts = new THREE.Points(pGeo, pMat); pts.frustumCulled = false; inner.add(pts);
    var tmpV = new THREE.Vector3();
    function particles(dt, kW, k) {
      pMat.opacity = k * 0.95; pts.visible = k > 0.02; if (!pts.visible) return;
      var mag = Math.abs(kW), dir = kW >= 0 ? 1 : -1, speed = (0.12 + 0.9 * Math.min(1, mag / 40)) * dir, act = Math.round(NP * clamp(0.1 + mag / 36, 0.1, 1)); pMat.color.set(kW >= 0 ? P_.accent : 0xbff5ec);
      for (var i = 0; i < NP; i++) { pU[i] = (pU[i] + speed * dt + 1) % 1; if (i >= act) { pPos[i * 3 + 1] = -50; continue; } PATHS[pPath[i]].getPoint(pU[i], tmpV); pPos[i * 3] = tmpV.x; pPos[i * 3 + 1] = tmpV.y; pPos[i * 3 + 2] = tmpV.z; }
      pGeo.attributes.position.needsUpdate = true;
    }
    /* --- gap marker between our front bumper and the lead car's rear (to scale: window 33's mean gap) --- */
    var gapMat = new THREE.MeshBasicMaterial({ color: P_.accent, transparent: true, opacity: 0, depthWrite: false }), gapLine = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.14).rotateX(-Math.PI / 2), gapMat); gapLine.renderOrder = 3; gapLine.visible = false; scene.add(gapLine);
    var tickG = new THREE.PlaneGeometry(0.1, 1).rotateX(-Math.PI / 2), ticks = [0, 1].map(function () { var m = new THREE.Mesh(tickG, gapMat); m.scale.z = 0.9; m.renderOrder = 3; m.visible = false; scene.add(m); return m; });
    var gapLbl = (function () { var cv = document.createElement('canvas'); cv.width = 256; cv.height = 64; var x = cv.getContext('2d'), draw = function () { x.clearRect(0, 0, 256, 64); x.font = '500 34px "IBM Plex Mono", monospace'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = P_.dark ? '#7ef0df' : '#0b5f58'; x.fillText('gap ' + GAPM.toFixed(1) + ' m', 128, 34); }; draw();
      var t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; if (document.fonts && document.fonts.load) document.fonts.load('500 34px "IBM Plex Mono"').then(function () { draw(); t.needsUpdate = true; }).catch(function () { });
      var m = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, opacity: 0, depthWrite: false, fog: false })); m.scale.set(2.6, 0.65, 1); m.renderOrder = 4; m.visible = false; scene.add(m); return m; })();
    /* --- cars --- */
    var C = CS, lead = null, ours = null, gapStart = 0;
    function setCars(md) {
      [lead, ours].forEach(function (c) { if (c) scene.remove(c.g); });
      if (md) { C = md.C; lead = makeModelCar(md, { body: 0xc9d0d5, roof: 0x2b3136 }, false); ours = makeModelCar(md, { body: P_.dark ? 0x1fb5a5 : 0x14a193, roof: 0x2b3136 }, true); }
      else { C = CS; lead = makeStylCar({ body: 0xaab2b8 }, false); ours = makeStylCar({ body: P_.dark ? 0x1fb5a5 : 0x14a193 }, true); }
      ours.g.position.set(0, 0, LANE); lead.g.position.set(C.len + GAPM, 0, LANE); ours.g.add(inner); buildInner(C); scene.add(lead.g, ours.g);
      gapLine.position.set(C.len / 2 + GAPM / 2, 0.05, LANE + 0.55); gapLine.scale.x = GAPM; ticks[0].position.set(C.len / 2, 0.05, LANE + 0.55); ticks[1].position.set(C.len / 2 + GAPM, 0.05, LANE + 0.55); gapLbl.position.set(C.len / 2 + GAPM / 2 - 1.2, 2.3, LANE + 0.55);
    }
    setCars(null);
    var camP = new THREE.Vector3(), camT = new THREE.Vector3(), pA = new THREE.Vector3(), pB = new THREE.Vector3(), w_ = 2, h_ = 2;
    function size() { var w = Math.max(2, Math.floor(root.clientWidth)), h = Math.max(2, Math.floor(root.clientHeight)); w_ = w; h_ = h; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); }
    function pose(i, u, out, look) {   // u in 0..1 along the shot (eased by the caller)
      var s = SH[i], k = C.len / 4.878, a = s.a, b = s.b;
      out.set(lerp(a[0][0], b[0][0], u) * k, lerp(a[0][1], b[0][1], u) * k, lerp(a[0][2], b[0][2], u) * k + LANE); look.set(lerp(a[1][0], b[1][0], u) * (i === 4 ? 1 : k), lerp(a[1][1], b[1][1], u), lerp(a[1][2], b[1][2], u) + LANE);
    }
    var cur = { fov: 26, shift: 0.14 };
    function apply(dt, i, camPose, instant) {
      var s = SH[i], k = s.k, a = instant ? 1 : 1 - Math.exp(-dt * 3.2);
      S.xray += ((k.xray || 0) - S.xray) * a; S.batt += ((k.batt || 0) - S.batt) * a; S.regen += ((k.regen || 0) - S.regen) * a; S.gap += ((k.gap || 0) - S.gap) * a; S.v += (s.v - S.v) * a;
      cur.fov += (s.fov - cur.fov) * a; cur.shift += (s.shift - cur.shift) * a;
      // wheels and ground
      var sp = function (c, v, d) { var an = v / c.R * d; c.wheels.forEach(function (w) { w.spin.rotation.z -= an; }); }; sp(ours, S.v, dt); sp(lead, S.v, dt); scroll += S.v * dt; placeDashes(scroll); gridTex.offset.x = scroll / GS;
      // x-ray (body fades, pack and motor show)
      var k_ = S.xray, tr = k_ > 0.01; ours.fade.forEach(function (m) { m.opacity = 1 - 0.88 * k_; if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; } m.depthWrite = k_ < 0.4; });
      packM.emissiveIntensity = 0.08 + 1.6 * S.batt * 0.8; packM.opacity = 0.35 + 0.65 * k_; inner.visible = k_ > 0.02; motorM.emissiveIntensity = 0.1 + 0.9 * S.regen; cableM.opacity = k_ * 0.5; ours.rimR.emissiveIntensity = 0.85 * S.regen;
      particles(dt, S.regen > 0.5 ? -22 : 22, k_ * (S.batt > 0.5 || S.regen > 0.5 ? 1 : 0.7));
      var gv = S.gap > 0.01; gapLine.visible = gapLbl.visible = ticks[0].visible = ticks[1].visible = gv; gapMat.opacity = 0.95 * S.gap; gapLbl.material.opacity = S.gap;
      // camera
      camera.fov = cur.fov; camera.updateProjectionMatrix(); camera.position.copy(camPose.p); camera.lookAt(camPose.t);
      if (cur.shift > 0.001) camera.setViewOffset(w_, h_, -Math.round(w_ * cur.shift), 0, w_, h_); else camera.clearViewOffset(); camera.updateMatrixWorld();
    }
    return {
      renderer: renderer, size: size, pose: pose, apply: apply, camP: camP, camT: camT, pA: pA, pB: pB, scene: scene, camera: camera, lead: function () { return lead; }, ours: function () { return ours; }, model: false, pending: false,
      useModel: function (md) { setCars(md); this.model = true; this.pending = false; },
      draw: function () { renderer.render(scene, camera); }, dispose: function () { try { renderer.dispose(); renderer.forceContextLoss(); } catch (e) { } }, THREE: THREE
    };
  }

  /* ------------------------------------------------------------ timeline */
  function shotAt(t) {   // -> {i, hold: 0..1, trans: 0..1 or -1, from}
    var c = Math.floor(t / PER), i = c % N, s = t - c * PER;
    if (c === 0) return { i: i, u: s / PER, trans: -1, s: s, hold0: 0 };
    if (s < TRANS) return { i: i, u: 0, trans: s / TRANS, from: (i + N - 1) % N, s: s, hold0: TRANS };
    return { i: i, u: (s - TRANS) / (PER - TRANS), trans: -1, s: s, hold0: TRANS };
  }
  function camFor(sh, out) {   // out: {p, t} vectors
    if (sh.trans >= 0) { var e = ease(sh.trans); G.pose(sh.from, 1, G.pA, G.pB); var p0 = G.pA.clone(), t0 = G.pB.clone(); G.pose(sh.i, 0, G.pA, G.pB); out.p.copy(p0).lerp(G.pA, e); out.t.copy(t0).lerp(G.pB, e); }
    else { G.pose(sh.i, ease(sh.u), out.p, out.t); }
  }
  var camOut = null;
  function sizeScene() { if (!G || !root) return; G.size(); G.draw(); }
  function loop() { document.addEventListener('visibilitychange', onVis); if (!camOut) camOut = { p: new G.THREE.Vector3(), t: new G.THREE.Vector3() }; lastT = 0; rafId = requestAnimationFrame(frame); }
  function frame(now) {
    rafId = 0; if (!G || !root || document.hidden) return;
    if (now - lastT < 32) { rafId = requestAnimationFrame(frame); return; }   // 30 fps cap
    var dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0.033; lastT = now; tl += dt;
    // frame-rate guard: the film must never compete with the engine for the CPU. If the graphics cannot keep up (software rasteriser, busy or small GPU) it falls back to six pre-rendered still frames after about 1.5 s.
    if (!fpsT0) { fpsT0 = now; fpsN = 0; } fpsN++;
    if (now - fpsT0 > 1500) { var fps = fpsN * 1000 / (now - fpsT0); if (fps < 20 && !window.__LD_NOGUARD) { console.info('loading overlay: graphics too slow (' + fps.toFixed(1) + ' fps), switching to still frames'); degraded = true; stillsFromFiles(); return; } fpsT0 = now; fpsN = 0; if (tl > 15) fpsT0 = Infinity; }
    var sh = shotAt(tl);
    if (sh.i !== curShot) { curShot = sh.i; if (G.pending && modelData && sh.trans >= 0) G.useModel(modelData); setChip(sh.i); }
    // fact chip: in after the move has settled a little, out before the next move
    chipVis(sh.trans < 0 ? (sh.u > 0.06 && sh.u < 0.9) : false);
    camFor(sh, camOut); G.apply(dt, sh.i, camOut, false); G.draw();
    rafId = requestAnimationFrame(frame);
  }
  window.__ldTest = { step: function (dt) { if (!G) return false; cancelAnimationFrame(rafId); rafId = 0; if (!camOut) camOut = { p: new G.THREE.Vector3(), t: new G.THREE.Vector3() }; tl += dt; var sh = shotAt(tl); if (sh.i !== curShot) { curShot = sh.i; setChip(sh.i); } chipVis(sh.trans < 0 ? (sh.u > 0.06 && sh.u < 0.9) : false); camFor(sh, camOut); G.apply(dt, sh.i, camOut, false); G.draw(); return true; }, dataURL: function (i, q) { if (!G || !this.still(i)) return null; return canvas.toDataURL('image/jpeg', q || 0.82); }, chip: function (i) { setChip(i); chipVis(true); }, still: function (i) { if (!G) return false; cancelAnimationFrame(rafId); rafId = 0; tl = (i === 0 ? N : 0) * PER + i * PER + TRANS + (PER - TRANS) * 0.55; var sh = shotAt(tl); setChip(i); chipVis(true); if (!camOut) camOut = { p: new G.THREE.Vector3(), t: new G.THREE.Vector3() }; camFor(sh, camOut); G.apply(1, i, camOut, true); G.apply(1, i, camOut, true); G.draw(); return true; }, jump: function (i, u) { tl = i * PER + TRANS + (PER - TRANS) * (u === undefined ? 0.5 : u) + (i === 0 ? 0 : 0); if (i === 0) tl = PER * N + TRANS + (PER - TRANS) * (u === undefined ? 0.5 : u); }, state: function () { return { shown: shown, gone: gone, ready: ready, weak: weakGL, glOK: glOK, model: !!(G && G.model), shot: curShot, prog: prog, rm: rmMode, mode: mode, soft: softGL, degraded: degraded, stages: JSON.parse(JSON.stringify(st)), bytes: bytes }; }, W: function () { return W; }, pause: function () { cancelAnimationFrame(rafId); rafId = 0; }, hide: hide };
})();
