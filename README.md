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
- Every change that ships MUST bump both:
  - `APP_VERSION` in `assets/js/app.js`
  - `VERSION` in `service-worker.js` (format `wb-X.Y.Z`)
- Also bump query strings in `index.html` for `app.js` and `styles.css`.
- CI stamps `service-worker.js` with build id to force SW updates every deploy.

Firebase (optional)
- Add a secret `FIREBASE_CONFIG_JSON` (a full Firebase config JSON) to inject `assets/js/firebase.js` on deploy.
- Enable Google Sign-In in Firebase Auth for the “Sign in with Google” button to function.
- Without a config, the app gracefully disables sign-in and uses localStorage for settings.

Development
- Site files live at repo root (`index.html`, `assets/**`, `service-worker.js`).
- Prebuilt CSS lives in `assets/css/styles.css`; do not depend on building Tailwind in CI.
- CSV parser drops the trailing totals row.
- Ingest replaces previous data; no deduplication is applied.

