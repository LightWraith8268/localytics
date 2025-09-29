/* Workbox-based Service Worker with update flow */
/* global workbox */
importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.5.4/workbox-sw.js');

const VERSION = 'wb-1.2.41';
const PRECACHE = [
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
  './assets/js/sample-data.js'
].map(url => ({ url, revision: VERSION }));

// Precache core assets
workbox.precaching.precacheAndRoute(PRECACHE);

// Ensure the SW file itself is never cached by the SW (always fetch network)
workbox.routing.registerRoute(
  ({url}) => url.origin === self.location.origin && url.pathname.endsWith('service-worker.js'),
  new workbox.strategies.NetworkOnly()
);

// Runtime caching for same-origin scripts/styles/images (excluding the SW file)
workbox.routing.registerRoute(
  ({request, url}) => url.origin === self.location.origin && !url.pathname.endsWith('service-worker.js') && ['script','style','image','font'].includes(request.destination),
  new workbox.strategies.StaleWhileRevalidate({ cacheName: 'assets' })
);

// Runtime caching for cross-origin (CDNs): network-first with fallback
// Exclude Firebase domains to prevent interference with Firestore/Auth
workbox.routing.registerRoute(
  ({url}) => {
    const isFirebase = url.hostname.includes('googleapis.com') ||
                      url.hostname.includes('firebaseapp.com') ||
                      url.hostname.includes('firebase.googleapis.com') ||
                      url.hostname.includes('firestore.googleapis.com') ||
                      url.hostname.includes('identitytoolkit.googleapis.com');
    return url.origin !== self.location.origin && !isFirebase;
  },
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
// and query the SW version to gate update UI
self.addEventListener('message', (event) => {
  try {
    const data = event.data || {};
    if (data.type === 'SKIP_WAITING') {
      self.skipWaiting();
      return;
    }
    if (data.type === 'GET_VERSION') {
      // Reply via MessageChannel, if provided
      const port = event.ports && event.ports[0];
      if (port) {
        port.postMessage({ type: 'VERSION', version: VERSION });
      }
      return;
    }
  } catch (e) {
    // no-op
  }
});

// Take control as soon as activated
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
