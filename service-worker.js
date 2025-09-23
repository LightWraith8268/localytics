/* Simple PWA Service Worker for QR Reports */
const VERSION = 'pwa-v1.0.0';
const CORE = [
  './',
  './index.html',
  './404.html',
  './manifest.webmanifest',
  './assets/icons/icon.svg',
  './assets/js/app.js',
  './assets/js/csv.js',
  './assets/js/reports.js',
  './assets/js/ui.js',
  './assets/js/storage.js',
  './assets/js/firebase-init.js',
  './assets/js/firebase.js',
  './assets/js/sample-data.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(VERSION).then(cache => cache.addAll(CORE.map(url => new Request(url, { cache: 'reload' }))))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Network strategies:
// - HTML navigation: cache-first fallback to index (SPA offline)
// - Same-origin assets: stale-while-revalidate
// - Cross-origin (CDNs): network-first with cache fallback
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle GET
  if (req.method !== 'GET') return;

  // Navigation requests → serve cached index for offline
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        return net;
      } catch {
        const cache = await caches.open(VERSION);
        const cached = await cache.match('./index.html');
        return cached || Response.error();
      }
    })());
    return;
  }

  // Same-origin assets
  if (url.origin === location.origin) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const cached = await cache.match(req);
      const fetchAndCache = fetch(req).then((res) => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => cached);
      return cached || fetchAndCache;
    })());
    return;
  }

  // Cross-origin (CDNs)
  event.respondWith((async () => {
    try {
      const net = await fetch(req);
      const cache = await caches.open(VERSION);
      if (net && net.ok) cache.put(req, net.clone());
      return net;
    } catch {
      const cache = await caches.open(VERSION);
      const cached = await cache.match(req);
      return cached || Response.error();
    }
  })());
});
