'use strict';
/* Round o motion layer, vanilla JS. Effects play once, move only transform/opacity/filter/stroke-dashoffset, and never change a number
  (count-ups end on the exact text already in the page). Off for prefers-reduced-motion or the footer "Reduce motion" box (localStorage ev-rm).
  After reactbits.dev: Pill Nav, Blur Text, Count Up, Dot Grid, Spotlight, Fade Content, Animated List, Star Border, Lattice Loader. */
(function () {
 var D = document, H = D.documentElement, PAGE = D.body.getAttribute('data-page'), APP = PAGE === 'run' || PAGE === 'train';
 var EASE = 'cubic-bezier(0.22,1,0.36,1)', mq = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : null;
 var $ = function (s, r) { return (r || D).querySelector(s); }, $$ = function (s, r) { return Array.prototype.slice.call((r || D).querySelectorAll(s)); };
 var RM = function () { return H.classList.contains('rm'); }, started = false;
 function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { } return null; }
 var raf = function (fn) { return requestAnimationFrame(fn); };

 /* footer toggle */
 function toggle() {
  var t = $('#rm-toggle'); if (!t) return; t.checked = RM(); t.disabled = !!(mq && mq.matches);
  t.addEventListener('change', function () { ls('ev-rm', t.checked ? '1' : '0'); H.classList.toggle('rm', t.checked); if (!t.checked) start(); });
 }

 /* pill nav: sliding indicator */
 function nav() {
  var box = $('header.nav .links'); if (!box) return; var cur = $('a[aria-current=page]', box), ind = D.createElement('i'); ind.className = 'nav-ind'; ind.setAttribute('aria-hidden', 'true'); box.appendChild(ind); box.classList.add('mo-nav');
  function to(a, anim) {
   if (!a) { ind.style.opacity = 0; return; }
   if (!anim) ind.style.transition = 'none';
   ind.style.opacity = 1; ind.style.transform = 'translateX(' + (a.offsetLeft + 10) + 'px) scaleX(' + Math.max(1, a.offsetWidth - 20) / 100 + ')';
   if (!anim) { ind.offsetWidth; ind.style.transition = ''; }
  }
  to(cur, false);
  $$('a', box).forEach(function (a) { a.addEventListener('pointerenter', function () { to(a, true); }); a.addEventListener('focus', function () { to(a, true); }); a.addEventListener('blur', function () { to(cur, true); }); });
  box.addEventListener('pointerleave', function () { to(cur, true); });
  window.addEventListener('resize', function () { to(cur, false); });
  if (D.fonts && D.fonts.ready) D.fonts.ready.then(function () { to(cur, false); });
 }

 /* number helpers (count up ends on the original string) */
 function parse(s) { var m = /^([+−-]?)(\d[\d,]*)(?:\.(\d+))?([\s\S]*)$/.exec(String(s).trim()); if (!m) return null; return { sg: m[1], n: parseFloat(m[2].replace(/,/g, '') + (m[3] ? '.' + m[3] : '')), d: m[3] ? m[3].length : 0, c: m[2].indexOf(',') > -1, tail: m[4] }; }
 function fmt(p, v) { var t = v.toFixed(p.d); if (p.c) { var a = t.split('.'); a[0] = a[0].replace(/\B(?=(\d{3})+(?!\d))/g, ','); t = a.join('.'); } return p.sg + t + p.tail; }
 function count(el, final, onWrite) {
  var p = parse(final); if (!p || RM()) return; var tok = el._tok = (el._tok || 0) + 1, t0 = performance.now(), dur = 500;
  (function step(now) {
   if (el._tok !== tok) return; var u = Math.max(0, Math.min(1, (now - t0) / dur)), e = 1 - Math.pow(1 - u, 3);
   el.textContent = u < 1 ? fmt(p, p.n * e) : final; if (onWrite) onWrite(); if (u < 1) raf(step);
  })(t0);
 }
 function counters() {
  var els = $$('.hcard .hv'); if (els.length && 'IntersectionObserver' in window) {
   var io = new IntersectionObserver(function (es) { es.forEach(function (x) { if (x.isIntersecting && x.intersectionRatio >= .5) { io.unobserve(x.target); count(x.target, x.target.textContent); } }); }, { threshold: [.5] });
   els.forEach(function (e) { io.observe(e); });
  }
  var tv = $$('.tile .tv'); if (!tv.length || !window.MutationObserver) return;
  var mo = new MutationObserver(function (recs) {
   var seen = []; recs.forEach(function (r) { var el = r.target.nodeType === 3 ? r.target.parentNode : r.target; el = el && el.closest && el.closest('.tv'); if (el && seen.indexOf(el) < 0) seen.push(el); });
   seen.forEach(function (el) { var t = el.textContent, was = el._was; el._was = t; el._tok = (el._tok || 0) + 1; if (RM() || !el.offsetParent || !parse(t) || (was && parse(was))) return; count(el, t, function () { mo.takeRecords(); }); });
  });
  tv.forEach(function (el) { el._was = el.textContent; mo.observe(el, { childList: true, characterData: true, subtree: true }); });
 }

 /* blur text on the Home headline */
 function blur() {
  var h = PAGE === 'replay' && $('#h1'); if (!h || h._bt) return; h._bt = 1; var parts = h.textContent.split(/(\s+)/), i = 0; h.textContent = '';
  parts.forEach(function (w) { if (!w) return; if (/^\s+$/.test(w)) { h.appendChild(D.createTextNode(w)); return; } var s = D.createElement('span'); s.className = 'mo-bt'; s.style.setProperty('--i', i++); s.textContent = w; h.appendChild(s); });
 }

 /* spotlight card + border glow */
 function cards() {
  if (APP) return; var sel = '.hcard,.ov-card'; $$(sel).forEach(function (c) { c.classList.add('fx'); }); var pend = null;
  D.addEventListener('pointermove', function (e) {
   if (RM() || e.pointerType === 'touch') return; var c = e.target.closest && e.target.closest('.fx'); if (!c) return;
   if (pend) { pend.e = e; pend.c = c; return; } pend = { e: e, c: c };
   raf(function () { var r = pend.c.getBoundingClientRect(); pend.c.style.setProperty('--mx', (pend.e.clientX - r.left) + 'px'); pend.c.style.setProperty('--my', (pend.e.clientY - r.top) + 'px'); pend = null; });
  }, { passive: true });
 }

 /* fade content: sections and cards rise once when 15% visible; charts draw in after */
 function reveal() {
  if (APP || !('IntersectionObserver' in window)) return; var vh = innerHeight, list = $$('.home-sec,.ov-card,.page .stats').filter(function (e) { return e.getBoundingClientRect().top > vh * .85; });
  var io = new IntersectionObserver(function (es) {
   var k = 0; es.forEach(function (x) {
    if (!x.isIntersecting || (x.intersectionRatio < .15 && x.intersectionRect.height < 160)) return; io.unobserve(x.target); var e = x.target;
    e.style.transitionDelay = Math.min(k++, 3) * 60 + 'ms'; e.classList.add('mo-t'); e.classList.remove('mo-pre');
    setTimeout(function () { e.classList.remove('mo-t'); e.style.transitionDelay = ''; }, 900);
   });
  }, { threshold: [0, .01, .02, .03, .05, .08, .1, .12, .15] });
  list.forEach(function (e) { e.classList.add('mo-pre'); io.observe(e); });
  // safety net: anything still hidden that is on screen when scrolling stops (tall cards, jumps, smooth scroll) is shown at once
  var sw = function () { $$('.mo-pre').forEach(function (e) { var r = e.getBoundingClientRect(); if (r.top < innerHeight - 40 && r.bottom > 40) { io.unobserve(e); e.classList.remove('mo-pre'); } }); }, st = 0;
  addEventListener('scroll', function () { clearTimeout(st); st = setTimeout(sw, 180); }, { passive: true }); addEventListener('hashchange', function () { setTimeout(sw, 700); }); setTimeout(sw, 1500);
  var ch = $$('.ov-chart').filter(function (e) { return e.getBoundingClientRect().top > vh * .85; });
  var io2 = new IntersectionObserver(function (es) { es.forEach(function (x) { if (x.isIntersecting && (x.intersectionRatio >= .15 || x.intersectionRect.height >= 120)) { io2.unobserve(x.target); drawIn(x.target); } }); }, { threshold: [0, .01, .02, .03, .05, .08, .1, .12, .15] });
  ch.forEach(function (e) { e.classList.add('dr-pre'); io2.observe(e); });
 }
 function drawIn(c) {
  var svg = $('svg', c); if (!svg || RM()) { c.classList.remove('dr-pre'); return; }
  var ps = $$('path.ln', svg).filter(function (p) { return !p.hasAttribute('stroke-dasharray') && !/dash/.test(p.getAttribute('style') || ''); });
  var rs = $$('rect.ob,rect.ob2,rect.sgs', svg).filter(function (r) { return !(r.getAttribute('width') === '10' && r.getAttribute('height') === '10'); });
  var bot = rs.map(function (r) { return +r.getAttribute('y') + +r.getAttribute('height'); }), h0 = rs[0] && +rs[0].getAttribute('height');
  var vert = rs.length > 1 && bot.every(function (b) { return Math.abs(b - bot[0]) < 1.5; }) && rs.some(function (r) { return Math.abs(r.getAttribute('height') - h0) > 1; });
  ps.forEach(function (p) { var L = p.getTotalLength ? p.getTotalLength() : 0; p._L = L; p.style.transition = 'none'; p.style.strokeDasharray = L; p.style.strokeDashoffset = L; });
  rs.forEach(function (r) { r.style.transition = 'none'; r.style.transformBox = 'fill-box'; r.style.transformOrigin = vert ? '50% 100%' : '0 50%'; r.style.transform = vert ? 'scaleY(0)' : 'scaleX(0)'; });
  c.classList.remove('dr-pre'); svg.getBoundingClientRect();
  ps.forEach(function (p) { p.style.transition = 'stroke-dashoffset 600ms ' + EASE; p.style.strokeDashoffset = 0; });
  rs.forEach(function (r, i) { r.style.transition = 'transform 480ms ' + EASE + ' ' + Math.min(i, 5) * 50 + 'ms'; r.style.transform = 'none'; });
  setTimeout(function () { ps.concat(rs).forEach(function (e) { ['transition', 'stroke-dasharray', 'stroke-dashoffset', 'transform', 'transform-box', 'transform-origin'].forEach(function (k) { e.style.removeProperty(k); }); }); }, 1000);
 }

 /* dot grid behind the Home glass panels: dots near the cursor brighten (30 fps cap, paused when hidden/off-screen) */
 function dots() {
  var b = PAGE === 'replay' && $('.hero-band'); if (!b || $('.hero-dots') || RM()) return; var c = D.createElement('canvas'), bg = $('.hero-bg', b); c.className = 'hero-dots'; c.setAttribute('aria-hidden', 'true'); if (bg) bg.after(c); else b.prepend(c);
  var x = c.getContext('2d'), w = 0, h = 0, mx = -999, my = -999, s = 0, tgt = 0, vis = true, last = 0, run = 0, S = 24, R = 150;
  function size() { var r = b.getBoundingClientRect(), d = Math.min(2, devicePixelRatio || 1); w = r.width; h = r.height; c.width = Math.round(w * d); c.height = Math.round(h * d); x.setTransform(d, 0, 0, d, 0, 0); draw(); }
  function draw() {
   var cs = getComputedStyle(b), ac = cs.getPropertyValue('--accent').trim() || '#2dd4bf', tx = cs.getPropertyValue('--text3').trim() || '#888'; x.clearRect(0, 0, w, h);
   for (var py = S / 2; py < h; py += S) for (var px = S / 2; px < w; px += S) {
    var dx = px - mx, dy = py - my, f = Math.max(0, 1 - Math.sqrt(dx * dx + dy * dy) / R) * s; f *= f;
    x.globalAlpha = .22; x.fillStyle = tx; x.beginPath(); x.arc(px, py, 1, 0, 6.2832); x.fill();
    if (f > .02) { x.globalAlpha = Math.min(.9, f * 1.1); x.fillStyle = ac; x.beginPath(); x.arc(px, py, 1 + 1.6 * f, 0, 6.2832); x.fill(); }
   } x.globalAlpha = 1;
  }
  function tick(t) { run = 0; if (!vis || D.hidden || RM()) return; if (t - last >= 33) { last = t; s += (tgt - s) * .2; draw(); } if (tgt || s > .01) kick(); }
  function kick() { if (!run && vis && !D.hidden && !RM()) run = raf(tick); }
  b.addEventListener('pointermove', function (e) { var r = b.getBoundingClientRect(); mx = e.clientX - r.left; my = e.clientY - r.top; tgt = 1; kick(); }, { passive: true });
  b.addEventListener('pointerleave', function () { tgt = 0; kick(); });
  if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { vis = es[0].isIntersecting; kick(); }).observe(b);
  D.addEventListener('visibilitychange', kick); window.addEventListener('resize', size); size();
 }

 /* run / train details */
 function segs() {
  $$('.seg').forEach(function (s) {
   if (s._th) return; var th = D.createElement('i'); th.className = 'seg-th'; th.setAttribute('aria-hidden', 'true'); s.insertBefore(th, s.firstChild); s._th = th; s.classList.add('mo-sg');
   function pos(anim) {
    var i = s.querySelector('input:checked'), l = i && i.parentNode; if (!l || !l.offsetWidth) { s.classList.remove('mo-sg-on'); return; }
    if (!anim) th.style.transition = 'none'; th.style.height = l.offsetHeight + 'px'; th.style.top = l.offsetTop + 'px'; th.style.transform = 'translateX(' + l.offsetLeft + 'px) scaleX(' + l.offsetWidth / 100 + ')';
    s.classList.add('mo-sg-on'); if (!anim) { th.offsetWidth; th.style.transition = ''; } s._i = l;
   }
   s.addEventListener('change', function () { pos(true); }); if (window.ResizeObserver) new ResizeObserver(function () { pos(false); }).observe(s);
   setInterval(function () { var i = s.querySelector('input:checked'); if (i && i.parentNode !== s._i && s.offsetWidth) pos(true); }, 400); pos(false);
  });
 }
 function appFx() {
  D.addEventListener('change', function (e) { var t = e.target; if (RM() || !t || t.type !== 'checkbox' || !t.animate || !t.closest('.rail,.check')) return; t.animate([{ transform: 'scale(1)' }, { transform: 'scale(.72)', offset: .3 }, { transform: 'scale(1.18)', offset: .6 }, { transform: 'scale(1)' }], { duration: 320, easing: EASE }); });
  [['chip', 'run'], ['tchip', 'train']].forEach(function (p) {
   var chip = D.getElementById(p[0]), btn = D.getElementById(p[1]); if (!chip) return;
   var lat = D.createElement('span'); lat.className = 'lat'; lat.setAttribute('aria-hidden', 'true'); lat.innerHTML = '<b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b><b></b>'; chip.insertBefore(lat, chip.firstChild);
   function sync() { var st = chip.getAttribute('data-s'); if (btn) btn.classList.toggle('star', st === 'running' || (st === 'loading' && btn.disabled && !/^Loading engine/.test(chip.textContent))); }
   new MutationObserver(sync).observe(chip, { attributes: true, subtree: true, characterData: true, childList: true }); sync();
  });
  var list = D.getElementById('proc-st'); if (list && window.MutationObserver) new MutationObserver(function (recs) {
   if (RM()) return; var k = 0; recs.forEach(function (r) { r.addedNodes.forEach(function (n) { if (n.nodeType === 1 && n.animate) n.animate([{ opacity: 0, transform: 'translateX(-10px)' }, { opacity: 1, transform: 'none' }], { duration: 260, delay: Math.min(k++, 8) * 45, easing: EASE, fill: 'backwards' }); }); });
  }).observe(list, { childList: true });
 }

 /* overview rail: progress line fills between chapter numbers */
 function rail() {
  var ol = $('.ov-rail ol'); if (!ol) return; var as = $$('a', ol), cs = $$('.ov-card'), N = as.length; if (N < 2 || cs.length !== N) return; var tk = 0;
  function set() {
   var ys = as.map(function (a) { return a.offsetTop + a.offsetHeight / 2; }), vh = innerHeight * .35, i = 0;
   for (var k = 0; k < N; k++) if (cs[k].getBoundingClientRect().top <= vh) i = k;
   var t0 = cs[i].getBoundingClientRect().top, t1 = i < N - 1 ? cs[i + 1].getBoundingClientRect().top : t0 + cs[i].offsetHeight, f = Math.max(0, Math.min(1, (vh - t0) / Math.max(1, t1 - t0)));
   var y = i < N - 1 ? ys[i] + f * (ys[i + 1] - ys[i]) : ys[N - 1], L = ys[N - 1] - ys[0];
   ol.style.setProperty('--y0', ys[0] + 'px'); ol.style.setProperty('--len', L + 'px'); ol.style.setProperty('--p', L > 0 ? Math.max(0, (y - ys[0]) / L).toFixed(4) : 0);
  }
  window.addEventListener('scroll', function () { if (!tk) tk = raf(function () { tk = 0; set(); }); }, { passive: true }); window.addEventListener('resize', set); set();
  if (D.fonts && D.fonts.ready) D.fonts.ready.then(set);
 }

 function start() { if (started || RM()) return; started = true; blur(); counters(); cards(); reveal(); dots(); if (APP) appFx(); }
 toggle(); nav(); segs(); rail(); if (!RM()) start();
})();
