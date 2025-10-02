/* Workbox-based Service Worker with update flow */
/* global workbox */
importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.5.4/workbox-sw.js');

// Load version from centralized config
let VERSION = 'wb-1.12.13-20251002'; // fallback

// Load version from JSON config
fetch('./version.json')
  .then(response => response.json())
  .then(config => {
    VERSION = `wb-${config.version}-${config.timestamp}`;
  })
  .catch(() => {
    // Keep fallback version if fetch fails
  });

// No precaching - always fetch fresh content from network

// Ensure the SW file itself is never cached by the SW (always fetch network)
workbox.routing.registerRoute(
  ({url}) => url.origin === self.location.origin && url.pathname.endsWith('service-worker.js'),
  new workbox.strategies.NetworkOnly()
);

// Always fetch latest version of app assets (network-first)
workbox.routing.registerRoute(
  ({request, url}) => url.origin === self.location.origin && !url.pathname.endsWith('service-worker.js') && ['script','style','image','font'].includes(request.destination),
  new workbox.strategies.NetworkFirst({
    cacheName: 'assets',
    networkTimeoutSeconds: 5,
    plugins: [
      new workbox.cacheableResponse.CacheableResponsePlugin({
        statuses: [0, 200]
      })
    ]
  })
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

// Navigation requests: always try network first for latest content
workbox.routing.registerRoute(
  ({request}) => request.mode === 'navigate',
  new workbox.strategies.NetworkFirst({
    cacheName: 'pages',
    networkTimeoutSeconds: 10,
    plugins: [
      new workbox.cacheableResponse.CacheableResponsePlugin({
        statuses: [0, 200]
      })
    ]
  })
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

// Force immediate activation and skip waiting
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Take control as soon as activated and clear all caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // Clear all caches to ensure fresh content
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => caches.delete(cacheName))
        );
      }),
      // Take control of all clients
      self.clients.claim()
    ])
  );
});
