# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Localytics is a lightweight, Progressive Web App (PWA) for CSV analytics that runs entirely on GitHub Pages with no build dependencies. It provides comprehensive revenue, quantity, and trend analysis with dedicated pages for Reports, Trends, Analytics, Orders, Clients, Staff, and Items tracking. The application features print-friendly layouts, multi-theme support (11+ themes), and optional Firebase integration for cloud sync. Built with vanilla JavaScript ES6 modules and Workbox service worker.

## Architecture

Static web application with no build process. All code runs directly in the browser with ES6 modules and pre-built CSS.

### Core Structure
- **Static hosting**: All files at repo root for GitHub Pages deployment
- **PWA**: Complete Progressive Web App with service worker, manifest, update notifications
- **Modular ES6**: Functional separation without bundling or transpilation
- **CSS**: Pre-built Tailwind (committed to `assets/css/styles.css`) - no build step
- **Themes**: CSS custom properties with 11+ theme variants
- **Storage**: Firebase + localStorage hybrid (Firebase optional)

### Directory Structure
```
/                              # All deployable files at root
├── assets/
│   ├── css/styles.css         # Pre-built Tailwind (committed, 20.5 KB)
│   ├── js/
│   │   ├── app.js             # Main state, routing (300 KB)
│   │   ├── csv.js             # CSV parsing (6.2 KB)
│   │   ├── reports.js         # Analytics engine (14 KB)
│   │   ├── ui.js              # DOM & charting (31 KB)
│   │   ├── storage.js         # Firebase & localStorage (21 KB)
│   │   ├── version.js         # Version loader (1.5 KB)
│   │   ├── firebase.js        # Firebase config (injected by CI)
│   │   ├── firebase-init.js   # Firebase helpers (3.4 KB)
│   │   ├── allowed-items.js   # Item whitelist (991 bytes)
│   │   └── sample-data.js     # Sample dataset (649 bytes)
│   └── icons/icon.svg         # PWA icon (maskable)
├── index.html                 # Single-page app entry (100 KB)
├── service-worker.js          # Workbox PWA (2.4 KB)
├── manifest.webmanifest       # PWA manifest
├── version.json               # Centralized version (SOURCE OF TRUTH)
├── update-version.js          # Version bumping script
└── .github/workflows/         # CI/CD automation
```

### Module Responsibilities

**app.js** (300 KB - Main Application State)
- Hash-based routing: `#/upload`, `#/reports`, `#/trends`, `#/analytics`, `#/orders`, `#/clients`, `#/staff`, `#/items`, `#/history`, `#/settings`
- Application state: rows, headers, mapping, filters, charts, user auth
- CSV data ingestion and normalization
- Filter management and chart references
- Raw data inspector (first 200 rows for debugging)
- Constants: `RAW_HOUR_OFFSET = -6` (GMT to local business hours), `RAW_INSPECTOR_ROW_LIMIT = 200`

**csv.js** (6.2 KB - CSV Processing)
- File parsing with Papa Parse (worker: false to prevent "p1 is not defined" error)
- Column auto-detection: date, item, qty, price, cost, revenue, category, order, client, staff
- Always removes final row (totals) - this is hardcoded behavior
- Multi-file concatenation support
- Progress reporting for large uploads
- Comprehensive debug logging

**reports.js** (14 KB - Analytics Engine)
- Data aggregation: by date, item, client, category, order, staff
- Revenue, cost, profit calculations with margin percentages
- Rolling averages: 30-day, YoY, MoM
- Day-of-week and hour-of-day breakdowns
- Category trends over time
- Date format: `YYYY-MM-DD` (ISO, sorts correctly)

**ui.js** (31 KB - DOM & Charting)
- Table rendering (static and sortable)
- Chart.js integration (line, bar, stacked bar)
- Canvas guards: Checks DOM existence before rendering to prevent crashes
- Export: CSV and Excel (SheetJS)
- Navigation active state: `.nav-link.active` CSS class
- Chart zoom modal functionality

