'use strict';
/* Service worker for the opt-in offline engine cache (Round m). It is registered only after a visitor ticks the box and presses "Keep it", and it is removed by "Remove" (rail of Run it / Train it, or About).
   Cache Storage only: no cookies, nothing is sent anywhere. Two caches:
   ev-pyodide-<version>  the Python runtime and its packages from jsDelivr (pinned version, so it is kept when the site is updated)
   ev-site-<VER>         our own files that carry ?v=<VER> (worker.js, py/*, data/*, scripts, styles) and the HTML pages
   Rules: jsDelivr Pyodide files and our ?v= files are cache-first (a new VER is a new key, and old ev-site-* caches are deleted when the new worker activates);
   HTML pages are network-first, with the cached copy used only when the network fails. */
const VER = new URL(self.location.href).searchParams.get('v') || '0', PYV = 'v314.0.7';
const C_PY = 'ev-pyodide-' + PYV, C_SITE = 'ev-site-' + VER;
self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('ev-') && k !== C_PY && k !== C_SITE) await caches.delete(k);
  await self.clients.claim();
})()));
const good = r => r && r.status === 200 && (r.type === 'basic' || r.type === 'cors');
async function cacheFirst(name, req) {
  const c = await caches.open(name), hit = await c.match(req); if (hit) return hit;
  const r = await fetch(req); if (good(r)) { try { await c.put(req, r.clone()); } catch (e) { /* quota: serve anyway */ } } return r;
}
async function networkFirst(name, req) {
  const c = await caches.open(name);
  try { const r = await fetch(req); if (good(r)) { try { await c.put(req, r.clone()); } catch (e) { } } return r; }
  catch (err) { const hit = await c.match(req, { ignoreSearch: true }); if (hit) return hit; throw err; }
}
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET' || r.headers.has('range')) return; const u = new URL(r.url);
  if (u.origin === 'https://cdn.jsdelivr.net' && u.pathname.startsWith('/pyodide/' + PYV + '/')) { e.respondWith(cacheFirst(C_PY, r)); return; }
  if (u.origin !== self.location.origin) return;
  if (r.mode === 'navigate' || r.destination === 'document') { e.respondWith(networkFirst(C_SITE, r)); return; }
  if (u.searchParams.has('v')) e.respondWith(cacheFirst(C_SITE, r));
});
