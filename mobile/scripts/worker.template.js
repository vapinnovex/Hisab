/* global __CACHE_NAME__, __ASSET_PATHS__ */
// Generated with an exact, versioned allowlist. Never cache API responses or user data.
const CACHE = __CACHE_NAME__;
const ASSETS = __ASSET_PATHS__;
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(ASSETS.map((path) => new Request(path, { cache: 'reload' })))),
  );
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await Promise.all(
        (await caches.keys())
          .filter((key) => key.startsWith('hishob-shell-') && key !== CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    event.request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname === '/api'
  )
    return;
  const path = event.request.mode === 'navigate' ? '/index.html' : url.pathname;
  if (!ASSETS.includes(path)) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => (await cache.match(path)) || fetch(event.request)),
  );
});