**storage.js** (21 KB - Firebase & localStorage)
- Firebase Authentication: Google Sign-In
- Firestore database operations
- localStorage fallback (automatic on Firebase failure)
- CSV chunking: 250 rows per Firestore document (1MB limit)
- Data sanitization: undefined→null, Date→ISO, NaN→null for Firestore
- Hydration: null→undefined when loading
- User settings and report persistence

**version.js** (1.5 KB - Version Management)
- Loads from `version.json` (source of truth)
- Distributes to UI, service worker
- Fallback: "1.18.26", timestamp "20251005"
- Formats for service worker: "wb-{version}-{timestamp}"

## Development Workflow

### Version Management (CRITICAL)

**Single Source of Truth**: `version.json`
```json
{
  "version": "1.18.26",
  "timestamp": "20251005"
}
```

**Manual Version Update During Development**:
```bash
node update-version.js 1.2.59
```
This updates:
- `version.json` (new version + ISO timestamp)
- Fallback strings in `version.js`
- Fallback strings in `service-worker.js`

**CI Auto-Bumping on Deploy**:
- CI generates build ID from UTC date + run number
- Overwrites manual changes in deployed artifact
- Stamps `service-worker.js` with build SHA (forces cache update)
- Updates HTML cache-busting query strings

**Important**: CI wins - manual version bumps are development-only.

### CSS Management

**Pre-built Tailwind** (`assets/css/styles.css`, 20.5 KB)
- Committed to repo (no build step in CI)
- If adding new HTML classes:
  1. Add class to HTML template
  2. Manually add CSS rule to `assets/css/styles.css`
  3. Test in browser
- Verify committed size stays reasonable

### Local Development

**No build process required**:
```bash
# Serve from root directory
python -m http.server 8000

# Or use any HTTP server
cd D:\Coding\Localytics
npx http-server
```
- Service worker registers automatically
- ES6 modules load directly
- Updates check in background

### Firebase Configuration (Optional)

**Without Firebase**: Uses localStorage only (no sign-in feature)

**With Firebase**: CI injects `assets/js/firebase.js` from GitHub secret
- Secret name: `FIREBASE_CONFIG_JSON`
- Format: Full Firebase config JSON
- Rejected if contains placeholder values (e.g., "YOUR_")
- Required fields: apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId

**Critical Firebase Setup**:
1. Create Firestore project
2. Enable Google Sign-In in Firebase Auth
3. Add security rules from `FIREBASE_RULES.md` (csvChunks subcollection MUST have explicit rules)
4. Set `FIREBASE_CONFIG_JSON` secret in GitHub
5. Deploy - CI will inject config

See `FIREBASE_RULES.md` for exact security rules (csvChunks rules are critical).

### PWA Update Flow

