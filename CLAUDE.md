# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Localytics is a lightweight, Progressive Web App (PWA) for CSV analytics that runs entirely on GitHub Pages. It provides revenue, quantity and trend analysis with print-friendly layouts and multi-theme support. The application is built with vanilla JavaScript ES6 modules and uses Workbox for service worker functionality.

## Architecture

This is a static web application with no build process dependencies. The codebase follows a modular ES6 structure:

### Core Structure
- **Static hosting**: All files live at repo root for GitHub Pages deployment
- **PWA**: Complete Progressive Web App with service worker, manifest, and update notifications
- **Modular JS**: ES6 modules organized by functional area
- **CSS**: Pre-built Tailwind CSS (`assets/css/styles.css`) - no build step required
- **Themes**: CSS custom properties with 11+ theme variants (dark, sepia, ocean, forest, etc.)

### Key Directories
```
/                          # Root contains all deployable files
├── assets/
│   ├── css/styles.css     # Pre-built Tailwind CSS (committed)
│   ├── js/                # ES6 modules
│   │   ├── app.js         # Main application state and routing
│   │   ├── csv.js         # CSV parsing and column detection
│   │   ├── reports.js     # Data aggregation and analytics
│   │   ├── ui.js          # DOM manipulation and chart rendering
│   │   ├── storage.js     # Firebase integration and localStorage
│   │   └── firebase.js    # Injected by CI (Firebase config)
│   └── icons/
├── index.html             # Single-page application entry point
├── service-worker.js      # Workbox PWA service worker
└── manifest.webmanifest  # PWA manifest
```

### Module Responsibilities
- **app.js**: Application state, routing (`#/upload`, `#/reports`, etc.), initialization
- **csv.js**: File parsing, column detection, data transformation
- **reports.js**: Business logic for aggregations (by date, item, client, category, etc.)
- **ui.js**: Chart.js integration, table rendering, export functions (CSV/Excel)
- **storage.js**: Firebase Authentication, report persistence, localStorage fallback

## Development Workflow

### No Build Process
- **CSS**: Use the committed `assets/css/styles.css` (pre-built Tailwind). If you add new utility classes to HTML, manually update this file.
- **JavaScript**: Direct ES6 modules, no transpilation or bundling
- **Dependencies**: Chart.js and Firebase loaded via CDN (see `index.html`)

### Version Management
**CRITICAL**: CI automatically bumps versions on every deploy:
- `APP_VERSION` in `assets/js/app.js`
- `VERSION` in `service-worker.js` (prefixed with `wb-`)
- Query strings in `index.html` for cache-busting

When developing locally, you can manually bump versions, but CI will override them for deployed artifacts.

### Firebase Configuration
- **Optional**: App works without Firebase (uses localStorage)
- **CI Integration**: `FIREBASE_CONFIG_JSON` secret injects `assets/js/firebase.js`
- **Auth**: Google Sign-In for report persistence across devices

### PWA Update Flow
The app implements proper PWA update UX:
- Service worker registers with version query string for cache-busting
- Shows update toast when new version is available
- User clicks "Update" → triggers `skipWaiting()` → page reload
- **Important**: Don't remove the update checks (focus/visibility/interval handlers)

## Data Processing Rules

### CSV Parsing
- **Totals Row**: Always drop the trailing totals row from uploaded CSVs
- **No Deduplication**: Each CSV upload replaces the current in-memory dataset completely
- **Missing Data**: Text fields → `undefined`, numeric fields → `0`
- **Multi-file**: Supports multiple CSV uploads that get concatenated

### Column Mapping
The app auto-detects and maps CSV columns to internal fields:
- Date, Item, Quantity, Price, Cost, Revenue, Category, Order, Client, Staff
- Smart detection handles common column name variations

## CI/CD Pipeline

### GitHub Actions Workflows
- **`.github/workflows/pages.yml`**: Main deployment to GitHub Pages
- **`.github/workflows/gh-pages.yml`**: Fallback deployment workflow
- **`.github/workflows/version-check.yml`**: Version validation

### Deployment Process
1. Validates Firebase configuration secret
2. Injects Firebase config into `assets/js/firebase.js`
3. Auto-bumps versions with build timestamp
4. Stamps service worker with commit SHA for forced updates
5. Copies static files to `dist/` directory
6. Deploys to GitHub Pages

## Agent Notes Integration

Key guidance from `AGENTS.md`:
- **Versioning**: CI controls version bumping - manual changes get overwritten
- **CSS**: No Tailwind build in CI - must update pre-built `styles.css` manually
- **CSV**: Drop totals row, no deduplication on ingest
- **PWA**: Maintain update detection mechanisms

## Theme System

The application supports 11+ themes using CSS custom properties:
- Light (default), Dark, Sepia, Ocean, Forest, Rose, Slate, Contrast
- Solarized Light/Dark, Dracula, Nord
- All themes defined in `index.html` `<style>` block using CSS variables