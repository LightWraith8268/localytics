// Initializes Firebase if a local firebase.js config file is present.
// This keeps credentials out of git: firebase.js is gitignored.

const VERSION = '10.12.2';
const APP_URL = `https://www.gstatic.com/firebasejs/${VERSION}/firebase-app.js`;
const FIRESTORE_URL = `https://www.gstatic.com/firebasejs/${VERSION}/firebase-firestore.js`;
const ANALYTICS_URL = `https://www.gstatic.com/firebasejs/${VERSION}/firebase-analytics.js`;
const APPCHECK_URL = `https://www.gstatic.com/firebasejs/${VERSION}/firebase-app-check.js`;

let config;
try {
  // Dynamic import to avoid breaking the page if the file doesn't exist.
  const cfg = await import('./firebase.js');
  config = cfg.default || cfg.firebaseConfig || cfg;
} catch (e) {
  console.warn('[firebase-init] No firebase.js found. Create one from assets/js/firebase.example.js');
}

function isValidConfig(c) {
  if (!c || typeof c !== 'object') return false;
  const required = ['apiKey','projectId','appId'];
  for (const k of required) {
    if (!c[k] || typeof c[k] !== 'string') return false;
    if (/YOUR_/.test(c[k])) return false; // placeholder
  }
  return true;
}

if (isValidConfig(config)) {
  try {
    const { initializeApp } = await import(APP_URL);
    const { getFirestore, collection, addDoc, serverTimestamp } = await import(FIRESTORE_URL);

    const app = initializeApp(config);

    // Optional: App Check via reCAPTCHA v3/Enterprise
    try {
      const siteKey = window.FB_APPCHECK_SITE_KEY || document.querySelector('meta[name="appcheck-site-key"]')?.content;
      if (siteKey) {
        const { initializeAppCheck, ReCaptchaV3Provider } = await import(APPCHECK_URL);
        initializeAppCheck(app, { provider: new ReCaptchaV3Provider(siteKey), isTokenAutoRefreshEnabled: true });
        console.log('[firebase-init] App Check initialized');
      }
    } catch (e) { console.warn('[firebase-init] App Check init skipped:', e?.message || e); }
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

    // Optional pageview logging - disabled by default to avoid permission errors
    // Enable by setting window.FB_ENABLE_PAGEVIEW_LOGGING = true
    if (window.FB_ENABLE_PAGEVIEW_LOGGING) {
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
    }

    // Expose for other scripts if needed
    window.firebaseDb = db;
  } catch (err) {
    console.warn('[firebase-init] Error initializing Firebase:', err);
  }
} else {
  if (config) {
    console.warn('[firebase-init] Skipping Firebase init: invalid config (missing projectId/apiKey/appId or placeholders present).');
  } else {
    console.warn('[firebase-init] No config present; Firebase disabled.');
  }
  try { window.__firebaseDisabled = true; } catch {}
}

