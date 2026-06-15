/**
 * ECHO service worker — caches the built app for offline / installable play.
 *
 * Strategy:
 *  - Precache the app shell on install.
 *  - Runtime cache (stale-while-revalidate) for same-origin GET requests so
 *    Vite's content-hashed JS/CSS are cached the first time they're fetched.
 */
const CACHE = 'echo-v1';
const SCOPE = self.registration.scope; // e.g. https://perdido101.github.io/echo/

const SHELL = [SCOPE, SCOPE + 'index.html', SCOPE + 'manifest.json', SCOPE + 'icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      // Serve cache immediately if present, refresh in the background.
      return cached || network;
    }),
  );
});
