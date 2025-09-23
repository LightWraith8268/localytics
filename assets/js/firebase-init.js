// Initializes Firebase if a local firebase.js config file is present.
// This keeps credentials out of git: firebase.js is gitignored.

const VERSION = '10.12.2';
const APP_URL = `https://www.gstatic.com/firebasejs/${VERSION}/firebase-app.js`;
const FIRESTORE_URL = `https://www.gstatic.com/firebasejs/${VERSION}/firebase-firestore.js`;
const ANALYTICS_URL = `https://www.gstatic.com/firebasejs/${VERSION}/firebase-analytics.js`;

let config;
try {
  // Dynamic import to avoid breaking the page if the file doesn't exist.
  const cfg = await import('./firebase.js');
  config = cfg.default || cfg.firebaseConfig || cfg;
} catch (e) {
  console.warn('[firebase-init] No firebase.js found. Create one from assets/js/firebase.example.js');
}

if (config) {
  try {
    const { initializeApp } = await import(APP_URL);
    const { getFirestore, collection, addDoc, serverTimestamp } = await import(FIRESTORE_URL);

    const app = initializeApp(config);
    const db = getFirestore(app);

    // Optional: Analytics, only if measurementId present and supported
    if (config.measurementId) {
      try {
        const { getAnalytics, isSupported } = await import(ANALYTICS_URL);
        if (await isSupported()) {
          getAnalytics(app);
          console.log('[firebase-init] Analytics initialized');
        }
      } catch (err) {
        console.warn('[firebase-init] Analytics not initialized:', err);
      }
    }

    // Minimal example: log a pageview
    try {
      await addDoc(collection(db, 'pageviews'), {
        path: location.pathname + location.search,
        ts: serverTimestamp(),
        userAgent: navigator.userAgent
      });
      console.log('[firebase-init] Logged pageview');
    } catch (err) {
      console.warn('[firebase-init] Failed to log pageview:', err);
    }

    // Expose for other scripts if needed
    window.firebaseDb = db;
  } catch (err) {
    console.warn('[firebase-init] Error initializing Firebase:', err);
  }
}
