Localytics Agent Notes

Scope: Entire repository

Versioning Policy
- Every user-visible change (feature, fix, copy, styles, CI tweaks that impact the shipped app) MUST bump both:
  - UI `APP_VERSION` in `assets/js/app.js`
  - SW `VERSION` in `service-worker.js` (prefix `wb-`)
- `index.html` query strings for `app.js` and `styles.css` MUST be updated to the new version.
- The CI workflow stamps `service-worker.js` with the build ID to guarantee SW script changes on each deploy.

PWA Update UX
- The app registers Workbox with `?v=APP_VERSION`, checks for updates immediately, and shows a toast when an update is waiting. Clicking Update triggers `skipWaiting()` and reloads.
- Do not remove the update checks (focus/visibility/interval).

Styling / Build
- We vendor `assets/css/styles.css` (prebuilt). CI must not rely on Tailwind building at deploy time. If you change utility classes in HTML, remember to update the prebuilt CSS.

CSV Parsing
- Always drop the trailing totals row.
- Do NOT dedupe on ingest. Each CSV upload replaces the current in-memory dataset.
- Missing text fields set to `undefined`; missing numeric fields set to `0`.

