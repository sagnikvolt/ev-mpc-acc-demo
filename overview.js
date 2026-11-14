'use strict';
/* Overview page: chapter stepper (rail, Previous/Next, arrow keys, scroll spy) and the small charts.
   Chart data is embedded as JSON (#ov-data) by build_site.py / build_overview.py from the project's result files; nothing is typed here.
   All chapters stay in the page (scrolling, search and print work without this script); this file only adds navigation and draws the charts at real width. */
(function () {
  const $ = id => document.getElementById(id), D = $('ov-data') ? JSON.parse($('ov-data').textContent) : {};
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const fmt = (v, d) => (v < 0 ? '−' : '') + Math.abs(v).toFixed(d);
  const svg = (W, H, label, inner) => `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="group" aria-label="${esc(label)}">${inner}</svg>`;
  const ticksOf = (max, step) => { const t = []; for (let v = 0; v <= max + 1e-9; v += step) t.push(+v.toFixed(6)); return t; };
  const tdec = step => (step >= 1 ? 0 : step >= 0.1 ? 1 : 2);

  /* horizontal bars: label above each bar, value after it (works from 280 px up) */
  function hbar(el, c) {
    const W = Math.max(260, Math.floor(el.clientWidth)), padR = 76, rh = 42, top = 4, L = 0, X = v => L + v / c.max * (W - L - padR);
    const H = top + c.rows.length * rh + 24; let g = '';
    ticksOf(c.max, c.step).forEach((t, k) => { g += `<line class="grid-h" x1="${X(t)}" x2="${X(t)}" y1="${top}" y2="${H - 20}"/>`; if (W >= 420 || k % 2 === 0) g += `<text x="${X(t)}" y="${H - 6}" text-anchor="${t === 0 ? 'start' : 'middle'}">${t.toFixed(tdec(c.step))}${c.unit && c.unit.trim() === '%' ? '%' : ''}</text>`; });
    c.rows.forEach((r, i) => {
      const y = top + i * rh, w = Math.max(2, X(r.v) - X(0)), tip = `${r.l}: ${fmt(r.v, c.dec)}${c.unit || ''}` + (r.sd != null ? ` (spread between folds ±${r.sd.toFixed(2)})` : '');
      g += `<g class="ob-row" tabindex="0" role="img" aria-label="${esc(tip)}"><title>${esc(tip)}</title><text x="0" y="${y + 13}" class="ob-l${r.cls === 'ours' ? ' acc' : ''}">${esc(r.l)}</text><rect class="ob${r.cls === 'ours' ? ' ob-acc' : ''}" x="${X(0)}" y="${y + 19}" width="${w.toFixed(1)}" height="12" rx="2"/>`;
      let end = X(r.v);
      if (c.whisk && r.sd) { const a = X(Math.max(0, r.v - r.sd)), b = X(r.v + r.sd), yy = y + 25; g += `<path class="wh" d="M${a} ${yy}H${b}M${a} ${yy - 4}V${yy + 4}M${b} ${yy - 4}V${yy + 4}"/>`; end = b; }
      g += `<text x="${end + 8}" y="${y + 29}" class="ob-v">${fmt(r.v, c.dec)}${c.unit || ''}</text></g>`;
    });
    el.innerHTML = svg(W, H, el.getAttribute('aria-label') || '', g);
  }

  /* one range bar on an axis */
  function range(el, c) {
    const W = Math.max(260, Math.floor(el.clientWidth)), m = { l: 10, r: 14 }, X = v => m.l + v / c.max * (W - m.l - m.r), H = 78; let g = '';
    for (const t of ticksOf(c.max, c.step)) g += `<line class="grid-h" x1="${X(t)}" x2="${X(t)}" y1="22" y2="52"/><text x="${X(t)}" y="68" text-anchor="${t === 0 ? 'start' : t === c.max ? 'end' : 'middle'}">${t}${c.unit}</text>`;
    const tip = `${c.label}: ${c.lo}${c.unit} to ${c.hi}${c.unit}`;
    g += `<g tabindex="0" role="img" aria-label="${esc(tip)}"><title>${esc(tip)}</title><rect class="ob" x="${X(c.lo)}" y="28" width="${X(c.hi) - X(c.lo)}" height="18" rx="3"/><text x="${X(c.lo)}" y="18" text-anchor="middle" class="ob-v">${c.lo}${c.unit}</text><text x="${X(c.hi)}" y="18" text-anchor="middle" class="ob-v">${c.hi}${c.unit}</text></g>`;
    el.innerHTML = svg(W, H, el.getAttribute('aria-label') || '', g);
  }

  /* stacked horizontal bars (two segments) with a legend */
  function stack(el, c) {
    const W = Math.max(260, Math.floor(el.clientWidth)), padR = 44, rh = 40, top = 26, X = v => v / c.max * (W - padR);
    const H = top + c.rows.length * rh + 22; let g = `<rect class="ob" x="0" y="2" width="10" height="10" rx="2"/><text x="16" y="11" class="ob-l">${esc(c.names[0])}</text><rect class="ob2" x="${W < 420 ? 0 : 130}" y="${W < 420 ? 16 : 2}" width="10" height="10" rx="2"/><text x="${(W < 420 ? 0 : 130) + 16}" y="${W < 420 ? 25 : 11}" class="ob-l">${esc(c.names[1])}</text>`;
    const t0 = W < 420 ? top + 10 : top;
    for (const t of ticksOf(c.max, c.step)) g += `<line class="grid-h" x1="${X(t)}" x2="${X(t)}" y1="${t0}" y2="${t0 + c.rows.length * rh}"/><text x="${X(t)}" y="${t0 + c.rows.length * rh + 14}" text-anchor="${t === 0 ? 'start' : 'middle'}">${t}</text>`;
    c.rows.forEach((r, i) => {
      const y = t0 + i * rh, tip = `${r.l}: ${r.a} test windows, ${r.b} tuning windows, ${r.a + r.b} in all`;
      g += `<g class="ob-row" tabindex="0" role="img" aria-label="${esc(tip)}"><title>${esc(tip)}</title><text x="0" y="${y + 13}" class="ob-l">${esc(r.l)}</text>`;
      if (r.a) g += `<rect class="ob" x="0" y="${y + 19}" width="${X(r.a)}" height="12" rx="2"/>`;
      if (r.b) g += `<rect class="ob2" x="${X(r.a)}" y="${y + 19}" width="${X(r.b)}" height="12" rx="2"/>`;
      g += `<text x="${X(r.a + r.b) + 8}" y="${y + 29}" class="ob-v">${r.a + r.b}</text></g>`;
    });
    el.innerHTML = svg(W, t0 + c.rows.length * rh + 22, el.getAttribute('aria-label') || '', g);
  }

  /* grouped vertical bars */
  function group(el, c) {
    const W = Math.max(260, Math.floor(el.clientWidth)), H = 230, m = { l: 8, r: 8, t: 44, b: 28 }, ph = H - m.t - m.b, gw = (W - m.l - m.r) / c.groups.length, bw = Math.min(46, gw / 3.2);
    const Y = v => m.t + ph - v / c.max * ph; let g = '';
    const narrow = W < 420, ly = narrow ? [11, 27] : [11, 11], lx = narrow ? [0, 0] : [0, Math.min(150, W / 2)];
    c.series.forEach((s, k) => { g += `<rect class="${k ? 'ob2' : 'ob'}" x="${lx[k]}" y="${ly[k] - 9}" width="10" height="10" rx="2"/><text x="${lx[k] + 16}" y="${ly[k]}" class="ob-l">${esc(s.n)}</text>`; });
    for (const t of ticksOf(c.max, 10)) g += `<line class="grid-h" x1="${m.l}" x2="${W - m.r}" y1="${Y(t)}" y2="${Y(t)}"/><text x="${W - m.r}" y="${Y(t) - 3}" text-anchor="end">${t}</text>`;
    c.groups.forEach((gl, i) => {
      const cx = m.l + gw * (i + 0.5);
      c.series.forEach((s, k) => {
        const v = s.v[i], x = cx + (k - 0.5) * (bw + 4) - (k ? 0 : 0) - bw / 2 + bw / 2 * 0, h = Math.max(2, ph * v / c.max), tip = `${gl}, ${s.n}: ${v} unsafe windows of 160`;
        g += `<g class="ob-row" tabindex="0" role="img" aria-label="${esc(tip)}"><title>${esc(tip)}</title><rect class="${k ? 'ob2' : 'ob'}" x="${(cx + (k - 1) * (bw + 4) + 2).toFixed(1)}" y="${(m.t + ph - h).toFixed(1)}" width="${bw}" height="${h.toFixed(1)}" rx="2"/><text x="${(cx + (k - 1) * (bw + 4) + 2 + bw / 2).toFixed(1)}" y="${(m.t + ph - h - 5).toFixed(1)}" text-anchor="middle" class="ob-v">${v}</text></g>`;
      });
      g += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${esc(gl)}</text>`;
    });
    el.innerHTML = svg(W, H, el.getAttribute('aria-label') || '', g);
  }

  const R = { hbar, range, stack, group }, charts = [];
  Object.keys(D).forEach(k => { const el = $('ov-' + k.replace(/^c/, 'c')), c = D[k]; if (el && R[c.type]) charts.push([el, c, 0]); });
  const draw = () => charts.forEach(t => { const w = Math.floor(t[0].clientWidth); if (w && w !== t[2]) { t[2] = w; R[t[1].type](t[0], t[1]); } });
  draw(); let tm = 0; window.addEventListener('resize', () => { clearTimeout(tm); tm = setTimeout(draw, 120); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { charts.forEach(t => t[2] = 0); draw(); });

  /* ---------------- stepper ---------------- */
  const cards = [...document.querySelectorAll('.ov-card')], links = [...document.querySelectorAll('.ov-rail ol a')], N = cards.length;
  if (!N) return;
  const pos = $('ov-pos'), pt = $('ov-pt'), prev = $('ov-prev'), next = $('ov-next'); let cur = 0;
  const set = i => {
    cur = i; links.forEach((a, j) => { if (j === i) a.setAttribute('aria-current', 'step'); else a.removeAttribute('aria-current'); a.classList.toggle('done', j < i); });
    pos.textContent = (i + 1) + ' of ' + N; pt.textContent = cards[i].querySelector('h2').textContent.length > 0 ? links[i].querySelector('.t').textContent : '';
    prev.disabled = i === 0; next.disabled = i === N - 1;
  };
  const navEl = document.querySelector('header.nav'), railEl = document.querySelector('.ov-rail');
  const offset = () => { const nh = navEl ? navEl.offsetHeight : 56, mob = railEl && window.innerWidth < 960; return nh + (mob ? railEl.offsetHeight : 0) + 12; };
  const setVars = () => { const nh = navEl ? navEl.offsetHeight : 56; document.documentElement.style.setProperty('--navh', nh + 'px'); document.documentElement.style.setProperty('--ovtop', offset() + 'px'); };
  setVars(); window.addEventListener('resize', setVars); if (document.fonts && document.fonts.ready) document.fonts.ready.then(setVars);
  const spy = () => {
    const line = offset() + (window.innerHeight - offset()) * 0.25; let k = 0;
    cards.forEach((c, i) => { if (c.getBoundingClientRect().top <= line) k = i; });
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) k = N - 1;
    if (k !== cur) set(k);
  };
  let tick = false; window.addEventListener('scroll', () => { if (!tick) { tick = true; requestAnimationFrame(() => { tick = false; spy(); }); } }, { passive: true });
  const go = (i, focus) => {
    i = Math.max(0, Math.min(N - 1, i)); const c = cards[i]; set(i);
    window.scrollTo({ top: window.scrollY + c.getBoundingClientRect().top - offset(), behavior: matchMedia('(prefers-reduced-motion:reduce)').matches ? 'auto' : 'smooth' });
    if (history.replaceState) history.replaceState(null, '', '#ch-' + (i + 1));
    if (focus) c.querySelector('h2').focus({ preventScroll: true });
  };
  links.forEach((a, i) => a.addEventListener('click', ev => { ev.preventDefault(); go(i, true); }));
  prev.addEventListener('click', () => go(cur - 1, true)); next.addEventListener('click', () => go(cur + 1, true));
  document.addEventListener('keydown', ev => {
    if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.defaultPrevented) return;
    const t = ev.target, tag = t && t.tagName, inRail = t && t.closest && t.closest('.ov-rail ol');
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable) || document.querySelector('dialog[open]')) return;
    if (ev.key === 'ArrowRight' || (inRail && ev.key === 'ArrowDown')) { ev.preventDefault(); go(cur + 1, !!inRail); if (inRail) links[Math.min(N - 1, cur)].focus(); }
    else if (ev.key === 'ArrowLeft' || (inRail && ev.key === 'ArrowUp')) { ev.preventDefault(); go(cur - 1, !!inRail); if (inRail) links[Math.max(0, cur)].focus(); }
  });
  const m = /^#ch-(\d+)$/.exec(location.hash); set(m ? Math.min(N - 1, +m[1] - 1) : 0); spy();

  /* print: open every details block, restore afterwards */
  const dets = [...document.querySelectorAll('details.ov-det')]; let was = [];
  window.addEventListener('beforeprint', () => { was = dets.map(d => d.open); dets.forEach(d => d.open = true); charts.forEach(t => t[2] = 0); draw(); });
  window.addEventListener('afterprint', () => dets.forEach((d, i) => d.open = was[i]));
})();
