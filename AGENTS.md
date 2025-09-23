Localytics Agent Notes

Scope: Entire repository

Versioning Policy
- CI auto-bumps version on every deploy. During the Pages and gh-pages workflows a unique build version is generated (UTC date + run number) and written to:
  - UI `APP_VERSION` in `assets/js/app.js`
  - SW `VERSION` in `service-worker.js` (prefix `wb-`)
  - `index.html` query strings for `app.js` and `styles.css`
- You may still bump versions manually when developing locally; CI will overwrite them for the deployed artifact.
- CI also stamps `service-worker.js` with the build ID to guarantee a script change on each deploy.

PWA Update UX
- The app registers Workbox with `?v=APP_VERSION`, checks for updates immediately, and shows a toast when an update is waiting. Clicking Update triggers `skipWaiting()` and reloads.
- Do not remove the update checks (focus/visibility/interval).

Styling / Build
- We vendor `assets/css/styles.css` (prebuilt). CI must not rely on Tailwind building at deploy time. If you change utility classes in HTML, remember to update the prebuilt CSS.

CSV Parsing
- Always drop the trailing totals row.
- Do NOT dedupe on ingest. Each CSV upload replaces the current in-memory dataset.
- Missing text fields set to `undefined`; missing numeric fields set to `0`.
