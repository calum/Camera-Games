// Offline copy of the game for the hosted site (GitHub Pages). Registered by src/main.js over HTTPS only.
//
//  - The big MediaPipe files (vendor/, models/) never change for a given version: served from the cache
//    first, so the game starts fast and works with no internet.
//  - Everything else (the page, the game code, art) is fetched fresh when online, so an update reaches
//    families straight away, and falls back to the cached copy when offline.
// Bump VERSION when the files in vendor/ or models/ are replaced.
const VERSION = 'v1';
const BIG = `kcg-big-${VERSION}`;
const CODE = 'kcg-code';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CODE).then((c) => c.addAll(['./', 'index.html', 'manifest.webmanifest'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('kcg-big-') && k !== BIG).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  const big = /\/(vendor|models)\//.test(url.pathname);
  e.respondWith(big ? cacheFirst(e.request) : networkFirst(e.request));
});

async function cacheFirst(req) {
  const cache = await caches.open(BIG);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(CODE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}
