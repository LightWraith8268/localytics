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

---
2025-09-30 - Status Check
- APP_VERSION in assets/js/app.js remains 1.2.41; service-worker.js VERSION is wb-1.2.41.
- index.html currently links ./assets/css/styles.css and ./assets/js/app.js without query string parameters.
- git status shows working tree changes in .claude/settings.local.json and assets/js/app.js (additional logging around normalization flow).
---
2025-09-30 - CSV Persistence & Filters
- Added DEFAULT_FILTERS and reset logic in assets/js/app.js to prevent stale filters from hiding newly parsed rows.
- Persisted full CSV datasets in Firestore via chunked documents and hydrate/delete helpers in assets/js/storage.js.
---
2025-09-30 - Category Mapping Modal
- Replaced inline category editor with a modal supporting CSV uploads, paste import, and row management.
- Added category mapping summary, export button, and auto-reset of filters that hide parsed rows.
---
2025-09-30 - Guarded Charts & Version 1.2.43
- Added canvas/context guards in assets/js/ui.js to stop chart rendering crashes when DOM nodes are missing during restore.
- Hardened bulk category import to normalise newline variants before splitting.
- Bumped app/service worker/index.html to version 1.2.43 to ensure fresh assets deploy.
---
2025-09-30 - Tracking Views & Precision (v1.2.44)
- Added Orders, Clients, Staff, and Items tracking pages with richer summaries and tables.
- Ensured all numeric outputs render with two decimal places, including totals and aggregated metrics.
- Sorted date tables by most recent first and expanded order details with per-item breakdowns.

---
2025-10-04 - Hourly Revenue Fallback & Repo Status
- App version loads from `version.json` (currently 1.18.4 / timestamp 20251005); service worker fallback string set to `wb-1.18.4-20251005`.
- `index.html` defers to dynamic cache-busting for `assets/js/app.js` and `assets/css/styles.css` once the version module resolves.
- Working tree currently has local edits in `assets/js/app.js` to improve hourly revenue aggregation.
- Revenue-by-hour charts now parse 24-hour timestamps and fall back to full-day ranges when business-hour buckets are empty, preventing empty visualizations.
- Normalisation preserves raw date/time and item strings so saved datasets keep category mappings and hour-of-day insights after reloads.
- Added broader time format parsing (`HHMM`, stray AM/PM tokens) and console sampling for rows missing hour data to help diagnose uploads that omit a time component.
- Chart helpers now pre-size hidden canvases and force post-render resizes so hour-of-day charts render consistently and zoom modal cloning works even when views were hidden on initial draw.
- Desktop layout locks the body scroll and routes independent overflow to `.layout-main` and `.sidebar-scroll`, keeping the sidebar scrollable with hidden scrollbars as originally designed.
- Settings now include a Raw Data Inspector card that lists the first 200 stored rows (with `__dateRaw`, `__hour`, etc.) and highlights records missing hour data for quick timestamp debugging.
