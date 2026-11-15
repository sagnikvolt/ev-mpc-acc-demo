'use strict';
/* Home scene: a vanilla-JS port of the VEYRA interactive car scene (src/App.tsx, HoverVideo.tsx, AppearanceMenu.tsx, appearance.ts, content.ts, tag v1.0.0)
   by Amir Mušić, MIT licence, github.com/amirmushichge/veyra-interactive-car. Concept car images and hover films are his (MIT, see /media/veyra/THIRD_PARTY_NOTICES.md).
   The state machine is ported one-to-one (phases overview -> entering -> detail -> returning, neutral-pose gate, decoded-frame gate, endpoint queue,
   frozen detail handoff, closing lock, Escape, reduced motion). The content (text, numbers, annotation points) comes from the page's JSON (#vs-data), built by
   demo_v2/build_site.py from this project's result files. The hover films are loaded after first paint. */
(function () {
  var root = document.getElementById('vs'), dataEl = document.getElementById('vs-data');
  if (!root || !dataEl) return;
  var DATA = JSON.parse(dataEl.textContent), MEDIA = DATA.media, BASE = MEDIA + 'exterior-polished.png';
  var SYSTEMS = DATA.systems, HOT = DATA.hotspots, OPTS = DATA.options;
  var $ = function (s, r) { return (r || root).querySelector(s); };
  var html = document.documentElement;
  var ICON = {
    plus: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M12 5v14"/></svg>',
    x: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    x16: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>',
    arrow: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg>',
    back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 19-7-7 7-7M19 12H5"/></svg>',
    check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
  };
  function el(tag, cls, attrs, inner) {
    var n = document.createElement(tag); if (cls) n.className = cls;
    if (attrs) for (var k in attrs) if (attrs[k] !== null && attrs[k] !== undefined) n.setAttribute(k, attrs[k]);
    if (inner !== undefined) n.innerHTML = inner; return n;
  }
  function esc(t) { return String(t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ------------------------------------------------------------ state (App.tsx useState) */
  var S = {
    phase: 'overview', selected: 'battery', hovered: null, annotation: null, ready: false, error: '', reduced: false, detailVisible: false,
    appearance: null, pinned: false, closing: false, optionId: 'silver', appearanceImage: BASE, neutral: true,
    loaded: {}, failed: {}, loading: null
  };
  S.loaded[BASE] = true;
  var lock = false, request = 0, timer = 0, revealTimer = 0, appearanceTimer = 0, leaveTimer = 0, suppressFocus = false;
  var entryButtons = {}, appearanceButtons = {};
  var imgLoads = {};   // src -> Promise (decoded), one load per image

  function canUseHotspot(active, id, closing) { return !closing && (!active || active === id); }
  function busy() { return S.phase === 'entering' || S.phase === 'returning'; }

  /* ------------------------------------------------------------ DOM skeleton: the shared image plane */
  var stage = $('.vs-stage'), plane = $('.vs-plane'), carVisual = $('.vs-car-visual'), carImg = $('.vs-car-image'), canvas = $('.vs-hover-video'),
      apVisual = $('.vs-appearance-visual'), apImg = $('img', apVisual), detailVisual = $('.vs-detail-visual'), detailImg = $('.vs-detail-image'),
      hotLayer = $('.vs-hotlayer'), annoLayer = $('.vs-annolayer'), intro = $('.vs-intro'), backSlot = $('.vs-backslot'),
      detail = $('.vs-detail'), statusEl = $('.vs-status'), sr = $('.vs-sr'), errEl = $('.vs-error');
  var detailBuilt = null;

  function loadImage(src) {
    if (imgLoads[src]) return imgLoads[src];
    imgLoads[src] = new Promise(function (resolve, reject) {
      var im = new Image();
      im.onload = function () { (im.decode ? im.decode() : Promise.resolve()).then(resolve, resolve); };
      im.onerror = function () { delete imgLoads[src]; reject(new Error('load ' + src)); };
      im.src = src;
    });
    return imgLoads[src];
  }

  /* ------------------------------------------------------------ HoverVideo.tsx, ported */
  var SOURCES = { drive: [MEDIA + 'hood-hover-forward.mp4', MEDIA + 'hood-hover-reverse.mp4'], battery: [MEDIA + 'battery-hover-forward.mp4', MEDIA + 'battery-hover-reverse.mp4'] };
  // Complete each short clip before changing direction. The supplied reverse clips have their own timing curves: duration-ratio seeking would not preserve pose.
  function nextPreviewClip(current, desired) {
    if (current === desired) return null;
    return current ? { id: current, reverse: true } : desired ? { id: desired, reverse: false } : null;
  }
  function createHoverVideo(surface, getProps, onNeutral) {
    var context = surface.getContext('2d', { alpha: false });
    var videos = {}, disposed = false, settled = null, active = null, running = false, frozen = false, failed = false, generation = 0, raf = 0, watchdog = 0, cancelFrame, started = false;
    var log = [];   // test hook: sequence of clip starts/completions/failures
    function start0() {
      if (started || disposed) return; started = true;
      Object.keys(SOURCES).forEach(function (id) {
        SOURCES[id].forEach(function (src, direction) {
          var v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = src; videos[id + '-' + direction] = v;
        });
      });
    }
    function draw(video) {
      if (video.readyState < 2 || video.seeking || !video.videoWidth) return;
      if (surface.width !== video.videoWidth || surface.height !== video.videoHeight) { surface.width = video.videoWidth; surface.height = video.videoHeight; }
      context.drawImage(video, 0, 0, surface.width, surface.height);
      surface.style.opacity = '1';
    }
    function stop() {
      generation++;
      if (active) active.pause();
      if (active) active.onended = active.onerror = active.onloadeddata = active.onseeked = null;
      if (cancelFrame) cancelFrame();
      cancelFrame = undefined;
      cancelAnimationFrame(raf);
      clearTimeout(watchdog);
      running = false; active = null;
    }
    function update() {
      if (disposed || !started) return;
      var props = getProps();
      // Freeze the exact visible hover frame while the existing detail crossfade covers it. Reset only once the detail is fully opaque.
      if (props.mode === 'entering') { if (!frozen) { stop(); frozen = true; } return; }
      if (props.mode === 'detail' || props.reduced) {
        stop(); settled = null; frozen = false; surface.style.opacity = '0'; onNeutral(true); return;
      }
      if (props.mode !== 'overview' || running || failed) return;
      frozen = false;
      var next = nextPreviewClip(settled, props.desired);
      if (!next) return;
      var video = videos[next.id + '-' + (next.reverse ? 1 : 0)];
      active = video; running = true; onNeutral(false); log.push('start ' + next.id + (next.reverse ? ' rev' : ' fwd'));
      var token = ++generation;
      function valid() { return !disposed && generation === token; }
      function fail() {
        if (!valid()) return;
        stop(); failed = true; log.push('fail ' + next.id); root.setAttribute('data-hover', 'failed');
        onNeutral(true);
        // Keep the last decoded canvas frame. Detail navigation still works.
      }
      function complete() {
        if (!valid()) return;
        draw(video); stop();
        settled = next.reverse ? null : next.id; log.push('done ' + next.id + (next.reverse ? ' rev' : ' fwd'));
        onNeutral(settled === null);
        update();
      }
      function paint() {
        if (!valid()) return;
        draw(video);
        if ('requestVideoFrameCallback' in video) { var h = video.requestVideoFrameCallback(paint); cancelFrame = function () { video.cancelVideoFrameCallback(h); }; }
        else raf = requestAnimationFrame(paint);
      }
      function start() {
        if (!valid()) return;
        video.onseeked = video.onloadeddata = null;
        // Don't draw the video during load/seek. The canvas retains the previous frame until this video's first decoded playback frame is delivered.
        if ('requestVideoFrameCallback' in video) { var h = video.requestVideoFrameCallback(paint); cancelFrame = function () { video.cancelVideoFrameCallback(h); }; }
        else raf = requestAnimationFrame(paint);
        var p = video.play(); if (p && p.catch) p.catch(fail);
      }
      function prepare() {
        if (!valid()) return;
        video.onloadeddata = null;
        if (video.currentTime > 0.001) { video.onseeked = start; video.currentTime = 0; } else start();
      }
      video.onended = complete; video.onerror = fail;
      watchdog = window.setTimeout(fail, 15000);
      if (video.readyState >= 2) prepare(); else { video.onloadeddata = prepare; video.load(); }
    }
    return {
      begin: function () { start0(); update(); },
      sync: update,
      debug: function () { return { settled: settled, running: running, failed: failed, frozen: frozen, started: started, log: log.slice(), opacity: surface.style.opacity }; },
      dispose: function () {
        disposed = true; stop();
        Object.keys(videos).forEach(function (k) { videos[k].removeAttribute('src'); videos[k].load(); });
      }
    };
  }

  /* ------------------------------------------------------------ state setters */
  var rendering = false, dirty = false;
  function set(patch) { for (var k in patch) S[k] = patch[k]; render(); }
  var hover = createHoverVideo(canvas, function () {
    return { desired: (!S.appearance && (S.hovered === 'drive' || S.hovered === 'battery')) ? S.hovered : null, mode: S.phase, reduced: S.reduced };
  }, function (n) { if (S.neutral !== n) set({ neutral: n }); });
  var lastHover = '';
  function syncHover() {
    var p = (!S.appearance && (S.hovered === 'drive' || S.hovered === 'battery')) ? S.hovered : null, key = p + '|' + S.phase + '|' + S.reduced;
    if (key === lastHover) return; lastHover = key; hover.sync();
  }

  /* ------------------------------------------------------------ appearance (App.tsx) */
  function openAppearance(mode) {
    if (S.phase !== 'overview' || !canUseHotspot(S.appearance, mode, S.closing)) return;
    clearTimeout(leaveTimer);
    S.hovered = null;
    if (S.appearance === mode) { render(); return; }
    S.appearance = mode; S.pinned = false; S.optionId = OPTS[mode][0].id; S.appearanceImage = BASE;
    if (mode === 'wheels') OPTS.wheels.forEach(function (o) { preloadOption(o); });   // the wheel chips are crops of these images
    render();
  }
  function preloadOption(o) {
    if (S.loaded[o.image]) return;
    loadImage(o.image).then(function () { S.loaded[o.image] = true; delete S.failed[o.image]; render(); }, function () { S.failed[o.image] = true; render(); });
  }
  function closeAppearance(restoreFocus) {
    if (restoreFocus === undefined) restoreFocus = true;
    if (!S.appearance || S.closing) return;
    var previousMode = S.appearance;
    clearTimeout(leaveTimer);
    S.closing = true; S.hovered = null; render();
    appearanceTimer = window.setTimeout(function () {
      S.appearance = null; S.pinned = false; S.closing = false; S.appearanceImage = BASE; S.loading = null;
      // Reference behaviour kept on purpose (v1.0.0 known limitation): focus is requested BEFORE the buttons are re-enabled (React commits after this
      // callback), so the still-disabled hotspot cannot take focus and focus falls to BODY. Do not move this call after render().
      if (restoreFocus) {
        suppressFocus = true;
        if (appearanceButtons[previousMode]) appearanceButtons[previousMode].focus({ preventScroll: true });
        suppressFocus = false;
      }
      render();
    }, S.reduced ? 0 : 260);
  }
  function chooseAppearance(id) {
    if (!S.appearance || S.closing || !S.neutral) return;
    var mode = S.appearance, option = null;
    OPTS[mode].forEach(function (o) { if (o.id === id) option = o; });
    if (!option) return;
    function apply() { S.pinned = true; S.optionId = id; S.appearanceImage = option.image; S.loading = null; render(); }
    if (S.loaded[option.image]) { apply(); return; }
    // The paint/wheel images load only when an option is chosen (wheel images also when the Wheels panel opens, for the chips).
    S.loading = id; S.pinned = true; render();
    loadImage(option.image).then(function () {
      S.loaded[option.image] = true; delete S.failed[option.image];
      if (S.appearance === mode && !S.closing && S.loading === id) apply(); else render();
    }, function () { S.failed[option.image] = true; if (S.loading === id) S.loading = null; render(); });
  }

  /* ------------------------------------------------------------ plane geometry (App.tsx updatePlane, adapted to our page flow) */
  function updatePlane() {
    var width = stage.getBoundingClientRect().width, mobile = window.innerWidth <= 900;
    var navH = (document.querySelector('header.nav') || { offsetHeight: 56 }).offsetHeight, introH = intro.offsetHeight + 12;   // the intro keeps its place in every phase, so the frame never moves
    var mediaHeight = Math.max(560, window.innerHeight) - navH - introH - 132;   // 132 px: room under the frame for the Paint/Wheels dock and the note line
    var w = mobile ? width : Math.min(width, mediaHeight * 1672 / 941), h = w * 941 / 1672;
    root.style.setProperty('--vs-w', w + 'px'); root.style.setProperty('--vs-h', h + 'px'); root.style.setProperty('--vs-intro-h', introH + 'px');
  }

  /* ------------------------------------------------------------ transitions (App.tsx finish / transition / escape) */
  function finish(returning, id) {
    clearTimeout(timer);
    S.phase = returning ? 'overview' : 'detail'; S.detailVisible = !returning; lock = false; render();
    setTimeout(function () {
      var b = returning ? entryButtons[id] : root.querySelector('.vs-back');
      if (b) b.focus({ preventScroll: true });
    }, 0);
  }
  function transition(id, returning) {
    if (id === 'optics' || S.appearance || lock || !S.ready || (!returning && S.phase !== 'overview')) return;
    lock = true;
    var token = ++request;
    S.selected = id; S.hovered = null; S.annotation = null; S.error = ''; S.phase = returning ? 'returning' : 'entering'; render();
    // Hover films stay separate from the existing click-to-detail crossfade.
    revealTimer = window.setTimeout(function () { if (request === token) set({ detailVisible: !returning }); }, S.reduced ? 0 : 350);
    timer = window.setTimeout(function () { if (request === token) finish(returning, id); }, S.reduced ? 0 : 1250);
  }
  function returnToCar() { if (S.phase === 'detail') transition(S.selected, true); }
  window.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { if (S.appearance) closeAppearance(); else returnToCar(); }
  });

  /* ------------------------------------------------------------ build the static parts */
  // Entry hotspots (drive, battery): real buttons; the appearance hotspots are built on render because their menu comes and goes.
  var apWrap = {};
  HOT.forEach(function (item) {
    if (item.target) {
      var b = el('button', 'vs-hotspot', { type: 'button', style: 'left:' + item.x + '%;top:' + item.y + '%', 'aria-label': item.aria, 'data-id': item.id },
        '<span class="vs-ring">' + ICON.plus + '</span><span class="vs-label">' + esc(item.label) + ICON.arrow + '</span>');
      b.addEventListener('pointerenter', function () { if (canUseHotspot(S.appearance, item.id, S.closing)) set({ hovered: item.id }); });
      b.addEventListener('pointerleave', function () { set({ hovered: null }); });
      b.addEventListener('focus', function () { if (canUseHotspot(S.appearance, item.id, S.closing)) set({ hovered: item.id }); });
      b.addEventListener('blur', function () { set({ hovered: null }); });
      b.addEventListener('click', function () { transition(item.target); });
      entryButtons[item.target] = b; hotLayer.appendChild(b);
    } else {
      var w = el('div', 'vs-aphot', { style: '--anchor-x:' + item.x + '%;--anchor-y:' + item.y + '%', 'data-id': item.id });
      var ab = el('button', 'vs-hotspot', { type: 'button', 'aria-controls': 'vs-ap-' + item.id, 'aria-label': item.aria, 'aria-expanded': 'false', 'data-id': item.id },
        '<span class="vs-ring">' + ICON.plus + '</span><span class="vs-label">' + esc(item.label) + '</span>');
      w.appendChild(ab);
      w.addEventListener('pointerenter', function () { openAppearance(item.id); });
      w.addEventListener('pointerleave', function (event) {
        if (!S.pinned && !w.contains(document.activeElement)) leaveTimer = window.setTimeout(function () { closeAppearance(false); }, 140);
      });
      w.addEventListener('focusout', function (event) {
        if (!S.pinned && !w.contains(event.relatedTarget)) closeAppearance(false);
      });
      ab.addEventListener('focus', function () { if (!suppressFocus) openAppearance(item.id); });
      ab.addEventListener('click', function () {
        if (S.appearance === item.id && S.pinned) closeAppearance();
        else { openAppearance(item.id); S.pinned = true; render(); }
      });
      appearanceButtons[item.id] = ab; apWrap[item.id] = w; hotLayer.appendChild(w);
    }
  });
  // appearance menu (AppearanceMenu.tsx)
  function buildMenu(mode) {
    var m = el('div', 'vs-ap-menu ' + mode, { id: 'vs-ap-' + mode, role: 'group', 'aria-label': mode === 'paint' ? 'Body colour' : 'Wheel design' });
    m.innerHTML = '<div class="vs-ap-heading"><span>' + (mode === 'paint' ? 'Paint' : 'Wheels') + '</span><button type="button" class="vs-ap-close" aria-label="Close and restore original vehicle">' + ICON.x16 + '</button></div>' +
      '<div class="vs-ap-options"></div><div class="vs-ap-caption" aria-live="polite"></div>';
    $('.vs-ap-close', m).addEventListener('click', function () { closeAppearance(); });
    var box = $('.vs-ap-options', m);
    OPTS[mode].forEach(function (o) {
      var b = el('button', 'vs-ap-option', { type: 'button', 'data-id': o.id, title: o.label });
      b.innerHTML = mode === 'paint' ? '<span class="vs-paint-chip" style="background-color:' + o.color + ';color:' + (o.id === 'graphite' ? '#fff' : '#111') + '"></span>' : '<span class="vs-wheel-chip"></span>';
      b.addEventListener('click', function () { chooseAppearance(o.id); });
      box.appendChild(b);
    });
    return m;
  }
  function syncMenu(mode, m) {
    var cur = null, failedAny = false;
    OPTS[mode].forEach(function (o) { if (o.id === S.optionId) cur = o; if (S.failed[o.image]) failedAny = true; });
    var waiting = !S.neutral, btns = m.querySelectorAll('.vs-ap-option');
    OPTS[mode].forEach(function (o, i) {
      var b = btns[i], unavailable = !!S.failed[o.image], needsImg = mode === 'wheels' && !S.loaded[o.image];
      b.disabled = waiting || needsImg || !!S.loading; b.className = 'vs-ap-option' + (o.id === S.optionId ? ' selected' : '');
      b.setAttribute('aria-label', o.label + (unavailable ? ' (unavailable)' : '')); b.setAttribute('aria-pressed', o.id === S.optionId ? 'true' : 'false');
      if (mode === 'paint') { b.firstChild.innerHTML = o.id === S.optionId ? ICON.check : ''; }
      else if (S.loaded[o.image] && b.firstChild.getAttribute('data-bg') !== '1') { b.firstChild.style.backgroundImage = 'url("' + o.image + '")'; b.firstChild.setAttribute('data-bg', '1'); }
    });
    var cap = $('.vs-ap-caption', m);
    cap.innerHTML = esc(waiting ? 'Returning to exterior…' : S.loading ? 'Loading…' : cur.label) + '<small>' + esc(failedAny ? 'Some options could not load' : DATA.funLine) + '</small>';
  }
  // detail copy (aside) for the current system
  function buildDetail(id) {
    var s = SYSTEMS[id];
    var h = '<div class="vs-detail-introduction"><p class="vs-eyebrow">' + esc(s.category) + '</p><h2>' + s.title.split('\n').map(function (l) { return '<span>' + esc(l) + '</span>'; }).join('') + '</h2><p class="vs-system-description">' + esc(s.description) + '</p></div>' +
      '<div class="vs-detail-components"><div class="vs-part-list">';
    s.points.forEach(function (p, i) {
      h += '<button type="button" data-i="' + i + '" aria-expanded="false"><span class="vs-part-row"><small>' + ('0' + (i + 1)).slice(-2) + '</small>' + esc(p.label) + ICON.plus + '</span><span class="vs-part-description" hidden>' + esc(p.text) + '</span></button>';
    });
    h += '</div><div class="vs-benefit"><span>' + esc(s.benefitHead) + '</span><p>' + esc(s.benefit) + '</p></div></div>';
    detail.innerHTML = h;
    Array.prototype.forEach.call(detail.querySelectorAll('.vs-part-list button'), function (b) {
      b.addEventListener('click', function () { var i = +b.getAttribute('data-i'); set({ annotation: S.annotation === i ? null : i }); });
    });
    detailBuilt = id;
  }

  /* ------------------------------------------------------------ render: sync the DOM from S */
  var backBtn = null, annoBuilt = null;
  function render() {
    if (rendering) { dirty = true; return; } rendering = true;
    try {
      var cur = SYSTEMS[S.selected], b = busy();
      root.className = 'vs phase-' + S.phase + (S.reduced ? ' reduced' : '') + (S.appearance ? ' menu-open' : '');
      root.setAttribute('aria-busy', b ? 'true' : 'false');
      root.style.setProperty('--focus-x', cur.anchor.x + '%'); root.style.setProperty('--focus-y', cur.anchor.y + '%');
      // images
      if (detailImg.getAttribute('data-sys') !== S.selected) { detailImg.src = cur.image; detailImg.alt = 'Illustrative cutaway of the ' + cur.label.toLowerCase() + ' (generic picture, not this project\'s car)'; detailImg.setAttribute('data-sys', S.selected); }
      if (apImg.getAttribute('src') !== S.appearanceImage) apImg.src = S.appearanceImage;
      apVisual.className = 'vs-appearance-visual' + (S.appearance && S.neutral && !S.closing ? ' shown' : '');
      detailVisual.className = 'vs-detail-visual' + (S.detailVisible ? ' shown' : '');
      // hotspots
      hotLayer.hidden = !(S.phase === 'overview' && S.ready);
      HOT.forEach(function (item) {
        var enabled = canUseHotspot(S.appearance, item.id, S.closing);
        if (item.target) {
          var eb = entryButtons[item.target]; eb.disabled = !enabled; eb.className = 'vs-hotspot' + (S.hovered === item.id ? ' active' : '');
        } else {
          var w = apWrap[item.id], ab = appearanceButtons[item.id], open = S.appearance === item.id, menu = w.querySelector('.vs-ap-menu'), bridge = w.querySelector('.vs-menu-bridge');
          w.className = 'vs-aphot' + (open ? ' expanded' : '');
          ab.disabled = !enabled; ab.className = 'vs-hotspot' + (open ? ' active' : '');
          ab.setAttribute('aria-expanded', open && !S.closing ? 'true' : 'false');
          ab.firstChild.innerHTML = open && S.pinned ? ICON.x : ICON.plus;
          if (open && !S.closing) {
            if (!bridge) w.appendChild(el('span', 'vs-menu-bridge', { 'aria-hidden': 'true' }));
            if (!menu) { menu = buildMenu(item.id); w.appendChild(menu); }
            syncMenu(item.id, menu);
          } else { if (bridge) bridge.remove(); if (menu) menu.remove(); }
        }
      });
      // intro + back + status
      intro.className = 'vs-intro' + (S.phase !== 'overview' ? ' hide' : ''); intro.setAttribute('aria-hidden', S.phase !== 'overview' ? 'true' : 'false');
      if (S.phase !== 'overview') {
        if (!backBtn) {
          backBtn = el('button', 'vs-back', { type: 'button', 'aria-label': 'Back to the car' }, ICON.back + '<span></span><kbd>Esc</kbd>');
          backBtn.addEventListener('click', returnToCar); backSlot.appendChild(backBtn);
        }
        backBtn.disabled = b; backBtn.querySelector('span').textContent = S.phase === 'returning' ? 'Returning to the car' : 'Back to the car';
      } else if (backBtn) { backBtn.remove(); backBtn = null; }
      // detail copy + annotations
      if (detailBuilt !== S.selected) buildDetail(S.selected);
      detail.className = 'vs-detail' + (S.phase === 'detail' ? ' shown' : ''); detail.setAttribute('aria-hidden', S.phase === 'detail' ? 'false' : 'true');
      Array.prototype.forEach.call(detail.querySelectorAll('.vs-part-list button'), function (pb, i) {
        var sel = S.annotation === i; pb.className = sel ? 'selected' : ''; pb.setAttribute('aria-expanded', sel ? 'true' : 'false'); pb.tabIndex = S.phase === 'detail' ? 0 : -1;
        pb.querySelector('.vs-part-description').hidden = !sel;
      });
      if (S.phase === 'detail') {
        if (annoBuilt !== S.selected) {
          annoLayer.innerHTML = '';
          cur.points.forEach(function (p, i) {
            var a = el('button', 'vs-annotation', { type: 'button', style: 'left:' + p.x + '%;top:' + p.y + '%', 'aria-label': p.label, 'aria-expanded': 'false' }, '<span>' + ('0' + (i + 1)).slice(-2) + '</span><span class="vs-annotation-label">' + esc(p.label) + '</span>');
            a.addEventListener('click', function () { set({ annotation: S.annotation === i ? null : i }); }); annoLayer.appendChild(a);
          }); annoBuilt = S.selected;
        }
        Array.prototype.forEach.call(annoLayer.children, function (a, i) { a.className = 'vs-annotation' + (S.annotation === i ? ' open' : ''); a.setAttribute('aria-expanded', S.annotation === i ? 'true' : 'false'); });
      } else if (annoBuilt) { annoLayer.innerHTML = ''; annoBuilt = null; }
      var st = b || !S.ready ? (!S.ready ? 'Preparing the views' : S.phase === 'returning' ? 'Returning to the exterior' : 'Inside the ' + cur.label.toLowerCase()) : '';
      statusEl.hidden = !st; statusEl.innerHTML = st ? '<span class="vs-small-dot"></span>' + esc(st) : '';
      sr.textContent = b ? (S.phase === 'entering' ? 'Opening ' : 'Closing ') + cur.label : S.phase === 'detail' ? cur.label + ' view. Press Escape to return.' : 'Vehicle overview. Choose a system.';
      errEl.hidden = !S.error; errEl.querySelector('span').textContent = S.error || '';
      var base = $('.vs-baseline-r'); if (base) base.textContent = S.phase === 'overview' ? DATA.baselineOverview : DATA.baselineDetail;
      syncHover();
    } finally { rendering = false; }
    if (dirty) { dirty = false; render(); }
  }
  errEl.querySelector('button').addEventListener('click', function () { set({ error: '' }); });

  /* ------------------------------------------------------------ reduced motion: system setting or the footer "Reduce motion" box (html.rm) */
  var mq = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  function readReduced() { var r = (mq && mq.matches) || html.classList.contains('rm'); if (r !== S.reduced) set({ reduced: r }); }
  if (mq) (mq.addEventListener ? mq.addEventListener('change', readReduced) : mq.addListener(readReduced));
  new MutationObserver(readReduced).observe(html, { attributes: true, attributeFilter: ['class'] });
  S.reduced = !!((mq && mq.matches) || html.classList.contains('rm'));

  /* ------------------------------------------------------------ boot */
  if (window.ResizeObserver) { var ro = new ResizeObserver(updatePlane); ro.observe(stage); ro.observe(intro); }
  window.addEventListener('resize', updatePlane);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(updatePlane);
  updatePlane(); render();
  var imgs = [BASE, SYSTEMS.battery.image, SYSTEMS.drive.image];
  Promise.all(imgs.map(loadImage)).then(function () {
    set({ ready: true });
    // Preload the hover films after first paint (two frames after the stills are decoded), never before.
    requestAnimationFrame(function () { requestAnimationFrame(function () { hover.begin(); }); });
  }, function () { set({ error: 'An image could not load. Reload to retry.' }); });
  window.__vs = { state: function () { return JSON.parse(JSON.stringify(S, function (k, v) { return v; })); }, hover: function () { return hover.debug(); }, transition: transition, S: S };
})();
