// Offline support: app files are fetched network-first (so new deploys show up right away)
// and fall back to the cache when offline; Google Fonts are served cache-first.
// Bump VERSION on each deploy to drop old caches.
const VERSION = 'wf-v4';
const SHELL = ['./', './index.html', './app.js', './config.js', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // fonts and the version-pinned supabase-js bundle never change, so they are cache-first
  const isFont = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com' || url.hostname === 'cdn.jsdelivr.net';
  if (url.origin !== location.origin && !isFont) return;
  e.respondWith(caches.open(VERSION).then(async cache => {
    if (isFont) {
      const hit = await cache.match(req);
      // an opaque (no-cors) copy cannot answer a CORS/SRI request, so refetch in that case
      if (hit && !(hit.type === 'opaque' && req.mode === 'cors')) return hit;
      const res = await fetch(req);
      cache.put(req, res.clone());
      return res;
    }
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch (_) {
      return (await cache.match(req, { ignoreSearch: true })) || (req.mode === 'navigate' ? cache.match('./index.html') : Response.error());
    }
  }));
});
