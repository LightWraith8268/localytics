/* Workbox-based Service Worker with update flow */
/* global workbox */
importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.5.4/workbox-sw.js');

const VERSION = 'wb-1.2.3';
const PRECACHE = [
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
].map(url => ({ url, revision: VERSION }));

// Precache core assets
workbox.precaching.precacheAndRoute(PRECACHE);

// Runtime caching for same-origin scripts/styles/images
workbox.routing.registerRoute(
  ({request, url}) => url.origin === self.location.origin && ['script','style','image','font'].includes(request.destination),
  new workbox.strategies.StaleWhileRevalidate({ cacheName: 'assets' })
);

// Runtime caching for cross-origin (CDNs): network-first with fallback
workbox.routing.registerRoute(
  ({url}) => url.origin !== self.location.origin,
  new workbox.strategies.NetworkFirst({
    cacheName: 'cdn',
    networkTimeoutSeconds: 3,
    plugins: [ new workbox.expiration.ExpirationPlugin({ maxEntries: 100, purgeOnQuotaError: true }) ]
  })
);

// Navigation requests: try network first, fall back to cached index
workbox.routing.registerRoute(
  ({request}) => request.mode === 'navigate',
  async ({event}) => {
    try {
      return await workbox.strategies.networkFirst({ cacheName: 'pages' }).handle({event});
    } catch (e) {
      return await caches.match('./index.html');
    }
  }
);

// Allow the page to trigger skipWaiting (used by update button)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Take control as soon as activated
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
