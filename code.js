'use strict';
/* /code/ page: lazy file browser with a small built-in highlighter. Uses common.js ($). */
/* ---------------- Code section: file browser with a small built-in highlighter ---------------- */
(function () {
  const root = $('cv'); if (!root) return; const V = root.dataset.v, btns = [...root.querySelectorAll('.cv-f')], body = $('cv-body'), cache = {}; let cur = null, copyT = 0;
  const KW = {
    python: 'and as assert break class continue def del elif else except finally for from global if import in is lambda None nonlocal not or pass raise return try while with yield True False',
    matlab: 'break case catch classdef continue else elseif end for function global if otherwise parfor persistent return switch try while true false',
    js: 'async await break case catch class const continue default delete do else export finally for from function if import in instanceof let new null of return switch this throw true false try typeof undefined var void while yield'
  };
  const esc = x => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  function tokenize(src, lang) {
    const kw = new Set(KW[lang].split(' ')), out = [], n = src.length, isId = c => c !== undefined && /[A-Za-z0-9_]/.test(c), NUM = /(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y, ID = /[A-Za-z_]\w*/y; let i = 0, plain = '';
    const flush = () => { if (plain) { out.push(['', plain]); plain = ''; } }, push = (c, t) => { flush(); out.push([c, t]); }, eol = j => { const k = src.indexOf('\n', j); return k < 0 ? n : k; };
    while (i < n) {
      const ch = src[i], prev = src[i - 1];
      if ((lang === 'python' && ch === '#') || (lang === 'matlab' && (ch === '%' || src.startsWith('...', i))) || (lang === 'js' && src.startsWith('//', i))) { const j = eol(i); push('c', src.slice(i, j)); i = j; continue; }
      if (lang === 'js' && src.startsWith('/*', i)) { let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2; push('c', src.slice(i, j)); i = j; continue; }
      if (lang === 'python' && (src.startsWith('"""', i) || src.startsWith("'''", i))) { const q = src.substr(i, 3); let j = src.indexOf(q, i + 3); j = j < 0 ? n : j + 3; push('s', src.slice(i, j)); i = j; continue; }
      if (ch === '"' || (ch === "'" && !(lang === 'matlab' && (isId(prev) || ')]}.\''.includes(prev || ' ')))) || (lang === 'js' && ch === '`')) {
        let j = i + 1; const multi = lang === 'js' && ch === '`';
        while (j < n) { const c = src[j]; if (c === '\n' && !multi) break; if (lang !== 'matlab' && c === '\\') { j += 2; continue; } if (c === ch) { if (lang === 'matlab' && src[j + 1] === ch) { j += 2; continue; } j++; break; } j++; }
        push('s', src.slice(i, j)); i = j; continue;
      }
      if (!isId(prev) && (/\d/.test(ch) || (ch === '.' && /\d/.test(src[i + 1] || '')))) { NUM.lastIndex = i; const m = NUM.exec(src); if (m) { push('n', m[0]); i += m[0].length; continue; } }
      if (/[A-Za-z_]/.test(ch)) { ID.lastIndex = i; const m = ID.exec(src)[0]; if (kw.has(m)) push('k', m); else plain += m; i += m.length; continue; }
      plain += ch; i++;
    }
    flush(); return out;
  }
  function highlight(src, lang) {
    const lines = ['']; tokenize(src, lang).forEach(([c, t]) => { t.split('\n').forEach((piece, k) => { if (k) lines.push(''); if (piece) lines[lines.length - 1] += c ? `<span class="tk-${c}">${esc(piece)}</span>` : esc(piece); }); });
    if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop(); return lines;
  }
  async function open(btn) {
    const path = btn.dataset.path, name = btn.dataset.name; cur = btn; btns.forEach(b => b.setAttribute('aria-current', b === btn ? 'true' : 'false'));
    $('cv-fn').textContent = name; $('cv-meta').textContent = `${btn.dataset.lines} lines, ${(+btn.dataset.bytes / 1024).toFixed(1)} KB`; $('cv-desc').textContent = btn.dataset.desc; $('cv-copy').disabled = $('cv-dl').disabled = true;
    body.setAttribute('aria-label', 'Source of ' + name); body.setAttribute('aria-busy', 'true');
    try {
      if (cache[path] === undefined) { body.innerHTML = '<div class="cv-empty">Loading...</div>'; const r = await fetch('/' + path + '?v=' + V); if (!r.ok) throw new Error(r.status); cache[path] = await r.text(); }
      if (cur !== btn) return; const lines = highlight(cache[path], btn.dataset.lang);
      body.innerHTML = `<div class="cv-in"><div class="cv-gut" aria-hidden="true">${lines.map((_, i) => i + 1).join('\n')}</div><pre class="cv-code"><code>${lines.join('\n')}</code></pre></div>`; body.scrollTop = 0; body.scrollLeft = 0; $('cv-copy').disabled = $('cv-dl').disabled = false;
    } catch (e) { if (cur === btn) body.innerHTML = '<div class="cv-empty err">Could not load this file. Open it in the repository instead.</div>'; }
    body.removeAttribute('aria-busy');
  }
  btns.forEach((b, i) => { b.setAttribute('aria-current', 'false'); b.onclick = () => open(b); b.onkeydown = e => { const j = e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowUp' ? i - 1 : -1; if (j >= 0 && j < btns.length) { e.preventDefault(); btns[j].focus(); } }; });
  $('cv-copy').onclick = async () => {
    const t = cache[cur.dataset.path]; if (t === undefined) return; try { await navigator.clipboard.writeText(t); } catch (e) { const ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e2) {} ta.remove(); }
    $('cv-copy').textContent = 'Copied'; clearTimeout(copyT); copyT = setTimeout(() => { $('cv-copy').textContent = 'Copy'; }, 1600);
  };
  $('cv-dl').onclick = () => { const t = cache[cur.dataset.path]; if (t === undefined) return; const u = URL.createObjectURL(new Blob([t], { type: 'text/plain;charset=utf-8' })), a = document.createElement('a'); a.href = u; a.download = cur.dataset.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000); };
  if (btns.length && 'IntersectionObserver' in window) { const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); if (!cur) open(btns[0]); } }, { rootMargin: '200px' }); io.observe(root); }
})();