**Important**: Maintain update detection mechanisms (don't remove checks)
1. Service worker registers with version query string
2. Page listens for update availability
3. Shows toast when update available
4. User clicks "Update" → `skipWaiting()` → page reload

Browser focus/visibility/interval checks trigger updates. Do not remove these handlers.

## Data Processing

### CSV Parsing Pipeline

**Papa Parse Configuration**:
```javascript
{
  header: true,
  skipEmptyLines: true,
  worker: false  // CRITICAL - prevents "p1 is not defined" error
}
```

**Processing Steps**:
1. Parse file with Papa Parse
2. Auto-detect columns (date, item, qty, price, cost, revenue, category, order, client, staff)
3. **Always remove final row** (typically contains totals) - hardcoded behavior
4. Filter empty rows (missing item/product name)
5. Support multiple file concatenation
6. Each upload replaces in-memory dataset (no deduplication)

**Missing Data Handling**:
- Text fields: `undefined`
- Numeric fields: `0`

**Column Detection Strategy**: Searches headers for keywords
- **Date**: "date", "time", "timestamp"
- **Item**: "item", "product", "title", "service"
- **Quantity**: "qty", "units", "quantity", "amount"
- **Price**: "price", "rate", "cost_per"
- **Cost**: "cost", "expense"
- **Revenue**: "revenue", "sales"
- **Category**: "category", "type", "group"
- **Order**: "order", "order_id"
- **Client**: "client", "customer", "buyer"
- **Staff**: "staff", "employee", "seller"

### Data Normalization (app.js)

After parsing, each row gets normalized fields:
- `__item`: Canonicalized name (with category mapping applied)
- `__quantity`: Normalized quantity (number)
- `__revenue`: Calculated/normalized revenue
- `__cost`: Calculated/normalized cost
- `__dateRaw`: Original date string from CSV
- `__hour`: Parsed hour (with -6 GMT offset for business hours)
- `__hourRaw`: Raw parsed hour
- `__category`: Applied category from mapping

**Hour Offset**: -6 hours (converts GMT-1 source to GMT-7 business time)

### Number Formatting

All numeric output uses 2 decimal places minimum:
```javascript
new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
}).format(value)
```

### Report Structure (reports.js)

```javascript
{
  totals: {
    totalQuantity, totalRevenue, totalCost,
    totalProfit, marginPct, distinctItems, totalOrders
  },
  byItem: [],              // Sorted by revenue (desc)
  byDate: [],              // ISO format, chronological
  byCategory: [],          // Aggregated metrics
  byOrder: [],             // With line items
  byClient: [],            // With order summaries
  byStaff: [],             // With performance metrics
  rollingAverage30: [],    // 30-day rolling revenue
  revenueMoM: [],          // Month-over-month
  revenueYoY: [],          // Year-over-year
  dowBreakdown: {},        // Day-of-week analytics
  hourlyRevenue: {}        // Hour-of-day breakdown
}
```

## Storage Architecture

### Firestore (Optional, Firebase-enabled only)

**Collections**:
- `/userData/{userId}` - Metadata document
- `/userData/{userId}/csvChunks/{chunkId}` - CSV chunks (250 rows each)
- `/userSettings/{userId}` - User preferences
- `/reports/{userId}/{reportId}` - Saved report snapshots

**Critical**: csvChunks subcollection REQUIRES explicit Firestore rules:
```javascript
match /csvChunks/{chunkId} {
  allow read, write: if request.auth != null && request.auth.uid == userId;
}
```
Without this, users get "Missing or insufficient permissions" error. Parent rules don't inherit to subcollections.

### localStorage (Fallback, Always Available)

- Automatic fallback when Firebase unavailable
- Same data structure as Firestore
- No size enforcement in code (browser quota applies)
- Higher performance for development/offline

### Hybrid Storage Strategy

1. Try Firebase first (if configured & authenticated)
2. Fall back to localStorage on failure
3. Always hydrate from localStorage on load (for performance)
4. Save to both simultaneously
5. Sanitize for Firestore: `undefined→null`, `Date→ISO string`, `NaN→null`

## CI/CD Pipeline

### GitHub Actions Workflows

**pages.yml** (Main Deployment):
1. Checkout code
2. Setup Node 20
3. Validate Firebase secret (fails if missing when required)
4. Inject Firebase config from secret
5. Update cache-busting query strings (reads version.json)
6. Stamp service worker with build ID + timestamp
7. Verify versions match
8. Deploy to GitHub Pages

**version-check.yml** (Version Validation):
- Enforces version bumps when app files change
- Validates version format (semantic: x.y.z)
- Prevents deployment without version increment

**gh-pages.yml** (Fallback Deployment):
- Alternative GitHub Pages deployment

### Key Points

- CSS pre-built (no Tailwind build in CI)
- Firebase config injected from secret (optional)
- Version auto-bumped with UTC date + run number
- Service worker stamped with build ID (forces cache clear)
- HTML cache-busting query strings auto-updated

## Theme System

**11+ CSS Custom Property Themes** defined in `index.html` `<style>` block:
- Light (default), Dark, Sepia, Ocean, Forest, Rose
- Slate, Contrast, Solarized Light/Dark, Dracula, Nord

**CSS Variables per Theme**:
- `--text-color` (primary text)
- `--bg-color` (primary background)
- `--card-bg` (card background)
- `--border-color` (borders)
- `--hover-bg` (hover states)

**Dark Mode Persistence**:
- localStorage for immediate access
- User settings for cross-device sync
- Detected via `prefers-color-scheme` media query

## Navigation & UI

### Page Structure

| Page | Route | Purpose |
|------|-------|---------|
| Upload | `#/upload` | CSV file processing with drag-and-drop |
| Reports | `#/reports` | Main analytics dashboard |
| Trends | `#/trends` | Time-series and trend analysis |
| Analytics | `#/analytics` | Advanced analytics views |
| Orders | `#/orders` | Order tracking and summaries |
| Clients | `#/clients` | Client performance tracking |
| Staff | `#/staff` | Staff performance metrics |
| Items | `#/items` | Product/service item tracking |
| History | `#/history` | Saved reports management |
| Settings | `#/settings` | User preferences and Firebase config |

### Navigation State Management

- Active link highlight: `.nav-link.active` with green background (#10B981)
- Updated via `setActiveNav(hash)` in `ui.js` on route change
- Both mobile and desktop sidebars maintain consistent state

## PWA & Service Worker

### service-worker.js (Workbox)

**Caching Strategies**:
| Route | Strategy | Cache | Notes |
|-------|----------|-------|-------|
| `service-worker.js` | NetworkOnly | - | Always fresh |
| App assets | NetworkFirst | assets | 5s timeout |
| CDN resources | NetworkFirst | cdn | 3s timeout |
| Navigation/HTML | NetworkFirst | pages | 10s timeout |

**Firebase Domain Exclusions** (never cached):
- googleapis.com
- firebaseapp.com
- firebase.googleapis.com
- firestore.googleapis.com
- identitytoolkit.googleapis.com

### manifest.webmanifest (PWA Manifest)
- Name/short name: "Localytics"
- Start URL: "./"
- Display: "standalone"
- Theme color: "#2563eb"
- Icon: maskable SVG

## Common Development Tasks

### Add New Analytic View
1. Add route handler in `app.js`
2. Create computation in `reports.js` if needed
3. Add rendering function in `ui.js`
4. Add navigation link to `index.html`
5. Add CSS classes to `styles.css` if needed

### Add New CSV Column Type
1. Add keyword detection in `csv.js` `detectColumns()`
2. Add normalization in `app.js` (if needed)
3. Update report calculations in `reports.js`
4. Add UI display in relevant `ui.js` function

### Debug CSV Parsing
- Check console logs (prefixed `[csv]`)
- Use Raw Data Inspector page (`#/settings`)
- Inspect first 200 rows with normalized fields (`__item`, `__hour`, etc.)
- Check missing hour data summary

### Test Firebase Integration Locally
- Set `FIREBASE_CONFIG_JSON` environment variable (local development)
- Or manually create `assets/js/firebase.js` from `firebase.example.js`
- Sign in with Google
- Monitor Firestore in Firebase Console
- Check browser DevTools → Application → Service Workers for service worker logs

### Optimize Bundle Size
- Keep prebuilt CSS reasonable (~20 KB target)
- Don't add external dependencies (use CDN only)
- Monitor app.js size (currently 300 KB - mainly state)
- Use tree-shaking if refactoring modules

## Recent Technical Notes

### CSV Processing Pipeline
- Fixed Papa Parse worker error by disabling worker mode
- Comprehensive debug logging throughout pipeline
- Null safety checks for all DOM elements

### Storage Architecture
- Hybrid storage handles Firestore 1MB document limits
- CSV chunking: 250 rows per Firestore document
- localStorage fallback for performance
- Automatic hydration on page load

### Chart Rendering
- Canvas guards prevent crashes on hidden views
- Pre-size hidden canvases before rendering
- Force post-render resizes for zoom modal
- Hour-of-day charts fall back to full-day ranges when empty

### Version & Update Flow
- Centralized version in `version.json`
- All modules pull from single source
- CI auto-bumps on every deploy
- Service worker force-update via query string stamp

## Related Documentation

- `README.md` - Project overview
- `AGENTS.md` - Development history and notes
- `FIREBASE_RULES.md` - Critical Firestore security configuration
- `FIREBASE_TESTING.md` - Firebase integration testing guide
