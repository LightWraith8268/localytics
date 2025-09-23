Localytics
==========

Localytics is a lightweight, printable, PWA-based CSV analytics dashboard for revenue, quantity and trends. It runs entirely on GitHub Pages.

Highlights
- CSV upload (multi-file), automatic column detection
- Aggregates by Item/Date/Client/Staff/Category/Order
- Trends: rolling averages, MoM/YoY, DOW/hour, category stacks
- Export CSV/Excel, print-friendly layouts
- Themes: light/dark/sepia
- PWA with Workbox, update toast (no manual refresh)
- Optional Firebase for report storage (via repo secret)

Versioning Policy (Important)
- CI auto-bumps the app version on every deploy. The deploy workflow writes a unique build version (UTC date + run number) to:
  - `APP_VERSION` in `assets/js/app.js`
  - `VERSION` in `service-worker.js` (format `wb-...`)
  - `index.html` query strings for `app.js` and `styles.css`
- You can bump versions manually while developing; CI will override them for the deployed artifact.
- CI also stamps `service-worker.js` with the build id to force SW updates each deploy.

Firebase (optional)
- Add a secret `FIREBASE_CONFIG_JSON` (a full Firebase config JSON) to inject `assets/js/firebase.js` on deploy.
- Enable Google Sign-In in Firebase Auth for the “Sign in with Google” button to function.
- Without a config, the app gracefully disables sign-in and uses localStorage for settings.

Development
- Site files live at repo root (`index.html`, `assets/**`, `service-worker.js`).
- Prebuilt CSS lives in `assets/css/styles.css`; do not depend on building Tailwind in CI.
- CSV parser drops the trailing totals row.
- Ingest replaces previous data; no deduplication is applied.
