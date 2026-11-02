/* Install page worker: lets the phone companion open offline. Pages and strings: network first, falling back to the
 * copy kept from the last visit. downloads.json is never served from the cache while online (the version must be fresh). */
const CACHE = 'bja-install-9dde50ec67';
self.addEventListener('install', (e) => { self.skipWaiting(); });
self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('bja-install-') && k !== CACHE) await caches.delete(k);
  await self.clients.claim();
})()));
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin || /\.zip$/.test(req.url)) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) { const c = await caches.open(CACHE); c.put(req, res.clone()); }
      return res;
    } catch { const hit = await caches.match(req, { ignoreSearch: true }); if (hit) return hit; throw new Error('offline'); }
  })());
});
