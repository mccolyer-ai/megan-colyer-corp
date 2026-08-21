// Minimal service worker — makes the portal installable as an app and
// keeps the last-seen version of each page available briefly offline.
// Deal data itself is always fetched fresh over the network (never cached),
// so buyers never see stale listings.
const CACHE_NAME = 'mc-portal-v1';
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/buyers.html',
  '/offer.html',
  '/owner.html',
  '/logo.png',
  '/icon-192.png',
  '/icon-512.png',
  '/manifest.json'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache API calls to the Apps Script backend — always live data.
  if (url.hostname.includes('script.google.com') || url.hostname.includes('script.googleusercontent.com')) {
    return;
  }

  if (event.request.method !== 'GET') return;

  // Network-first for HTML so buyers always get the latest deals/copy;
  // fall back to cache only if offline.
  if (event.request.mode === 'navigate' || event.request.destination === 'document') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for static assets (images, manifest, icons).
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
