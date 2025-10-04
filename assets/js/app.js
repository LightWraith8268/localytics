import { parseCsv, detectColumns, parseCsvFiles } from './csv.js';
import { computeReport, aggregateCustom, aggregateByGranularity, aggregateByCategoryOverTime, aggregateByField, aggregateByOrder, round2 } from './reports.js';
import { renderTotals, renderTable, renderSortableTable, makeChart, makeBarChart, makeChartTyped, makeStackedBarChart, downloadCsv, setActiveNav, exportExcelBook, enableChartZoom } from './ui.js';
import { saveReport, listReports, loadReport, deleteReport, observeAuth, signInWithGoogle, signOutUser, loadUserSettings, saveUserSettings, saveCsvData, loadCsvData, deleteCsvData, deleteAllUserData, testFirebaseSettings } from './storage.js';
import { SAMPLE_ROWS } from './sample-data.js';
import { ALLOWED_ITEMS } from './allowed-items.js';

// APP_VERSION is now set by the centralized version system in version.js
const DEFAULT_FILTERS = {
  start: '',
  end: '',
  item: '',
  client: '',
  staff: '',
  order: '',
  category: '',
  revMin: '',
  revMax: '',
  qtyMin: '',
  qtyMax: '',
  noZero: false,
};

// Simplified filters for Trends and Analytics pages (staff-only)
const SIMPLE_DEFAULT_FILTERS = {
  staff: '',
};

const state = {
  rows: [],
  headers: [],
  mapping: { date: '', item: '', qty: '', price: '', cost: '', revenue: '', category: '', order: '', client: '', staff: '' },
  report: null,
  chart: null,
  chartRevenue: null,
  chartQty: null,
  chartTop: null,
  chartTopItems: null,
  chartTopClients: null,
  chartCatShare: null,
  chartOrders: null,
  chartRevRolling: null,
  chartRevMoM: null,
  chartProfit: null,
  chartMargin: null,
  chartAov: null,
  chartIpo: null,
  chartQtyRolling: null,
  chartRevRolling30: null,
  chartDowRevenue: null,
  chartHourRevenue: null,
  chartRevYoy: null,
  chartCatTrend: null,
  filters: { ...DEFAULT_FILTERS },
  trendsFilters: { ...DEFAULT_FILTERS },
  trendsFilteredRows: null,
  analyticsFilters: { ...DEFAULT_FILTERS },
  analyticsFilteredRows: null,
  user: null,
  customChart: null,
  categoryMap: {},
  itemSynonyms: [],
  // Page-specific display state (for export/print with filters)
  displayedOrders: null, // Currently displayed orders on Orders page (after filters)
  rawInspector: {
    rows: [],
    lastLoaded: null,
    loading: false,
    error: null
  }
};

const RAW_INSPECTOR_ROW_LIMIT = 200;
const RAW_HOUR_OFFSET = -6; // shift raw parsed hour backwards 6 hours to align with local timezone

function applyHourOffset(hour) {
  if (hour === null || hour === undefined) return hour;
  const n = Number(hour);
  if (!Number.isFinite(n)) return hour;
  const shifted = ((n + RAW_HOUR_OFFSET) % 24 + 24) % 24;
  return shifted;
}

let categoryMapDraft = {};
let previousBodyOverflow = '';
let pendingCategoryMapSync = false;



const formatNumber = (value) => new Intl.NumberFormat(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
}).format(Number(value) || 0);
const formatCurrencyShort = (value) => new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
}).format(Number(value) || 0);
const formatPercentShort = (value) => `${formatNumber(value)}%`;
const htmlEscapeMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => htmlEscapeMap[char] || char);
}

// For text content display (doesn't escape quotes since textContent doesn't interpret HTML)
function escapeForText(value) {
  return String(value ?? '').replace(/[&<>]/g, (char) => htmlEscapeMap[char] || char);
}
const getWorkingRows = () => (state.filtered && state.filtered.length ? state.filtered : state.rows);




function qs(id) { return document.getElementById(id); }
function showView(hash) {
  const route = (hash || location.hash || '#/upload').replace('#', '');
  document.querySelectorAll('.view').forEach(el => el.classList.add('hidden'));
  const [ , view = 'upload' ] = route.split('/');
  const el = document.getElementById(`view-${view}`) || document.getElementById('view-upload');
  el.classList.remove('hidden');
  setActiveNav(`#/` + view);

  // Populate charts for trends and analytics views
  if (view === 'trends' && state.report) {
    renderTrendsCharts();
  } else if (view === 'analytics') {
    console.log('Analytics view accessed', { hasReport: !!state.report, hasRows: !!state.rows?.length });
    if (!state.report && state.rows?.length) {
      console.log('No report exists, generating one for analytics');
      state.report = computeReport(state.rows, state.mapping);
    }
    if (state.report) {
      renderAnalyticsCharts();
    } else {
      console.warn('Cannot render analytics: no report and no data');
    }
  } else if (view === 'dashboard') {
    // Dashboard view (formerly reports)
    renderDashboard();
  } else if (view === 'orders') {
    renderOrdersView();
  } else if (view === 'clients') {
    renderClientTrackingView();
  } else if (view === 'staff') {
    renderStaffTrackingView();
  } else if (view === 'items') {
    renderItemTrackingView();
  } else if (view === 'history') {
    // Populate snapshots list when History page is viewed
    populateSnapshotsList();
  } else if (view === 'settings') {
    renderSettingsView();
  }
}

window.addEventListener('hashchange', () => showView(location.hash));
window.addEventListener('DOMContentLoaded', () => {
  // Clear all stored filter values from localStorage to ensure clean slate
  // This prevents old filter values from previous sessions from being applied
  try {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('filters_')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
    console.log('[app] Cleared stored filter values:', keysToRemove.length);
  } catch (e) {
    console.warn('[app] Failed to clear stored filters:', e);
  }

  // Router
  showView(location.hash);
  // Simple dark mode toggle
  try {
    const darkModeToggle = document.getElementById('darkModeToggle');
    const mobileDarkModeToggle = document.getElementById('mobileDarkModeToggle');
    if (darkModeToggle) {
      darkModeToggle.addEventListener('click', toggleDarkMode);
    }
    if (mobileDarkModeToggle) {
      mobileDarkModeToggle.addEventListener('click', toggleDarkMode);
    }
  } catch {}
  // Update sidebar version (handled by version.js centralized system)

  // Navigation system ready

  // Mobile navigation handled by sidebar script

  // Auth observe
  observeAuth(user => {
    state.user = user;
    const status = qs('authStatus');
    const btnIn = qs('btnSignIn');
    const btnOut = qs('btnSignOut');
    if (user) {
      status.textContent = `Signed in as ${user.displayName || user.email || 'user'}`;
      btnIn.classList.add('hidden');
      btnOut.classList.remove('hidden');
      console.log('[app] User authenticated:', user.email);
    } else {
      if (window.__firebaseDisabled) {
        status.textContent = 'Sign-in disabled (no Firebase config).';
        try { btnIn.setAttribute('disabled','disabled'); btnIn.title = 'Configure Firebase to enable sign-in.'; } catch {}
      } else {
        status.textContent = 'Not signed in.';
      }
      btnIn.classList.remove('hidden');
      btnOut.classList.add('hidden');
      console.log('[app] User not authenticated');
    }

    // Load settings now that auth state is determined
    loadUserSettingsAfterAuth();
  });

  qs('btnSignIn')?.addEventListener('click', signInWithGoogle);
  qs('btnSignOut')?.addEventListener('click', signOutUser);

  // Note: CSV data and demo state now loaded in loadUserSettingsAfterAuth() after authentication

  // Initialize dark mode UI (preference loaded in loadUserSettingsAfterAuth() after authentication)
  initDarkMode();

  // Populate saved reports dropdown with templates (available immediately on page load)
  populateSavedReportsDropdown();
  setupTrendsFilters();
  setupAnalyticsFilters();

  const btnRefreshRawData = qs('btnRefreshRawData');
  if (btnRefreshRawData) {
    btnRefreshRawData.addEventListener('click', () => refreshRawDataInspector(true));
  }
  const btnCopyRawData = qs('btnCopyRawData');
  if (btnCopyRawData) {
    btnCopyRawData.addEventListener('click', () => copyRawDataSample());
  }

  // Load settings after authentication state is determined
  let authStateReady = false;
  async function loadUserSettingsAfterAuth() {
    if (authStateReady) return; // Already loaded
    authStateReady = true;
    console.log('[app] Loading user settings after auth state determined');

    try {
      const m = await loadUserSettings('categoryMap');
      if (m) {
        state.categoryMap = m;
      }
    } catch (e) {
      console.warn('Failed to load categoryMap settings:', e);
    }
    updateCategoryMapSummary();
    if (state.categoryMap && Object.keys(state.categoryMap).length && (state.rows?.length || pendingCategoryMapSync)) {
      const changed = applyCategoryMapToExistingRows();
      if (changed) {
        pendingCategoryMapSync = false;
      }
    }
    // Filters should start blank by default - users can manually apply filters as needed
    // Keep this line commented to prevent auto-loading filters from previous sessions
    // try { const f = await loadUserSettings('filters'); if (f) { state.filters = { ...DEFAULT_FILTERS, ...f }; restoreFilterUI(); } } catch (e) { console.warn('Failed to load filters settings:', e); }
    try { const c = await loadUserSettings('customChartPrefs'); if (c) restoreCustomChartPrefs(c); } catch (e) { console.warn('Failed to load customChartPrefs settings:', e); }

    // Load allowed items and synonyms
    try {
      let list = await loadUserSettings('allowedItemsList');
      if (!list || !Array.isArray(list) || list.length === 0) {
        // Prefill with default allowed list (hardcoded) if user has no saved list yet
        list = ALLOWED_ITEMS;
        const allowedItemsTextarea = document.getElementById('allowedItems');
        if (allowedItemsTextarea) allowedItemsTextarea.value = list.join('\n');
      } else {
        const allowedItemsTextarea = document.getElementById('allowedItems');
        if (allowedItemsTextarea) allowedItemsTextarea.value = list.join('\n');
      }
      window.__allowedItemsList = list;
      window.__allowedCanonSet = new Set(list.map(canonicalizeItemName));
      const enforce = await loadUserSettings('enforceAllowed');
      if (typeof enforce === 'boolean') {
        const enforceCheckbox = document.getElementById('enforceAllowed');
        if (enforceCheckbox) enforceCheckbox.checked = enforce;
        window.__enforceAllowed = enforce;
      }
      // Load synonyms
      const syn = await loadUserSettings('itemSynonyms');
      if (Array.isArray(syn)) {
        state.itemSynonyms = syn;
        const synonymsTextarea = document.getElementById('itemSynonyms');
        if (synonymsTextarea) synonymsTextarea.value = syn.map(p => `${p.from} => ${p.to}`).join('\n');
      } else {
        // Default include Tri Color => Northern
        const defaultSynonyms = [
          { from: 'Tri Color', to: 'Northern' },
          { from: 'Tri-Color', to: 'Northern' }
        ];
        state.itemSynonyms = defaultSynonyms;
        const synonymsTextarea = document.getElementById('itemSynonyms');
        if (synonymsTextarea && !synonymsTextarea.value.trim()) {
          synonymsTextarea.value = defaultSynonyms.map(p => `${p.from} => ${p.to}`).join('\n');
        }
      }
    } catch (e) { console.warn('Failed to load allowed items settings:', e); }

    // Load branding settings
    try {
      const nameInput = document.getElementById('brandName');
      const logoInput = document.getElementById('brandLogo');
      const name = await loadUserSettings('brandName');
      const logo = await loadUserSettings('brandLogo');
      if (nameInput && name) nameInput.value = name;
      if (logoInput && logo) logoInput.value = logo;
    } catch (e) { console.warn('Failed to load branding settings:', e); }

    // Load CSV data and demo state after authentication is determined
    try {
      const storedData = await loadCsvData();
      if (storedData && storedData.rows && storedData.rows.length > 0) {
        state.rows = storedData.rows;
        state.headers = storedData.headers || [];
        state.mapping = storedData.mapping || state.mapping;

        state.rawInspector.rows = storedData.rows || [];
        state.rawInspector.lastLoaded = Date.now();
        state.rawInspector.error = null;

        // DEBUG: Expose state to window and check for missing dates
        window.APP_STATE = state;
        const missingDates = state.rows.filter(r => !r.__dateIso);
        console.log('[app] Loaded data - total rows:', state.rows.length, 'rows missing __dateIso:', missingDates.length);
        if (missingDates.length > 0) {
          console.warn('[app] Sample rows with missing __dateIso:', missingDates.slice(0, 5).map(r => ({
            order: r['Order Number'],
            dateColumn: r[state.mapping.date],
            item: r[state.mapping.item]?.substring(0, 30)
          })));
        }

        // Show data info in upload status
        const uploadStatus = qs('uploadStatus');
        if (uploadStatus) {
          const uploadedDate = storedData.uploadedAt ? new Date(storedData.uploadedAt).toLocaleDateString() : 'unknown date';
          uploadStatus.textContent = `${storedData.rowCount} rows loaded from ${uploadedDate}`;
        }

        // Reapply categoryMap to ensure categories reflect current mappings
        // (stored rows have old __category values from when they were saved)
        console.log('[app] Reapplying categoryMap after loading CSV data...');
        await reapplyCategoryMap();

        if (isSettingsViewActive()) {
          renderRawDataInspectorTable(state.rawInspector.rows, state.mapping);
        }

        applyTrendsFilters({ silent: true });
        applyAnalyticsFilters({ silent: true });

        // Compute report from loaded data
        console.log('[app] Computing report from loaded data:', state.rows.length, 'rows');
        state.report = computeReport(state.rows, state.mapping);

        // Re-render current view to display charts with loaded data
        const currentRoute = (location.hash || '#/upload').replace('#', '');
        const [ , currentView = 'upload' ] = currentRoute.split('/');
        console.log('[app] Data loaded, re-rendering current view:', currentView);

        if (currentView === 'trends') {
          renderTrendsCharts();
        } else if (currentView === 'analytics') {
          renderAnalyticsCharts();
        } else if (currentView === 'dashboard') {
          renderDashboard();
        } else if (currentView === 'orders') {
          renderOrdersView();
        } else if (currentView === 'clients') {
          renderClientTrackingView();
        } else if (currentView === 'staff') {
          renderStaffTrackingView();
        } else if (currentView === 'items') {
          renderItemTrackingView();
        }
      } else {
        // No stored data, load sample data for demo (but only after checking demo state)
        try {
          const m = await import('./storage.js');
          const autoloaded = await m.getDemoState('autoloaded');
          const disabled = await m.getDemoState('disabled');
          if (!autoloaded && !disabled) {
            ingestRows(SAMPLE_ROWS);
            const banner = document.getElementById('demoBanner'); if (banner) banner.textContent = 'Sample data loaded for demo. Upload CSVs to replace.';
            await m.setDemoState('autoloaded', '1');
          }
        } catch (e) {
          console.warn('Failed to manage demo state:', e);
        }
      }
    } catch (e) {
      console.warn('Failed to load CSV data after auth:', e);
    }

    // Load dark mode preference and sync between localStorage and user settings
    try {
      const userDarkMode = await loadUserSettings('darkMode');
      const localDarkMode = localStorage.getItem('darkMode');

      // If user has a saved preference in Firestore, use that and sync to localStorage
      if (userDarkMode === 'true' || userDarkMode === true) {
        document.documentElement.classList.add('dark');
        localStorage.setItem('darkMode', 'true');
      } else if (userDarkMode === 'false' || userDarkMode === false) {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('darkMode', 'false');
      } else if (localDarkMode) {
        // If no user setting but localStorage has a preference, sync to user settings
        if (localDarkMode === 'true') {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
        try { await saveUserSettings('darkMode', localDarkMode); } catch (e) { console.warn('Failed to sync dark mode to user settings:', e); }
      }

      // Update the dark mode button state
      updateDarkModeButton();
    } catch (e) { console.warn('Failed to load dark mode setting:', e); }
  }

  // Fallback: load settings after 3 seconds if auth state hasn't been determined
  setTimeout(() => {
    if (!authStateReady) {
      console.log('[app] Auth state timeout - loading settings anyway');
      loadUserSettingsAfterAuth();
    }
  }, 3000);

  // File handling
  const fileInput = qs('fileInput');
  const btnLoadSample = qs('btnLoadSample');
  if (btnLoadSample) btnLoadSample.addEventListener('click', () => {
    if (!state.mapping.date) {
      const headers = Object.keys(SAMPLE_ROWS[0]);
      state.headers = headers;
      const fill = (id, value) => { const el = qs(id); if (!el) return; el.innerHTML = headers.map(h=>`<option value="${h}">${h}</option>`).join(''); el.value = value; };
      fill('col-date','Date'); fill('col-item','Name'); fill('col-qty','Quantity'); fill('col-price','Price'); fill('col-cost','Cost'); fill('col-order','Order Number'); fill('col-client','Client'); fill('col-staff','Staff');
    }
    ingestRows(SAMPLE_ROWS);
    const banner = qs('demoBanner'); if (banner) banner.textContent = 'Sample data loaded for demo. Upload CSVs to replace.';
  });
  fileInput.addEventListener('change', async () => {
    const files = fileInput.files;
    if (!files || !files.length) return;
    console.log('[app] Starting CSV file processing, files:', files.length);
    qs('uploadStatus').textContent = files.length > 1 ? `Reading ${files.length} files…` : 'Reading sample to detect columns…';
    const { rows, headers } = await parseCsvFiles(files, { preview: 100 });
    console.log('[app] Parsed CSV result - rows:', rows.length, 'headers:', headers);
    state.rows = rows;
    state.headers = headers;
    const detected = detectColumns(headers);
    console.log('[app] Detected columns:', detected);
    // Populate selects
    for (const id of ['col-date','col-item','col-qty','col-price','col-cost','col-revenue','col-category','col-order','col-client','col-staff']) {
      const sel = qs(id); sel.innerHTML = '';
      const blank = document.createElement('option'); blank.value=''; blank.textContent='-'; sel.appendChild(blank);
      for (const h of headers) {
        const opt = document.createElement('option'); opt.value=h; opt.textContent=h; sel.appendChild(opt);
      }
    }
    qs('col-date').value = detected.date || '';
    qs('col-item').value = detected.item || '';
    qs('col-qty').value = detected.qty || '';
    qs('col-price').value = detected.price || '';
    qs('col-revenue').value = detected.revenue || '';
    if (detected.category) qs('col-category').value = detected.category;
    if (detected.cost) qs('col-cost').value = detected.cost;
    if (detected.order) qs('col-order').value = detected.order;
    if (detected.client) qs('col-client').value = detected.client;
    if (detected.staff) qs('col-staff').value = detected.staff;
    qs('uploadStatus').textContent = headers.length ? `Detected ${headers.length} columns.` : 'No headers found.';
    // Try loading saved mapping and apply
    const saved = await loadLastMapping();
    if (saved) {
      ['date','item','qty','price','cost','revenue','category','order','client','staff'].forEach(k => {
        if (saved[k] && headers.includes(saved[k])) {
          qs('col-' + k).value = saved[k];
        }
      });
    }
  });

  // Progress UI helpers
  const showProgress = (show) => {
    const wrap = qs('parseProgressWrap');
    if (!wrap) return;
    if (show) wrap.classList.remove('hidden');
    else wrap.classList.add('hidden');
  };
  const setProgress = (percent, text) => {
    const bar = qs('parseProgressBar');
    const lbl = qs('parseProgressText');
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    if (lbl) lbl.textContent = text || `${percent}%`;
  };

  function applyCategoryMapToExistingRows({ rows = state.rows, recompute = true } = {}) {
    if (!rows || !rows.length) return false;
    const map = state.categoryMap;
    if (!map || typeof map !== 'object' || !Object.keys(map).length) {
      return false;
    }

    const itemCol = state.mapping?.item;
    const categoryCol = state.mapping?.category;
    let changed = false;

    rows.forEach((row) => {
      if (!row) return;
      const rawNameSource = itemCol ? (row[itemCol] ?? row.__itemRaw ?? row.__item) : (row.__itemRaw ?? row.__item);
      const rawName = rawNameSource != null ? String(rawNameSource) : '';
      const canon = canonicalizeItemName(rawName);
      const manualCat = map[rawName] || map[canon] || '';
      const csvCat = categoryCol ? (row[categoryCol] || '') : '';
      const newCategory = (manualCat || csvCat || '').toString().trim() || 'Uncategorized';
      if (row.__category !== newCategory) {
        row.__category = newCategory;
        changed = true;
      }
    });

    if (changed && recompute) {
      state.rows = rows;
      state.report = computeReport(state.rows, state.mapping);
      renderReport();
      updateCategoryMapSummary();
    }

    return changed;
  }

  async function reapplyCategoryMap() {
    if (!state.rows.length) {
      state.report = computeReport(state.rows, state.mapping);
      renderReport();
      updateCategoryMapSummary();
      return;
    }
    showProgress(true);
    setProgress(0, 'Reapplying category mapping...');
    try {
      const normalized = await normalizeAndDedupeAsync(state.rows, state.mapping, (pct, processed) => {
        setProgress(Math.min(99, pct), `Reapplying map - ${pct}%`);
      });
      state.rows = normalized;
      state.rawInspector.rows = normalized;
      state.rawInspector.lastLoaded = Date.now();
      state.rawInspector.error = null;
      pendingCategoryMapSync = false;
      state.report = computeReport(state.rows, state.mapping);
      renderReport();
      updateCategoryMapSummary();
      if (isSettingsViewActive()) {
        renderRawDataInspectorTable(state.rawInspector.rows, state.mapping);
      }
      applyTrendsFilters({ silent: true });
      applyAnalyticsFilters({ silent: true });
    } catch (error) {
      console.warn('[app] Failed to reapply category mapping', error);
    } finally {
      showProgress(false);
    }
  }

  qs('btnParse')?.addEventListener('click', async () => {
    const files = fileInput.files;
    if (!files || !files.length) { alert('Choose at least one CSV.'); return; }
    // Read full files
    qs('uploadStatus').textContent = 'Parsing CSV…';
    const btn = qs('btnParse'); if (btn) btn.disabled = true;
    showProgress(true); setProgress(0, '0%');
    let lastText = '';
    console.log('[app] Starting full CSV parsing');
    const { rows, headers } = await parseCsvFiles(files, {
      onProgress: (p) => {
        const pct = Number.isFinite(p.percent) ? p.percent : 0;
        const txt = `Parsing ${p.fileIndex + 1}/${p.filesCount}: ${p.fileName} - ${pct}% (${(p.rowsParsed||0).toLocaleString()} rows)`;
        if (txt !== lastText) { setProgress(pct, txt); lastText = txt; }
      }
    });
    console.log('[app] Full parsing complete - rows:', rows.length, 'headers:', headers);
    state.rows = rows; state.headers = headers;
    state.mapping = {
      date: qs('col-date').value,
      item: qs('col-item').value,
      qty: qs('col-qty').value,
      price: qs('col-price').value,
      cost: qs('col-cost').value,
      revenue: qs('col-revenue').value,
      category: qs('col-category').value,
      order: qs('col-order').value,
      client: qs('col-client').value,
      staff: qs('col-staff').value,
    };
    await saveLastMapping(state.mapping);
    setProgress(0, 'Normalizing rows…');
    const normalized = await normalizeAndDedupeAsync(rows, state.mapping, (pct, processed) => {
      const total = rows.length;
      setProgress(Math.min(99, pct), `Normalizing ${Math.min(processed,total).toLocaleString()}/${total.toLocaleString()} rows - ${pct}%`);
    });
    console.log('[app] Normalization complete, setting state.rows to', normalized.length, 'rows');
    state.rows = normalized;
    state.rawInspector.rows = normalized;
    state.rawInspector.lastLoaded = Date.now();
    state.rawInspector.error = null;

    const hasCategoryMap = state.categoryMap && Object.keys(state.categoryMap).length > 0;
    if (hasCategoryMap) {
      applyCategoryMapToExistingRows({ rows: normalized, recompute: false });
      pendingCategoryMapSync = false;
    } else {
      pendingCategoryMapSync = true;
    }

    // DEBUG: Expose state to window for console inspection
    window.APP_STATE = state;

    if (isSettingsViewActive()) {
      renderRawDataInspectorTable(state.rawInspector.rows, state.mapping);
    }

    // Save CSV data to Firebase/localStorage for persistence
    await saveCsvData(normalized, headers, state.mapping);

    applyTrendsFilters({ silent: true });
    applyAnalyticsFilters({ silent: true });

    // Compute report from ALL data (filters are display-level only)
    console.log('[app] Computing report from', normalized.length, 'rows');
    state.report = computeReport(normalized, state.mapping);
    console.log('[app] Report computed, rendering...');
    renderReport();
    updateCategoryMapSummary();
    location.hash = '#/dashboard';
    qs('uploadStatus').textContent = `Parsed ${rows.length} rows.`;
    showProgress(false);
    if (btn) btn.disabled = false;
  });

  qs('btnExportItem').addEventListener('click', () => {
    if (!state.report) return;
    const cols = ['item','quantity','revenue','cost','profit','margin'];
    downloadCsv('report_by_item.csv', cols, state.report.byItem.map(x => ({ item:x.item, quantity:x.quantity, revenue:x.revenue, cost:x.cost, profit:x.profit, margin:x.margin })));
  });
  qs('btnExportDate').addEventListener('click', () => {
    if (!state.report) return;
    const cols = ['date','quantity','revenue','cost','profit','margin'];
    downloadCsv('report_by_date.csv', cols, state.report.byDate.map(x => ({ date:x.date, quantity:x.quantity, revenue:x.revenue, cost:x.cost, profit:x.profit, margin:x.margin })));
  });

  qs('btnSaveReport').addEventListener('click', async () => {
    if (!state.report) return;
    const name = prompt('Name this report (optional):') || undefined;
    const saved = await saveReport({
      name,
      mapping: state.mapping,
      totals: state.report.totals,
      byItem: state.report.byItem,
      byDate: state.report.byDate,
    });
    if (saved?.id) alert('Saved report: ' + saved.id);
    else alert('Could not save (check Firestore rules).');
  });

  qs('btnRefreshHistory').addEventListener('click', loadHistory);
  loadHistory();

  // NOTE: Main dashboard filters removed - they don't exist in the HTML
  // Individual pages have their own filter systems that work correctly
  console.log('Main dashboard loaded without central filters (individual pages have their own filters)');

  // NOTE: btnClearFilters and applyLiveFilters removed - no main dashboard filters exist

  const btnExportExcel = qs('btnExportExcel');
  if (btnExportExcel) {
    btnExportExcel.addEventListener('click', () => exportExcel(state.report));
  }
  function exportExcel(report){
    if (!report) return;
    // Build extra sheets
    const extras = {};
    try {
      const rows = state.filtered || state.rows; const mapping = state.mapping;
      const week = aggregateByGranularity(rows, mapping, 'week');
      const month = aggregateByGranularity(rows, mapping, 'month');
      extras['By Week'] = week;
      extras['By Month'] = month;
      if (mapping.category) {
        const catMonth = aggregateByCategoryOverTime(rows, mapping, 'month', 'revenue');
        // Flatten for sheet: period, category, revenue
        const flat = [];
        catMonth.datasets.forEach(ds => {
          ds.data.forEach((v, idx) => flat.push({ period: catMonth.labels[idx], category: ds.label, revenue: Number(v) }));
        });
        extras['By Month by Category'] = flat;
      }
      // Orders by Date
      const orders = aggregateOrdersByDate(rows);
      extras['Orders by Date'] = orders.labels.map((d,i)=> ({ date: d, orders: orders.values[i] }));
      // Month-over-month change
      const mom = monthOverMonthChange(month);
      extras['MoM Change %'] = mom.labels.map((m,i)=> ({ month: m, changePct: mom.values[i] }));
    } catch {}
    exportExcelBook('report.xlsx', report, extras);
  }

  // Dropdown functionality
  const exportMenuBtn = qs('exportMenuBtn');
  const exportMenu = qs('exportMenu');
  const printMenuBtn = qs('printMenuBtn');
  const printMenu = qs('printMenu');

  // Export dropdown toggle
  if (exportMenuBtn && exportMenu) {
    exportMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exportMenu.classList.toggle('hidden');
      printMenu?.classList.add('hidden'); // Close other dropdown
    });
  }

  // Print dropdown toggle
  if (printMenuBtn && printMenu) {
    printMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      printMenu.classList.toggle('hidden');
      exportMenu?.classList.add('hidden'); // Close other dropdown
    });
  }

  // Tracking pages export dropdown toggles
  const ordersExportMenuBtn = qs('ordersExportMenuBtn');
  const ordersExportMenu = qs('ordersExportMenu');
  const clientsExportMenuBtn = qs('clientsExportMenuBtn');
  const clientsExportMenu = qs('clientsExportMenu');
  const staffExportMenuBtn = qs('staffExportMenuBtn');
  const staffExportMenu = qs('staffExportMenu');
  const itemsExportMenuBtn = qs('itemsExportMenuBtn');
  const itemsExportMenu = qs('itemsExportMenu');

  // Orders export dropdown
  if (ordersExportMenuBtn && ordersExportMenu) {
    ordersExportMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      ordersExportMenu.classList.toggle('hidden');
      clientsExportMenu?.classList.add('hidden');
      staffExportMenu?.classList.add('hidden');
      itemsExportMenu?.classList.add('hidden');
    });
  }

  // Clients export dropdown
  if (clientsExportMenuBtn && clientsExportMenu) {
    clientsExportMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      clientsExportMenu.classList.toggle('hidden');
      ordersExportMenu?.classList.add('hidden');
      staffExportMenu?.classList.add('hidden');
      itemsExportMenu?.classList.add('hidden');
    });
  }

  // Staff export dropdown
  if (staffExportMenuBtn && staffExportMenu) {
    staffExportMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      staffExportMenu.classList.toggle('hidden');
      ordersExportMenu?.classList.add('hidden');
      clientsExportMenu?.classList.add('hidden');
      itemsExportMenu?.classList.add('hidden');
    });
  }

  // Items export dropdown
  if (itemsExportMenuBtn && itemsExportMenu) {
    itemsExportMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      itemsExportMenu.classList.toggle('hidden');
      ordersExportMenu?.classList.add('hidden');
      clientsExportMenu?.classList.add('hidden');
      staffExportMenu?.classList.add('hidden');
    });
  }

  // Close dropdowns when clicking outside
  document.addEventListener('click', () => {
    exportMenu?.classList.add('hidden');
    printMenu?.classList.add('hidden');
    ordersExportMenu?.classList.add('hidden');
    clientsExportMenu?.classList.add('hidden');
    staffExportMenu?.classList.add('hidden');
    itemsExportMenu?.classList.add('hidden');
  });

  // Printing
  qs('btnPrintReport').addEventListener('click', () => printCurrentView());
  qs('btnPrintAll').addEventListener('click', () => printAllViews());

  // Custom view - removed old chart builder, keeping only what's needed
  // Old custom chart elements removed in v1.12.0

  // Enhanced report builder listeners
  qs('btnGenerateReport')?.addEventListener('click', () => generateAdvancedReport());
  qs('btnClearReportFilters')?.addEventListener('click', () => clearReportFilters());
  qs('btnSaveReport')?.addEventListener('click', () => saveReportConfiguration());
  qs('btnLoadReport')?.addEventListener('click', () => loadReportConfiguration());
  qs('btnEditReport')?.addEventListener('click', () => editReportConfiguration());
  qs('btnDeleteReport')?.addEventListener('click', () => deleteReportConfiguration());

  // Report snapshot listeners
  qs('btnSaveSnapshot')?.addEventListener('click', () => saveReportSnapshot());

  // Snapshot viewer modal listeners
  qs('btnCloseSnapshotViewer')?.addEventListener('click', () => {
    const modal = qs('snapshotViewerModal');
    if (modal) {
      modal.style.display = 'none';
      modal.classList.add('hidden');
    }
  });

  qs('btnPrintSnapshotFromModal')?.addEventListener('click', () => {
    const modal = qs('snapshotViewerModal');
    const snapshotId = modal?.dataset?.snapshotId;
    if (snapshotId) printSnapshot(parseInt(snapshotId));
  });

  // Close modal when clicking outside
  qs('snapshotViewerModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'snapshotViewerModal') {
      e.target.style.display = 'none';
      e.target.classList.add('hidden');
    }
  });


  // Additional exports
  qs('btnExportClient')?.addEventListener('click', () => {
    if (!state.byClient) return; const cols = ['client','orders','quantity','revenue','cost','profit','margin'];
    downloadCsv('report_by_client.csv', cols, state.byClient.map(x => ({ client:x.label, orders:x.orders, quantity:x.quantity, revenue:x.revenue, cost:x.cost, profit:x.profit, margin:x.margin })));
  });
  qs('btnExportStaff')?.addEventListener('click', () => {
    if (!state.byStaff) return; const cols = ['staff','orders','quantity','revenue','cost','profit','margin'];
    downloadCsv('report_by_staff.csv', cols, state.byStaff.map(x => ({ staff:x.label, orders:x.orders, quantity:x.quantity, revenue:x.revenue, cost:x.cost, profit:x.profit, margin:x.margin })));
  });
  qs('btnExportOrder')?.addEventListener('click', () => {
    if (!state.byOrder) return; const cols = ['order','date','client','staff','quantity','revenue','cost','profit','margin'];
    downloadCsv('report_by_order.csv', cols, state.byOrder);
  });
  qs('btnExportCategory')?.addEventListener('click', () => {
    if (!state.byCategory) return; const cols = ['category','orders','quantity','revenue','cost','profit','margin'];
    downloadCsv('report_by_category.csv', cols, state.byCategory.map(x => ({ category:x.label, orders:x.orders, quantity:x.quantity, revenue:x.revenue, cost:x.cost, profit:x.profit, margin:x.margin })));
  });

  // Orders page export/print
  qs('btnOrdersExportCSV')?.addEventListener('click', () => {
    // Use currently displayed orders (with filters applied)
    const ordersData = state.displayedOrders || [];
    if (!ordersData.length) {
      alert('No orders to export');
      return;
    }
    const cols = ['order','date','client','staff','revenue','profit','margin'];
    downloadCsv('orders.csv', cols, ordersData);
  });
  qs('btnOrdersExportExcel')?.addEventListener('click', () => {
    // Use currently displayed orders (with filters applied)
    const ordersData = state.displayedOrders || [];
    if (!ordersData.length) {
      alert('No orders to export');
      return;
    }
    const report = { byItem: [], byDate: [], totals: {} };
    exportExcelBook('orders.xlsx', report, { Orders: ordersData });
  });
  qs('btnOrdersPrint')?.addEventListener('click', () => printCurrentView());

  // Clients page export/print
  qs('btnClientsExportCSV')?.addEventListener('click', () => {
    if (!state.byClient) return;
    const cols = ['client','orders','quantity','revenue','cost','profit','margin'];
    downloadCsv('clients.csv', cols, state.byClient.map(c => ({
      client: c.label || 'Unassigned',
      orders: c.orders,
      quantity: c.quantity,
      revenue: c.revenue,
      cost: c.cost,
      profit: c.profit,
      margin: c.margin
    })));
  });
  qs('btnClientsExportExcel')?.addEventListener('click', () => {
    if (!state.byClient) return;
    const report = { byItem: [], byDate: [], totals: {} };
    const clientsData = state.byClient.map(c => ({
      client: c.label || 'Unassigned',
      orders: c.orders,
      quantity: c.quantity,
      revenue: c.revenue,
      cost: c.cost,
      profit: c.profit,
      margin: c.margin
    }));
    exportExcelBook('clients.xlsx', report, { Clients: clientsData });
  });
  qs('btnClientsPrint')?.addEventListener('click', () => printCurrentView());

  // Staff page export/print
  qs('btnStaffExportCSV')?.addEventListener('click', () => {
    if (!state.byStaff) return;
    const cols = ['staff','orders','quantity','revenue','cost','profit','margin'];
    downloadCsv('staff.csv', cols, state.byStaff.map(s => ({
      staff: s.label || 'Unassigned',
      orders: s.orders,
      quantity: s.quantity,
      revenue: s.revenue,
      cost: s.cost,
      profit: s.profit,
      margin: s.margin
    })));
  });
  qs('btnStaffExportExcel')?.addEventListener('click', () => {
    if (!state.byStaff) return;
    const report = { byItem: [], byDate: [], totals: {} };
    const staffData = state.byStaff.map(s => ({
      staff: s.label || 'Unassigned',
      orders: s.orders,
      quantity: s.quantity,
      revenue: s.revenue,
      cost: s.cost,
      profit: s.profit,
      margin: s.margin
    }));
    exportExcelBook('staff.xlsx', report, { Staff: staffData });
  });
  qs('btnStaffPrint')?.addEventListener('click', () => printCurrentView());

  // Items page export/print
  qs('btnItemsExportCSV')?.addEventListener('click', () => {
    if (!state.byItem) return;
    const cols = ['item','quantity','revenue','cost','profit','margin'];
    downloadCsv('items.csv', cols, state.byItem.map(item => ({
      item: item.item || 'Unassigned',
      quantity: item.quantity,
      revenue: item.revenue,
      cost: item.cost,
      profit: item.profit,
      margin: item.margin
    })));
  });
  qs('btnItemsExportExcel')?.addEventListener('click', () => {
    if (!state.byItem) return;
    const report = { byItem: [], byDate: [], totals: {} };
    const itemsData = state.byItem.map(item => ({
      item: item.item || 'Unassigned',
      quantity: item.quantity,
      revenue: item.revenue,
      cost: item.cost,
      profit: item.profit,
      margin: item.margin
    }));
    exportExcelBook('items.xlsx', report, { Items: itemsData });
  });
  qs('btnItemsPrint')?.addEventListener('click', () => printCurrentView());
  qs('btnPrintTrends')?.addEventListener('click', () => printCurrentView());
  qs('btnPrintAnalytics')?.addEventListener('click', () => printCurrentView());

  // Note: Branding now loaded in loadUserSettingsAfterAuth() after authentication
  qs('btnSaveBrand').addEventListener('click', saveBranding);
  // Allowed items persist
  qs('btnSaveAllowed')?.addEventListener('click', async () => {
    const list = (document.getElementById('allowedItems')?.value || '').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    const enforce = !!document.getElementById('enforceAllowed')?.checked;
    window.__allowedItemsList = list; window.__enforceAllowed = enforce;
    await saveUserSettings('allowedItemsList', list);
    await saveUserSettings('enforceAllowed', enforce);
    alert('Allowed items saved.');
  });
  // Note: Allowed items and synonyms now loaded in loadUserSettingsAfterAuth() after authentication

  // Clear local data
  qs('btnClearLocal')?.addEventListener('click', async () => {
    // Only clear CSV/sample in-memory data and demo autoload flag
    try {
      const m = await import('./storage.js');
      await m.setDemoState('autoloaded', null);
      // Prevent auto-demo from loading immediately after clearing
      await m.setDemoState('disabled', '1');
    } catch {}
    // Reset in-memory dataset (do not touch theme or user settings)
    try {
      state.rows = [];
      state.report = null;
    } catch {}
    // Navigate to Upload and reload UI
    location.href = '#/upload';
    location.reload();
  });

  // Data Management Handlers
  qs('btnDeleteCsvData')?.addEventListener('click', async () => {
    if (!confirm('This will delete your uploaded CSV data but keep settings and saved reports. Continue?')) return;

    try {
      await deleteCsvData();

      // Clear in-memory data
      state.rows = [];
      state.headers = [];
      state.report = null;

      // Update UI
      const uploadStatus = qs('uploadStatus');
      if (uploadStatus) uploadStatus.textContent = 'CSV data cleared';

      // Navigate back to upload
      location.hash = '#/upload';
      alert('CSV data has been cleared.');
    } catch (e) {
      console.error('Failed to delete CSV data:', e);
      alert('Failed to delete CSV data. Please try again.');
    }
  });

  qs('btnDeleteAllData')?.addEventListener('click', async () => {
    if (!confirm('⚠️ WARNING: This will permanently delete ALL your data including CSV data, settings, saved reports, and preferences. This action cannot be undone. Are you absolutely sure?')) return;

    if (!confirm('Last chance! This will delete everything. Type YES in the next prompt to confirm.')) return;

    const confirmation = prompt('Type "DELETE ALL" to confirm deletion of all data:');
    if (confirmation !== 'DELETE ALL') {
      alert('Deletion cancelled.');
      return;
    }

    try {
      await deleteAllUserData();

      // Clear all in-memory data
      state.rows = [];
      state.headers = [];
      state.report = null;
      state.mapping = { date: '', item: '', qty: '', price: '', cost: '', revenue: '', category: '', order: '', client: '', staff: '' };
      state.categoryMap = {};
      state.itemSynonyms = [];

      // Update UI
      const uploadStatus = qs('uploadStatus');
      if (uploadStatus) uploadStatus.textContent = 'All data deleted';

      alert('All data has been permanently deleted. The page will now reload.');
      location.reload();
    } catch (e) {
      console.error('Failed to delete all data:', e);
      alert('Failed to delete all data. Please try again.');
    }
  });

  // Synonyms save/clear
  qs('btnSaveSynonyms')?.addEventListener('click', async () => {
    const raw = document.getElementById('itemSynonyms')?.value || '';
    const map = raw.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
      const m = l.split(/=>/);
      if (m.length >= 2) return { from: m[0].trim(), to: m.slice(1).join('=>').trim() };
      return null;
    }).filter(Boolean);
    state.itemSynonyms = map;
    console.log('[btnSaveSynonyms] Saving synonyms:', map);
    await saveUserSettings('itemSynonyms', map);
    alert(`Synonyms saved (${map.length} rules). They will apply to new ingested data. Current synonyms in memory:` + JSON.stringify(map));
  });
  qs('btnClearSynonyms')?.addEventListener('click', async () => {
    state.itemSynonyms = [];
    const ta = document.getElementById('itemSynonyms'); if (ta) ta.value = '';
    await saveUserSettings('itemSynonyms', []);
  });

  // Reapply synonyms to existing data
  qs('btnReapplySynonyms')?.addEventListener('click', async () => {
    if (!state.rows || state.rows.length === 0) {
      alert('No data loaded. Please upload a CSV file first.');
      return;
    }

    console.log(`[btnReapplySynonyms] Reapplying ${state.itemSynonyms.length} synonym rules to ${state.rows.length} rows`);

    // Reprocess all rows to update __item with current synonyms
    state.rows = state.rows.map(row => {
      const itemCol = state.mapping.item;
      const originalName = row[itemCol] || '';
      const canonicalizedName = canonicalizeItemName(originalName);
      return {
        ...row,
        __item: canonicalizedName
      };
    });

    // Recompute reports with updated data
    state.report = computeReport(state.rows, state.mapping);

    // Save updated data
    await saveCsvData(state.rows);

    // Refresh current view
    route();

    alert(`Synonyms reapplied! Processed ${state.rows.length} rows with ${state.itemSynonyms.length} synonym rules.`);
  });

  // Print: ensure canvases are printable
  window.addEventListener('beforeprint', freezeChartsForPrint);
  window.addEventListener('afterprint', restoreChartsAfterPrint);
  // Category mapping UI
  const btnOpenCategoryMapModal = qs('btnOpenCategoryMapModal');
  const btnCategoryModalClose = qs('btnCategoryModalClose');
  const categoryMapModalBackdrop = qs('categoryMapModalBackdrop');

  if (btnOpenCategoryMapModal) {
    btnOpenCategoryMapModal.addEventListener('click', openCategoryMapModal);
  } else {
    console.warn('[app] btnOpenCategoryMapModal not found in DOM');
  }

  if (btnCategoryModalClose) {
    btnCategoryModalClose.addEventListener('click', closeCategoryMapModal);
  } else {
    console.warn('[app] btnCategoryModalClose not found in DOM');
  }

  if (categoryMapModalBackdrop) {
    categoryMapModalBackdrop.addEventListener('click', closeCategoryMapModal);
  } else {
    console.warn('[app] categoryMapModalBackdrop not found in DOM');
  }

  // Global ESC key handler for all modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      // Check modals in priority order (most specific to least specific)

      // Chart zoom modal (imported from ui.js)
      const chartZoomModal = document.getElementById('chartZoomModal');
      if (chartZoomModal && !chartZoomModal.classList.contains('hidden')) {
        // Call the close function from ui.js
        const closeEvent = new CustomEvent('closeChartZoom');
        document.dispatchEvent(closeEvent);
        return;
      }

      // Snapshot viewer modal
      const snapshotModal = qs('snapshotViewerModal');
      if (snapshotModal && !snapshotModal.classList.contains('hidden')) {
        snapshotModal.style.display = 'none';
        snapshotModal.classList.add('hidden');
        return;
      }

      // Category map modal
      const categoryModal = qs('categoryMapModal');
      if (categoryModal && !categoryModal.classList.contains('hidden')) {
        closeCategoryMapModal();
        return;
      }
    }
  });

  const btnCategoryAddRow = qs('btnCategoryAddRow');
  if (btnCategoryAddRow) {
    btnCategoryAddRow.addEventListener('click', () => {
      const editor = document.getElementById('categoryMapList');
      if (!editor) return;
      appendCategoryMapRow(editor, '', '');
      editor.scrollTop = editor.scrollHeight;
    });
  } else {
    console.warn('[app] btnCategoryAddRow not found in DOM');
  }

  qs('btnLoadItemsMapping')?.addEventListener('click', () => {
    const current = collectCategoryMapDraft('categoryMapList');
    const items = getUniqueItemsFromData();
    items.forEach(item => {
      if (!(item in current)) {
        current[item] = state.categoryMap?.[item] || '';
      }
    });
    setCategoryMapDraft(current);
  });

  const categoryMapFileInput = qs('categoryMapFile');
  categoryMapFileInput?.addEventListener('change', async (event) => {
    try {
      const file = event.target?.files?.[0];
      if (!file) return;
      const current = collectCategoryMapDraft('categoryMapList');
      const { rows, headers } = await parseCsv(file, {});
      const headerList = (headers && headers.length) ? headers : Object.keys(rows[0] || {});
      const lowerHeaders = headerList.map(h => h.toLowerCase());
      let itemKey = '';
      let categoryKey = '';
      lowerHeaders.forEach((h, idx) => {
        if (!itemKey && (h.includes('item') || h.includes('name') || h.includes('product'))) itemKey = headerList[idx];
        if (!categoryKey && h.includes('category')) categoryKey = headerList[idx];
      });
      if (!itemKey && headerList[0]) itemKey = headerList[0];
      if (!categoryKey && headerList[1]) categoryKey = headerList[1];
      if (!itemKey || !categoryKey) {
        if (event.target) event.target.value = '';
        alert('Unable to detect item and category columns in the mapping file.');
        return;
      }
      rows.forEach(row => {
        const item = (row[itemKey] ?? '').toString().trim();
        const category = (row[categoryKey] ?? '').toString().trim();
        if (item && category) current[item] = category;
      });
      setCategoryMapDraft(current);
      event.target.value = '';
    } catch (error) {
      console.warn('[app] Failed to import category map file', error);
      alert('Unable to import mapping file. Please check the format.');
    }
  });

  qs('btnCategoryApplyBulk')?.addEventListener('click', () => {
    const textarea = qs('categoryMapBulkInput');
    if (!textarea) return;
    const rowsRaw = (textarea.value || '').replace(/\r/g, '').split('\n');
    const current = collectCategoryMapDraft('categoryMapList');
    rowsRaw.forEach(line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const parts = trimmed.split(/,|\t/);
      if (parts.length < 2) return;
      const item = parts[0].trim();
      const category = parts.slice(1).join(',').trim();
      if (item && category) current[item] = category;
    });
    setCategoryMapDraft(current);
    textarea.value = '';
  });

  qs('btnCategoryClearBulk')?.addEventListener('click', () => {
    const textarea = qs('categoryMapBulkInput');
    if (textarea) textarea.value = '';
  });

  const btnSaveCategoryMap = qs('btnSaveCategoryMap');
  if (btnSaveCategoryMap) {
    btnSaveCategoryMap.addEventListener('click', async () => {
      const map = collectCategoryMapDraft('categoryMapList', { includeEmpty: false });
      const count = Object.keys(map).length;

      state.categoryMap = map;
      await saveUserSettings('categoryMap', map);

      console.log('[CategoryMap] Saved mappings:', map);

      // Reapply mappings and reprocess data
      await reapplyCategoryMap();
      updateCategoryMapSummary();
      closeCategoryMapModal();

      alert(`✅ Successfully saved ${count} category mapping(s).\n\nYour data has been reprocessed with the new categories.`);
    });
  } else {
    console.warn('[app] btnSaveCategoryMap not found in DOM');
  }

  const btnClearCategoryMap = qs('btnClearCategoryMap');
  if (btnClearCategoryMap) {
    btnClearCategoryMap.addEventListener('click', async () => {
      if (!window.confirm('Clear all category mappings?')) return;
      categoryMapDraft = {};
      setCategoryMapDraft({});
      state.categoryMap = {};
      await saveUserSettings('categoryMap', {});
      await reapplyCategoryMap();
      updateCategoryMapSummary();
    });
  } else {
    console.warn('[app] btnClearCategoryMap not found in DOM');
  }

  const btnExportCategoryMapCsv = qs('btnExportCategoryMapCsv');
  if (btnExportCategoryMapCsv) {
    btnExportCategoryMapCsv.addEventListener('click', () => {
      // Export all unique items from current dataset with existing category mappings
      if (!state.rows || !state.rows.length) {
        alert('No data loaded. Please upload CSV data first.');
        return;
      }

      // Get unique items from current dataset
      const uniqueItems = new Set();
      state.rows.forEach(row => {
        const item = row[state.mapping?.item] || row.__item || '';
        if (item && item.trim()) {
          uniqueItems.add(item.trim());
        }
      });

      if (!uniqueItems.size) {
        alert('No items found in dataset.');
        return;
      }

      // Create rows with item and category (pre-filled if exists in categoryMap)
      const rows = Array.from(uniqueItems).sort().map(item => ({
        item: item,
        category: state.categoryMap?.[item] || ''
      }));

      downloadCsv('item_category_mapping.csv', ['item', 'category'], rows);
      console.log(`Exported ${rows.length} items for category mapping`);
    });
  } else {
    console.warn('[app] btnExportCategoryMapCsv not found in DOM');
  }

  // Reapply categories button
  const btnReapplyCategories = qs('btnReapplyCategories');
  if (btnReapplyCategories) {
    btnReapplyCategories.addEventListener('click', async () => {
      if (!state.rows || !state.rows.length) {
        alert('No data loaded. Please upload CSV data first.');
        return;
      }

      const mapCount = state.categoryMap ? Object.keys(state.categoryMap).length : 0;
      if (!mapCount) {
        alert('No category mappings found. Please create mappings first.');
        return;
      }

      console.log(`[ReapplyCategories] Reapplying ${mapCount} category mappings to data`);
      await reapplyCategoryMap();
      alert(`✅ Successfully applied ${mapCount} category mappings to your data!`);
    });
  } else {
    console.warn('[app] btnReapplyCategories not found in DOM');
  }

  // Upload category mapping CSV
  const uploadCategoryMapCsv = qs('uploadCategoryMapCsv');
  if (uploadCategoryMapCsv) {
    uploadCategoryMapCsv.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      try {
        const text = await file.text();
        console.log('[CategoryMapUpload] Raw CSV text (first 500 chars):', text.substring(0, 500));

        Papa.parse(text, {
          header: true,
          skipEmptyLines: true,
          worker: false, // Disable worker mode to avoid "p1 is not defined" error
          complete: async (results) => {
            console.log('[CategoryMapUpload] Full parse results:', results);
            console.log('[CategoryMapUpload] Parsed CSV data:', results.data);
            console.log('[CategoryMapUpload] Column names:', results.meta?.fields);
            console.log('[CategoryMapUpload] Total rows:', results.data.length);

            const newMap = {};
            let count = 0;
            let skipped = 0;

            results.data.forEach((row, index) => {
              console.log(`[Row ${index}] Raw row object:`, row);
              console.log(`[Row ${index}] Object keys:`, Object.keys(row));

              // Flexible column detection - check all possible variations
              const itemValue = row.item || row.Item || row.ITEM ||
                               row['item'] || row['Item'] || row['ITEM'] || '';
              const categoryValue = row.category || row.Category || row.CATEGORY ||
                                   row['category'] || row['Category'] || row['CATEGORY'] || '';

              console.log(`[Row ${index}] item="${itemValue}" (type: ${typeof itemValue}), category="${categoryValue}" (type: ${typeof categoryValue})`);
              console.log(`[Row ${index}] item.trim()="${itemValue.trim()}", category.trim()="${categoryValue.trim()}"`);

              if (itemValue && itemValue.trim()) {
                if (categoryValue && categoryValue.trim()) {
                  newMap[itemValue.trim()] = categoryValue.trim();
                  count++;
                  console.log(`[Row ${index}] ✅ ADDED: "${itemValue.trim()}" -> "${categoryValue.trim()}"`);
                } else {
                  // Item exists but no category - skip this row
                  skipped++;
                  console.log(`[Row ${index}] ⏭️ SKIPPED: Empty category for item "${itemValue}"`);
                }
              } else {
                console.log(`[Row ${index}] ⏭️ SKIPPED: Empty item`);
              }
            });

            console.log(`[CategoryMapUpload] Final results - Imported: ${count}, Skipped: ${skipped}`);
            console.log(`[CategoryMapUpload] New mappings:`, newMap);

            if (count === 0) {
              const cols = results.meta?.fields?.join(', ') || 'unknown';
              alert(`No valid item-category mappings found in CSV.\n\nDetected columns: ${cols}\n\nExpected columns: "item" and "category"\n\nMake sure both columns exist and have values.\n\nCheck browser console (F12) for detailed debugging.`);
              return;
            }

            // Merge with existing mappings
            state.categoryMap = { ...state.categoryMap, ...newMap };

            // Save to settings
            await saveUserSettings('categoryMap', state.categoryMap);

            const skippedMsg = skipped > 0 ? `\n(${skipped} rows skipped due to empty category)` : '';
            alert(`✅ Successfully imported ${count} category mapping(s).${skippedMsg}\n\nData will be reprocessed.`);

            // Reprocess data with new mappings - this re-normalizes rows with new __category values
            await reapplyCategoryMap();

            // Clear file input
            e.target.value = '';
          },
          error: (error) => {
            console.error('CSV parse error:', error);
            alert('Error parsing CSV file: ' + error.message);
          }
        });
      } catch (error) {
        console.error('File read error:', error);
        alert('Error reading file: ' + error.message);
      }
    });
  } else {
    console.warn('[app] uploadCategoryMapCsv not found in DOM');
  }

  // Initialize dropdown filters when data is available
  if (state.rows && state.rows.length) {
    populateDropdownFilters();
  }
});


function renderDashboard() {
  // Dashboard shows ALL data (state.report is always computed from all rows now)
  if (!state.rows || !state.rows.length || !state.report) return;
  renderReport();
}

function renderReport() {
  if (!state.report) return;
  renderTotals(qs('totals'), state.report.totals);
  renderTable(qs('table-item'), ['item','quantity','revenue'], state.report.byItem);
  renderTable(qs('table-date'), ['date','quantity','revenue'], state.report.byDate.slice().reverse());
  if (state.chart) { state.chart.destroy(); state.chart = null; }
  const labels = state.report.byDate.map(r => r.date);
  const data = state.report.byDate.map(r => r.revenue);
  state.chart = makeChart(document.getElementById('chart-revenue'), labels, data, 'Revenue');
  if (state.chartQty) { state.chartQty.destroy(); state.chartQty = null; }
  const qtyData = state.report.byDate.map(r => r.quantity);
  state.chartQty = makeChart(document.getElementById('chart-qty'), labels, qtyData, 'Quantity');
  if (state.chartTop) { state.chartTop.destroy(); state.chartTop = null; }
  const top = state.report.byItem.slice(0, 10);
  const topLabels = top.map(r => r.item);
  const topVals = top.map(r => r.revenue);
  state.chartTop = makeBarChart(document.getElementById('chart-top-items'), topLabels, topVals, 'Top Items by Revenue');

  // ALL aggregations use ALL data (filters are display-level only)
  const allData = state.rows;

  state.byClient = aggregateByField(allData, r => {
    const val = r.__client;
    return (val !== null && val !== undefined && val !== 'undefined' && String(val).trim() !== '') ? val : '';
  });

  state.byStaff = aggregateByField(allData, r => {
    const val = r.__staff;
    const trimmed = String(val).trim();
    return (val !== null && val !== undefined && val !== 'undefined' && trimmed !== '') ? val : '';
  });

  state.byCategory = aggregateByField(allData, r => {
    const val = r.__category;
    return (val !== null && val !== undefined && val !== 'undefined' && String(val).trim() !== '') ? val : '';
  });

  state.byOrder = aggregateByOrder(allData, state.mapping);

  // Items data comes from the report
  state.byItem = state.report.byItem;

  // Populate dropdown filters with current data
  populateDropdownFilters();

  // Populate advanced report builder filters
  populateReportFilters();
  populateSavedReportsDropdown();

  const clientRows = state.byClient.map(x => ({ client: x.label, orders: x.orders, quantity: x.quantity, revenue: x.revenue, cost: x.cost, profit: x.profit, margin: x.margin }));
  const staffRows = state.byStaff.map(x => ({ staff: x.label, orders: x.orders, quantity: x.quantity, revenue: x.revenue, cost: x.cost, profit: x.profit, margin: x.margin }));
  renderTable(qs('table-client-main'), ['client','orders','quantity','revenue','cost','profit','margin'], clientRows);
  renderTable(qs('table-staff-main'), ['staff','orders','quantity','revenue','cost','profit','margin'], staffRows);
  const catSection = document.getElementById('section-category');
  if (state.byCategory && state.byCategory.length) {
    catSection?.classList.remove('hidden');
    const catRows = state.byCategory.map(x => ({ category: x.label, orders: x.orders, quantity: x.quantity, revenue: x.revenue, cost: x.cost, profit: x.profit, margin: x.margin }));
    renderTable(qs('table-category-main'), ['category','orders','quantity','revenue','cost','profit','margin'], catRows);
    // Category share chart - horizontal bar for print-friendly black & white
    if (state.chartCatShare) { state.chartCatShare.destroy(); state.chartCatShare = null; }
    const labelsCat = state.byCategory.map(x => x.label);
    const valsCat = state.byCategory.map(x => x.revenue);
    state.chartCatShare = makeBarChart(document.getElementById('chart-category-share'), labelsCat, valsCat, 'Category Share (Revenue)', { indexAxis: 'y' });
  } else {
    catSection?.classList.add('hidden');
  }
  renderTable(qs('table-order-main'), ['order','date','client','staff','quantity','revenue','cost','profit','margin'], state.byOrder);
  if (state.chartTopClients) { state.chartTopClients.destroy(); state.chartTopClients = null; }
  // Filter Windsor Cash from chart display (but keep in totals)
  const topClients = state.byClient.filter(c => c.label !== 'Windsor Cash').slice(0, 10);
  state.chartTopClients = makeBarChart(document.getElementById('chart-top-clients'), topClients.map(x=>x.label), topClients.map(x=>x.revenue), 'Top Clients by Revenue');

  // Additional summary charts
  try {
    // Filter Windsor Cash from chart display (but keep in totals)
    const byClientTop = state.byClient.filter(c => c.label !== 'Windsor Cash').slice(0, 10);
    const byStaffTop = state.byStaff.slice(0, 10);
    const byOrderTop = state.byOrder.slice(0, 10);
    const cClient = document.getElementById('chart-by-client');
    if (cClient) { if (state.chartByClient) state.chartByClient.destroy(); state.chartByClient = makeBarChart(cClient, byClientTop.map(x=>x.label), byClientTop.map(x=>x.revenue), 'Revenue'); }
    const cStaff = document.getElementById('chart-by-staff');
    if (cStaff) { if (state.chartByStaff) state.chartByStaff.destroy(); state.chartByStaff = makeBarChart(cStaff, byStaffTop.map(x=>x.label), byStaffTop.map(x=>x.revenue), 'Revenue'); }
    const cOrder = document.getElementById('chart-by-order');
    if (cOrder) { if (state.chartByOrder) state.chartByOrder.destroy(); state.chartByOrder = makeBarChart(cOrder, byOrderTop.map(x=>x.order || x.label || ''), byOrderTop.map(x=>x.revenue), 'Revenue'); }
  } catch {}

  // Trends
  if (state.chartOrders) { state.chartOrders.destroy(); state.chartOrders = null; }
  const ordersByDate = aggregateOrdersByDate(allData);
  state.chartOrders = makeChart(document.getElementById('chart-orders'), ordersByDate.labels, ordersByDate.values, 'Orders');
  if (state.chartRevRolling) { state.chartRevRolling.destroy(); state.chartRevRolling = null; }
  const rolling = rollingAverage(state.report.byDate.map(x=>({label:x.date,value:x.revenue})), 7);
  state.chartRevRolling = makeChart(document.getElementById('chart-rev-rolling'), rolling.labels, rolling.values, '7d Avg Revenue');
  if (state.chartRevMoM) { state.chartRevMoM.destroy(); state.chartRevMoM = null; }
  const month = aggregateByGranularity(allData, state.mapping, 'month');
  const mom = monthOverMonthChange(month);
  state.chartRevMoM = makeChart(document.getElementById('chart-rev-mom'), mom.labels, mom.values, 'MoM Change %');

  // Profit / Margin
  const profitSeries = state.report.byDate.map(x => x.profit);
  const marginSeries = state.report.byDate.map(x => x.margin);
  if (state.chartProfit) { state.chartProfit.destroy(); state.chartProfit = null; }
  const chartProfit = document.getElementById('chart-profit'); if (chartProfit) state.chartProfit = makeChart(chartProfit, labels, profitSeries, 'Profit');
  if (state.chartMargin) { state.chartMargin.destroy(); state.chartMargin = null; }
  const chartMargin = document.getElementById('chart-margin'); if (chartMargin) state.chartMargin = makeChart(chartMargin, labels, marginSeries, 'Margin %');

  // AOV & Items per Order
  const byDateMap = new Map(state.report.byDate.map(x => [x.date, x]));
  const aovVals = ordersByDate.labels.map(d => { const ord = ordersByDate.values[ordersByDate.labels.indexOf(d)] || 0; const rev = byDateMap.get(d)?.revenue || 0; return ord ? Number((rev/ord).toFixed(2)) : 0; });
  const ipoVals = ordersByDate.labels.map(d => { const ord = ordersByDate.values[ordersByDate.labels.indexOf(d)] || 0; const qty = byDateMap.get(d)?.quantity || 0; return ord ? Number((qty/ord).toFixed(2)) : 0; });
  if (state.chartAov) { state.chartAov.destroy(); state.chartAov = null; }
  const chartAov = document.getElementById('chart-aov'); if (chartAov) state.chartAov = makeChart(chartAov, ordersByDate.labels, aovVals, 'AOV');
  if (state.chartIpo) { state.chartIpo.destroy(); state.chartIpo = null; }
  const chartIpo = document.getElementById('chart-ipo'); if (chartIpo) state.chartIpo = makeChart(chartIpo, ordersByDate.labels, ipoVals, 'Items/Order');

  // Rolling quantity and 30-day rolling revenue
  const rollQty = rollingAverage(state.report.byDate.map(x=>({label:x.date,value:x.quantity})), 7);
  if (state.chartQtyRolling) { state.chartQtyRolling.destroy(); state.chartQtyRolling = null; }
  const chartQtyRoll = document.getElementById('chart-qty-rolling'); if (chartQtyRoll) state.chartQtyRolling = makeChart(chartQtyRoll, rollQty.labels, rollQty.values, '7d Avg Qty');
  const rollRev30 = rollingAverage(state.report.byDate.map(x=>({label:x.date,value:x.revenue})), 30);
  if (state.chartRevRolling30) { state.chartRevRolling30.destroy(); state.chartRevRolling30 = null; }
  const chartRev30 = document.getElementById('chart-rev-rolling-30'); if (chartRev30) state.chartRevRolling30 = makeChart(chartRev30, rollRev30.labels, rollRev30.values, '30d Avg Revenue');

  // Day-of-week average revenue
  const dowAgg = new Array(7).fill(0).map(()=>({sum:0,count:0}));
  for (const d of state.report.byDate) {
    const dow = new Date(d.date).getDay();
    dowAgg[dow].sum += d.revenue; dowAgg[dow].count += 1;
  }
  const dowLabels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const dowValues = dowAgg.map(x => x.count ? Number((x.sum/x.count).toFixed(2)) : 0);
  if (state.chartDowRevenue) { state.chartDowRevenue.destroy(); state.chartDowRevenue = null; }
  const chartDow = document.getElementById('chart-dow-revenue'); if (chartDow) state.chartDowRevenue = makeBarChart(chartDow, dowLabels, dowValues, 'Avg Revenue');

  // Hour-of-day revenue summary
  const hourSummary = aggregateRevenueByHour(allData, { mapping: state.mapping });
  state.hourlyRevenue = hourSummary;

  console.log('[renderReport] Hour chart data:', {
    totalRows: allData.length,
    rowsWithHour: hourSummary?.stats?.rowsWithHour || 0,
    chartRange: hourSummary?.stats?.chartRange,
    fallback: hourSummary?.stats?.fallbackToObservedRange,
    buckets: hourSummary?.buckets,
    sampleRows: allData.slice(0, 3).map(r => ({ __hour: r.__hour, __revenue: r.__revenue }))
  });

  if (state.chartHourRevenue) { state.chartHourRevenue.destroy(); state.chartHourRevenue = null; }
  const chartHour = document.getElementById('trends-chart-hour-revenue');
  if (chartHour) {
    const fallbackHour = hourSummary?.stats?.businessRange ? hourSummary.stats.businessRange[0] : 7;
    const fallbackLabel = formatHourLabel(fallbackHour);
    const labels = hourSummary.labels.length ? hourSummary.labels : [fallbackLabel];
    const data = hourSummary.data.length ? hourSummary.data : [0];
    state.chartHourRevenue = makeBarChart(chartHour, labels, data, hourSummary.title);
    console.log('[renderReport] Hour chart created:', {
      hasChart: !!state.chartHourRevenue,
      title: hourSummary.title,
      stats: hourSummary.stats
    });
  } else {
    console.warn('[renderReport] Hour chart canvas not found');
  }

  // YoY change (monthly)
  const yoy = monthYearOverYearChange(month);
  if (state.chartRevYoy) { state.chartRevYoy.destroy(); state.chartRevYoy = null; }
  const chartYoy = document.getElementById('chart-rev-yoy'); if (chartYoy) state.chartRevYoy = makeChart(chartYoy, yoy.labels, yoy.values, 'YoY Change %');

  // Category trend by month (stacked)
  const catTrendCanvas = document.getElementById('trends-chart-cat-trend');
  if (catTrendCanvas && state.byCategory && state.byCategory.length) {
    if (state.chartCatTrend) { state.chartCatTrend.destroy(); state.chartCatTrend = null; }
    const catTrend = aggregateByCategoryOverTime(allData, state.mapping, 'month', 'revenue', 8);
    console.log('[renderReport] Category trend data:', catTrend);
    state.chartCatTrend = makeStackedBarChart(catTrendCanvas, catTrend.labels, catTrend.datasets);
  } else {
    console.warn('[renderReport] Category trend chart skipped:', {
      canvas: !!catTrendCanvas,
      byCategory: state.byCategory?.length || 0
    });
  }

  // Enable click-to-zoom on charts
  try { enableChartZoom(document); } catch {}

  renderOrdersView();
  renderClientTrackingView();
  renderStaffTrackingView();
  renderItemTrackingView();
}

// Filter and search state persistence functions
function saveFilterState(pageKey, filters) {
  try {
    localStorage.setItem(`filters_${pageKey}`, JSON.stringify(filters));
  } catch {}
}

function loadFilterState(pageKey) {
  try {
    const saved = localStorage.getItem(`filters_${pageKey}`);
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function saveSearchState(pageKey, searchTerm) {
  try {
    localStorage.setItem(`search_${pageKey}`, searchTerm);
  } catch {}
}

function loadSearchState(pageKey) {
  try {
    return localStorage.getItem(`search_${pageKey}`) || '';
  } catch {
    return '';
  }
}

function renderOrdersView() {
  const summaryEl = qs('ordersSummary');
  const tableEl = qs('ordersTrackingTable');
  const searchInput = qs('ordersSearch');
  if (!summaryEl || !tableEl) return;

  // Search persistence (save only, no restoration - inputs start empty)
  if (searchInput) {
    // Save search state on input
    searchInput.addEventListener('input', () => {
      saveSearchState('orders', searchInput.value);
    });
  }

  // Setup live filtering for orders advanced filters
  setupOrdersLiveFilters();

  if (!state.report || !state.byOrder || !state.byOrder.length) {
    summaryEl.textContent = state.report ? 'No orders available for the current filters.' : 'Upload data to view orders.';
    tableEl.innerHTML = '<div class="text-sm text-gray-500">No orders available.</div>';
    return;
  }

  // Set up search event listener
  if (searchInput && !searchInput.hasAttribute('data-listener')) {
    searchInput.setAttribute('data-listener', 'true');
    searchInput.addEventListener('input', () => renderOrdersView());
  }

  // Use ALL rows for date lookup since state.byOrder contains all orders
  // (not just filtered ones). This ensures we can find dates for all orders.
  const workingRows = state.rows;
  const rowsByOrder = new Map();
  workingRows.forEach(row => {
    const key = row.__order || String(row[state.mapping.order] || '').trim() || '-';
    if (!rowsByOrder.has(key)) rowsByOrder.set(key, []);
    rowsByOrder.get(key).push(row);
  });

  const getLatestDate = (orderId) => {
    const rows = rowsByOrder.get(orderId) || [];
    return rows.reduce((latest, row) => {
      const iso = row.__dateIso || '';
      return iso && (!latest || iso > latest) ? iso : latest;
    }, '');
  };

  // Filter orders based on search term
  const searchTerm = (searchInput?.value || '').toLowerCase().trim();
  let orders = [...state.byOrder];
  if (searchTerm) {
    orders = orders.filter(order => {
      // Search in order ID, client, staff
      const orderText = `${order.order} ${order.client || ''} ${order.staff || ''}`.toLowerCase();
      if (orderText.includes(searchTerm)) return true;

      // Search in items within the order
      const orderRows = rowsByOrder.get(order.order) || [];
      return orderRows.some(row => {
        const itemName = String(row.__item || row[state.mapping.item] || row.item || '').toLowerCase();
        return itemName.includes(searchTerm);
      });
    });
  }

  // Add latest date to each order for sorting and display
  const ordersWithDates = orders.map(order => ({
    ...order,
    latestDate: getLatestDate(order.order),
    displayDate: getLatestDate(order.order) ? toPrettyDate(getLatestDate(order.order)) : 'No Date',
    margin: order.revenue ? ((order.profit / order.revenue) * 100) : 0
  }));

  // Store for export/print (with current filters applied)
  state.displayedOrders = ordersWithDates;

  // DEBUG: Log orders with missing dates
  const missingDateOrders = ordersWithDates.filter(o => o.displayDate === 'No Date');
  if (missingDateOrders.length > 0) {
    console.warn('[renderOrdersView] Orders with missing dates:', missingDateOrders.length, 'of', ordersWithDates.length);
    const samples = missingDateOrders.slice(0, 3);
    samples.forEach(o => {
      const orderRows = rowsByOrder.get(o.order) || [];
      console.warn('[renderOrdersView] Order', o.order, ':', {
        rowsFound: orderRows.length,
        firstRowDateIso: orderRows[0]?.__dateIso,
        firstRowDateCol: orderRows[0]?.[state.mapping.date],
        allDateIsos: orderRows.map(r => r.__dateIso)
      });
    });
  }

  const totals = orders.reduce((acc, order) => {
    acc.revenue += Number(order.revenue || 0);
    acc.profit += Number(order.profit || 0);
    return acc;
  }, { revenue: 0, profit: 0 });

  const totalOrdersCount = state.byOrder.length;
  const totalTransactions = state.rows?.length || 0;

  // Debug: log order vs transaction counts
  console.log('[renderOrdersView] Total transactions:', totalTransactions);
  console.log('[renderOrdersView] Distinct orders:', totalOrdersCount);
  console.log('[renderOrdersView] Avg transactions per order:', (totalTransactions / totalOrdersCount).toFixed(1));

  const isFiltered = orders.length !== totalOrdersCount || searchTerm;
  const summaryText = isFiltered
    ? `${formatNumber(orders.length)} of ${formatNumber(totalOrdersCount)} orders${searchTerm ? ` matching "${searchTerm}"` : ''} · Revenue ${formatCurrencyShort(totals.revenue)} · Profit ${formatCurrencyShort(totals.profit)}`
    : `${formatNumber(orders.length)} orders · Revenue ${formatCurrencyShort(totals.revenue)} · Profit ${formatCurrencyShort(totals.profit)}`;
  summaryEl.textContent = summaryText;

  renderSortableClickableTable(tableEl, ['order','date','client','staff','items','revenue','profit','margin'], ordersWithDates.map(order => ({
    order: order.order,
    date: order.latestDate, // Use ISO date for proper chronological sorting
    client: order.client || 'Unassigned',
    staff: order.staff || 'Unassigned',
    items: order.items || 0,
    revenue: order.revenue,
    profit: order.profit,
    margin: order.margin
  })), {
    defaultSort: { column: 'date', direction: 'desc' },
    clickableColumns: {
      order: 'showOrderDetails',  // Make order column clickable
      client: 'showClientDetails' // Make client column clickable
    }
  });
}

function renderClientTrackingView() {
  const summaryEl = qs('clientsSummary');
  const highlightsEl = qs('clientsHighlights');
  const tableEl = qs('clientTrackingTable');
  const searchInput = qs('clientsSearch');
  if (!summaryEl || !highlightsEl || !tableEl) return;

  // Setup live filtering for clients advanced filters (if any exist)
  setupClientsLiveFilters();

  if (!state.report || !state.byClient || !state.byClient.length) {
    summaryEl.textContent = state.report ? 'No client activity for the current filters.' : 'Upload data to view client performance.';
    highlightsEl.innerHTML = '';
    tableEl.innerHTML = '<div class="text-sm text-gray-500">No client data available.</div>';
    return;
  }

  // Search state restoration removed - inputs should start empty

  // Set up search event listener with state persistence
  if (searchInput && !searchInput.hasAttribute('data-listener')) {
    searchInput.setAttribute('data-listener', 'true');
    searchInput.addEventListener('input', () => {
      saveSearchState('clients', { search: searchInput.value });
      renderClientTrackingView();
    });
  }

  // Filter clients based on search term
  const searchTerm = (searchInput?.value || '').toLowerCase().trim();
  let clients = [...state.byClient];
  if (searchTerm) {
    clients = clients.filter(client => {
      const clientName = String(client.label || 'Unassigned').toLowerCase();
      return clientName.includes(searchTerm);
    });
  }

  const totalRevenue = clients.reduce((sum, c) => sum + Number(c.revenue || 0), 0);
  const totalOrders = clients.reduce((sum, c) => sum + Number(c.orders || 0), 0);
  const totalClients = state.byClient.length;
  const isFiltered = clients.length !== totalClients || searchTerm;

  const summaryText = isFiltered
    ? `${formatNumber(clients.length)} of ${formatNumber(totalClients)} clients${searchTerm ? ` matching "${searchTerm}"` : ''} · Revenue ${formatCurrencyShort(totalRevenue)}`
    : `${formatNumber(clients.length)} clients · Revenue ${formatCurrencyShort(totalRevenue)} · Avg Orders ${(totalOrders / (clients.length || 1)).toFixed(0)}`;
  summaryEl.textContent = summaryText;

  // Exclude "Windsor Cash" from top clients ranking
  const topClients = clients.filter(c => c.label !== 'Windsor Cash').slice(0, 5);
  highlightsEl.innerHTML = topClients.map((c, index) => `
    <div class="highlight-card rank-${index + 1} p-3 border app-border rounded-md">
      <div class="text-xs text-gray-500 truncate">${escapeHtml(c.label || 'Unassigned')}</div>
      <div class="text-sm font-semibold text-gray-900">${formatCurrencyShort(c.revenue)}</div>
      <div class="text-xs text-gray-500">Orders ${(c.orders || 0).toFixed(0)} · Margin ${formatPercentShort(c.margin)}</div>
    </div>
  `).join('');

  renderSortableClickableTable(tableEl, ['client','orders','quantity','revenue','cost','profit','margin'], clients.map(c => ({
    client: c.label || 'Unassigned',
    orders: c.orders,
    quantity: c.quantity,
    revenue: c.revenue,
    cost: c.cost,
    profit: c.profit,
    margin: c.margin
  })), {
    defaultSort: { column: 'revenue', direction: 'desc' },
    clickableColumns: {
      client: 'showClientDetails'  // Make client column clickable
    }
  });
}

function renderStaffTrackingView() {
  const summaryEl = qs('staffSummary');
  const highlightsEl = qs('staffHighlights');
  const tableEl = qs('staffTrackingTable');
  if (!summaryEl || !highlightsEl || !tableEl) return;

  // Setup live filtering for staff advanced filters (if any exist)
  setupStaffLiveFilters();

  if (!state.report || !state.byStaff || !state.byStaff.length) {
    summaryEl.textContent = state.report ? 'No staff activity for the current filters.' : 'Upload data to view staff performance.';
    highlightsEl.innerHTML = '';
    tableEl.innerHTML = '<div class="text-sm text-gray-500">No staff data available.</div>';
    return;
  }
  const staff = state.byStaff;
  const totalRevenue = staff.reduce((sum, s) => sum + Number(s.revenue || 0), 0);
  const totalOrders = staff.reduce((sum, s) => sum + Number(s.orders || 0), 0);
  summaryEl.textContent = `${formatNumber(staff.length)} staff · Revenue ${formatCurrencyShort(totalRevenue)} · Avg Orders ${(totalOrders / (staff.length || 1)).toFixed(0)}`;
  const topStaff = staff.slice(0, 3);
  highlightsEl.innerHTML = topStaff.map((s, index) => `
    <div class="highlight-card rank-${index + 1} p-3 border app-border rounded-md">
      <div class="text-xs text-gray-500 truncate">${escapeHtml(s.label || 'Unassigned')}</div>
      <div class="text-sm font-semibold text-gray-900">${formatCurrencyShort(s.revenue)}</div>
      <div class="text-xs text-gray-500">Orders ${(s.orders || 0).toFixed(0)} · Margin ${formatPercentShort(s.margin)}</div>
    </div>
  `).join('');
  renderSortableTable(tableEl, ['staff','orders','quantity','revenue','cost','profit','margin'], staff.map(s => ({
    staff: s.label || 'Unassigned',
    orders: s.orders,
    quantity: s.quantity,
    revenue: s.revenue,
    cost: s.cost,
    profit: s.profit,
    margin: s.margin
  })), {
    defaultSort: { column: 'revenue', direction: 'desc' }
  });
}

function renderItemTrackingView() {
  const summaryEl = qs('itemsSummary');
  const highlightsEl = qs('itemsHighlights');
  const tableEl = qs('itemTrackingTable');
  const searchInput = qs('itemsSearch');
  if (!summaryEl || !highlightsEl || !tableEl) return;

  // Setup live filtering for items advanced filters (if any exist)
  setupItemsLiveFilters();

  if (!state.report || !state.byItem || !state.byItem.length) {
    summaryEl.textContent = state.report ? 'No item performance data for the current filters.' : 'Upload data to view item trends.';
    highlightsEl.innerHTML = '';
    tableEl.innerHTML = '<div class="text-sm text-gray-500">No item data available.</div>';
    return;
  }

  // Search state restoration removed - inputs should start empty

  // Set up search event listener with state persistence
  if (searchInput && !searchInput.hasAttribute('data-listener')) {
    searchInput.setAttribute('data-listener', 'true');
    searchInput.addEventListener('input', () => {
      saveSearchState('items', { search: searchInput.value });
      renderItemTrackingView();
    });
  }

  // Filter items based on search term
  const searchTerm = (searchInput?.value || '').toLowerCase().trim();
  let items = [...state.byItem];
  if (searchTerm) {
    items = items.filter(item => {
      const itemName = String(item.item || 'Unassigned').toLowerCase();
      return itemName.includes(searchTerm);
    });
  }

  const totalRevenue = items.reduce((sum, item) => sum + Number(item.revenue || 0), 0);
  const totalItems = state.byItem.length;
  const isFiltered = items.length !== totalItems || searchTerm;

  const summaryText = isFiltered
    ? `${formatNumber(items.length)} of ${formatNumber(totalItems)} items${searchTerm ? ` matching "${searchTerm}"` : ''} · Revenue ${formatCurrencyShort(totalRevenue)}`
    : `${formatNumber(items.length)} items · Revenue ${formatCurrencyShort(totalRevenue)} · Top item ${escapeForText(items[0]?.item || 'Unassigned')} (${formatCurrencyShort(items[0]?.revenue || 0)})`;
  summaryEl.textContent = summaryText;

  const topItems = items.slice(0, 3);
  highlightsEl.innerHTML = topItems.map((item, index) => `
    <div class="highlight-card rank-${index + 1} p-3 border app-border rounded-md">
      <div class="text-xs text-gray-500 truncate">${escapeHtml(item.item || 'Unassigned')}</div>
      <div class="text-sm font-semibold text-gray-900">${formatCurrencyShort(item.revenue)}</div>
      <div class="text-xs text-gray-500">Quantity ${formatNumber(item.quantity)} · Margin ${formatPercentShort(item.margin)}</div>
    </div>
  `).join('');

  renderSortableTable(tableEl, ['item','quantity','revenue','cost','profit','margin'], items.map(item => ({
    item: item.item || 'Unassigned',
    quantity: item.quantity,
    revenue: item.revenue,
    cost: item.cost,
    profit: item.profit,
    margin: item.margin
  })), {
    defaultSort: { column: 'revenue', direction: 'desc' }
  });
}


function renderSettingsView() {
  if (state.rawInspector.rows.length && !state.rawInspector.loading) {
    renderRawDataInspectorTable(state.rawInspector.rows, state.mapping);
  } else if (!state.rawInspector.loading) {
    refreshRawDataInspector(false);
  }
}

async function refreshRawDataInspector(force = false) {
  if (state.rawInspector.loading) return;
  const summaryEl = qs('rawDataSummary');
  const wrap = qs('rawDataTableWrap');

  const recentlyLoaded = state.rawInspector.lastLoaded && (Date.now() - state.rawInspector.lastLoaded < 60000);
  if (!force && recentlyLoaded && state.rawInspector.rows.length) {
    renderRawDataInspectorTable(state.rawInspector.rows, state.mapping);
    return;
  }

  state.rawInspector.loading = true;
  if (summaryEl) summaryEl.textContent = 'Loading raw rows from storage...';
  if (wrap) wrap.innerHTML = '<div class="p-4 text-sm text-gray-500">Loading...</div>';

  try {
    const stored = await loadCsvData();
    const rows = stored?.rows || [];
    const mapping = stored?.mapping || state.mapping;
    state.rawInspector.rows = rows;
    state.rawInspector.lastLoaded = Date.now();
    state.rawInspector.error = null;
    renderRawDataInspectorTable(rows, mapping);
  } catch (err) {
    console.warn('[rawInspector] Failed to load raw data', err);
    state.rawInspector.error = err;
    if (summaryEl) {
      summaryEl.textContent = `Failed to load raw data: ${err?.message || err}`;
    }
    if (wrap) {
      wrap.innerHTML = '<div class="p-4 text-sm text-red-600">Unable to fetch raw data. Check console for details.</div>';
    }
    const missingEl = qs('rawDataMissing');
    if (missingEl) missingEl.classList.add('hidden');
  } finally {
    state.rawInspector.loading = false;
  }
}

function renderRawDataInspectorTable(rows, mapping = state.mapping) {
  const summaryEl = qs('rawDataSummary');
  const missingEl = qs('rawDataMissing');
  const wrap = qs('rawDataTableWrap');
  if (!wrap) return;

  const total = Array.isArray(rows) ? rows.length : 0;
  const lastLoaded = state.rawInspector.lastLoaded ? new Date(state.rawInspector.lastLoaded).toLocaleString() : 'never';
  const showing = Math.min(total, RAW_INSPECTOR_ROW_LIMIT);
  const missingHourTotal = Array.isArray(rows)
    ? rows.reduce((acc, row) => acc + (row && (row.__hour === null || row.__hour === undefined || row.__hour === '' || Number.isNaN(Number(row.__hour))) ? 1 : 0), 0)
    : 0;

  if (summaryEl) {
    summaryEl.textContent = total
      ? `${total.toLocaleString()} rows stored (showing first ${showing.toLocaleString()}). Missing __hour: ${missingHourTotal.toLocaleString()}. Hour offset applied: ${RAW_HOUR_OFFSET}. Last refresh ${lastLoaded}.`
      : 'No stored rows found. Upload a CSV and click Refresh to inspect the saved data.';
  }

  if (!total) {
    wrap.innerHTML = '<div class="p-4 text-sm text-gray-500">No raw data available.</div>';
    if (missingEl) missingEl.classList.add('hidden');
    return;
  }

  const slice = rows.slice(0, showing);
  const missingSample = slice.filter(row => row && (row.__hour === null || row.__hour === undefined || row.__hour === '' || Number.isNaN(Number(row.__hour))));
  if (missingEl) {
    if (missingSample.length) {
      const sampleList = missingSample.slice(0, 5).map((row, idx) => {
        const raw = row?.__dateRaw ?? '(missing __dateRaw)';
        const mappedVal = mapping?.date ? row?.[mapping.date] : undefined;
        const order = row?.__orderRaw ?? row?.__order ?? '';
        const parts = [
          `${idx + 1}. <code>${escapeHtml(String(raw))}</code>`
        ];
        if (mappedVal !== undefined) {
          parts.push(`-> <code>${escapeHtml(String(mappedVal))}</code>`);
        }
        if (order) {
          parts.push(`(order ${escapeHtml(String(order))})`);
        }
        return `<li class="py-0.5">${parts.join(' ')}</li>`;
      }).join('');
      missingEl.innerHTML = `<strong>${missingSample.length}</strong> of the first ${showing.toLocaleString()} rows are missing <code>__hour</code>.<ul class="mt-2 space-y-1">${sampleList}</ul>`;
      missingEl.classList.remove('hidden');
    } else {
      missingEl.classList.add('hidden');
      missingEl.innerHTML = '';
    }
  }

  wrap.innerHTML = '';

  const columns = [{ key: '__index', label: '#' }];
  if (mapping?.date) columns.push({ key: mapping.date, label: `CSV (${mapping.date})` });
  columns.push(
    { key: '__dateRaw', label: '__dateRaw' },
    { key: '__datePretty', label: '__datePretty' },
    { key: '__dateIso', label: '__dateIso' },
    { key: '__hourRaw', label: '__hourRaw' },
    { key: '__hour', label: '__hour' },
    { key: '__orderRaw', label: '__orderRaw' },
    { key: '__itemRaw', label: '__itemRaw' }
  );
  if (mapping?.item) columns.push({ key: mapping.item, label: `CSV (${mapping.item})` });
  columns.push(
    { key: '__revenue', label: '__revenue' },
    { key: '__client', label: '__client' },
    { key: '__staff', label: '__staff' }
  );

  const table = document.createElement('table');
  table.className = 'min-w-full text-xs border-collapse';
  const thead = document.createElement('thead');
  thead.className = 'bg-gray-50 text-gray-600';
  const headRow = document.createElement('tr');
  columns.forEach(col => {
    const th = document.createElement('th');
    th.className = 'px-3 py-2 font-semibold text-left whitespace-nowrap';
    th.textContent = col.label;
    headRow.appendChild(th);
  });
  const thJson = document.createElement('th');
  thJson.className = 'px-3 py-2 font-semibold text-left whitespace-nowrap';
  thJson.textContent = 'Row JSON';
  headRow.appendChild(thJson);
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  slice.forEach((row, idx) => {
    const tr = document.createElement('tr');
    tr.className = idx % 2 === 0 ? 'bg-white border-b border-gray-100' : 'bg-gray-50 border-b border-gray-100';

    columns.forEach(col => {
      const td = document.createElement('td');
      td.className = 'px-3 py-2 align-top whitespace-nowrap text-gray-800';
      let value;
      if (col.key === '__index') {
        value = idx + 1;
      } else {
        value = row ? row[col.key] : undefined;
      }

      if (col.key === '__hour') {
        const numVal = Number(value);
        if (value === null || value === undefined || value === '' || Number.isNaN(numVal)) {
          td.classList.add('text-red-600', 'font-semibold');
          td.textContent = value === null || value === undefined || value === '' ? 'n/a' : String(value);
        } else {
          td.textContent = numVal.toString();
        }
      } else if (value === null || value === undefined || value === '') {
        td.classList.add('text-gray-400');
        td.textContent = '';
      } else if (typeof value === 'number') {
        td.textContent = Number.isFinite(value) ? value.toString() : '';
      } else {
        const str = String(value);
        if (str.length > 64) {
          td.textContent = `${str.slice(0, 61)}…`;
          td.title = str;
        } else {
          td.textContent = str;
        }
      }

      if ((col.key === '__dateRaw' || col.key === '__dateIso' || col.key === '__datePretty' || col.key === mapping?.date) && value) {
        td.classList.add('font-mono');
      }
      tr.appendChild(td);
    });

    const tdJson = document.createElement('td');
    tdJson.className = 'px-3 py-2 align-top text-gray-600';
    const details = document.createElement('details');
    details.className = 'max-w-[260px]';
    const summary = document.createElement('summary');
    summary.className = 'cursor-pointer text-blue-600';
    summary.textContent = 'View';
    const pre = document.createElement('pre');
    pre.className = 'mt-1 bg-gray-100 rounded p-2 text-[10px] leading-snug overflow-x-auto max-h-40';
    pre.textContent = JSON.stringify(row, null, 2);
    details.appendChild(summary);
    details.appendChild(pre);
    tdJson.appendChild(details);
    tr.appendChild(tdJson);

    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  wrap.appendChild(table);
}

async function copyRawDataSample() {
  if (!state.rawInspector.rows.length) {
    alert('No raw data loaded yet. Click Refresh first.');
    return;
  }

  const sample = state.rawInspector.rows.slice(0, 20);
  const json = JSON.stringify(sample, null, 2);
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(json);
      alert('Copied the first 20 rows to the clipboard.');
    } else {
      throw new Error('Clipboard API not available');
    }
  } catch (err) {
    console.warn('[rawInspector] Clipboard copy failed, showing prompt fallback', err);
    try {
      window.prompt('Copy sample JSON manually:', json);
    } catch (promptErr) {
      console.warn('[rawInspector] Prompt fallback failed', promptErr);
    }
  }
}

function isSettingsViewActive() {
  const el = document.getElementById('view-settings');
  return !!(el && !el.classList.contains('hidden'));
}


async function loadHistory() {
  const listEl = qs('historyList');
  listEl.innerHTML = '<div class="text-sm text-gray-600">Loading…</div>';
  const items = await listReports();
  if (!items || !items.length) { listEl.innerHTML = '<div class="text-sm text-gray-600">No saved reports.</div>'; return; }
  listEl.innerHTML = '';
  items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'py-3 flex items-center justify-between';
    const left = document.createElement('div');
    left.innerHTML = `<div class="font-medium text-sm">${item.name || 'Untitled report'}</div>
      <div class="text-xs text-gray-500">${new Date(item.ts.toMillis ? item.ts.toMillis() : item.ts).toLocaleString()}</div>`;
    const right = document.createElement('div');
    right.className = 'flex gap-2';
    const btnView = document.createElement('button'); btnView.className='px-3 py-1.5 border rounded-md text-sm'; btnView.textContent='Load';
    btnView.onclick = async () => {
      const doc = await loadReport(item.id);
      if (!doc) return alert('Could not load.');
      state.mapping = doc.mapping; state.report = { totals: doc.totals, byItem: doc.byItem, byDate: doc.byDate };
      renderReport(); location.hash = '#/report';
    };
    const btnDel = document.createElement('button'); btnDel.className='px-3 py-1.5 border rounded-md text-sm'; btnDel.textContent='Delete';
    btnDel.onclick = async () => { if (!confirm('Delete this report?')) return; await deleteReport(item.id); await loadHistory(); };
    right.appendChild(btnView); right.appendChild(btnDel);
    row.appendChild(left); row.appendChild(right);
    listEl.appendChild(row);
  });
}

// Expose for debugging and click handlers
window.__appState = state;
window.__testFirebaseSettings = testFirebaseSettings;
window.showClientDetails = showClientDetails;
window.showOrderDetails = showOrderDetails;

function applyFilters(rows, mapping, filters) {
  const start = filters.start || '';
  const end = filters.end || '';
  const itemQ = (filters.item || '').toLowerCase();
  return rows.filter(r => {
    let ok = true;
    if (start || end) {
      const iso = r.__dateIso || '';
      if (!iso) return false;
      if (start && iso < start) ok = false;
      if (end && iso > end) ok = false;
    }
    if (itemQ) {
      const it = (r.__item || r[mapping.item] || '').toString().toLowerCase();
      if (!it.includes(itemQ)) ok = false;
    }
    if (filters.client) {
      const v = (r.__client || '').toString().toLowerCase(); if (!v.includes(filters.client.toLowerCase())) ok = false;
    }
    if (filters.staff) {
      const v = (r.__staff || '').toString().toLowerCase(); if (!v.includes(filters.staff.toLowerCase())) ok = false;
    }
    if (filters.order) {
      const v = (r.__order || '').toString().toLowerCase(); if (!v.includes(filters.order.toLowerCase())) ok = false;
    }
    if (filters.category) {
      const v = (r.__category || (mapping.category ? r[mapping.category] : '') || '').toString().toLowerCase();
      if (!v.includes(filters.category.toLowerCase())) ok = false;
    }
    const rev = Number(r.__revenue || 0); const qty = Number(r.__quantity || 0);
    if (filters.revMin && rev < Number(filters.revMin)) ok = false;
    if (filters.revMax && rev > Number(filters.revMax)) ok = false;
    if (filters.qtyMin && qty < Number(filters.qtyMin)) ok = false;
    if (filters.qtyMax && qty > Number(filters.qtyMax)) ok = false;
    if (filters.noZero && (rev === 0 || qty === 0)) ok = false;
    return ok;
  });
}

function restoreFilterUI() {
  // Try to load from localStorage first (more recent state)
  const localFilters = loadFilterState('dashboard');
  const fs = localFilters || state.filters;

  // Update state.filters if we loaded from localStorage
  if (localFilters) {
    state.filters = { ...state.filters, ...localFilters };
  }
  const st = qs('filterStart'); if (st && fs.start) st.value = fs.start;
  const en = qs('filterEnd'); if (en && fs.end) en.value = fs.end;
  const it = qs('filterItem'); if (it && fs.item) it.value = fs.item;
  const fClient = qs('filterClient'); if (fClient && fs.client) fClient.value = fs.client;
  const fStaff = qs('filterStaff'); if (fStaff && fs.staff) fStaff.value = fs.staff;
  const fOrder = qs('filterOrder'); if (fOrder && fs.order) fOrder.value = fs.order;
  const fCat = qs('filterCategory'); if (fCat && fs.category) fCat.value = fs.category;
  const fRevMin = qs('filterRevMin'); if (fRevMin && fs.revMin) fRevMin.value = fs.revMin;
  const fRevMax = qs('filterRevMax'); if (fRevMax && fs.revMax) fRevMax.value = fs.revMax;
  const fQtyMin = qs('filterQtyMin'); if (fQtyMin && fs.qtyMin) fQtyMin.value = fs.qtyMin;
  const fQtyMax = qs('filterQtyMax'); if (fQtyMax && fs.qtyMax) fQtyMax.value = fs.qtyMax;
  const fNoZero = qs('filterNoZero'); if (fNoZero) fNoZero.checked = !!fs.noZero;
}

function restoreCustomChartPrefs(prefs) {
  const groupBy = qs('customGroupBy'); if (groupBy && prefs.groupBy) groupBy.value = prefs.groupBy;
  const granularity = qs('customGranularity'); if (granularity && prefs.granularity) granularity.value = prefs.granularity;
  const metric = qs('customMetric'); if (metric && prefs.metric) metric.value = prefs.metric;
  const chartType = qs('customChartType'); if (chartType && prefs.chartType) chartType.value = prefs.chartType;
}

async function saveCustomChartPrefs() {
  const prefs = {
    groupBy: qs('customGroupBy')?.value || 'date',
    granularity: qs('customGranularity')?.value || 'month',
    metric: qs('customMetric')?.value || 'revenue',
    chartType: qs('customChartType')?.value || 'line'
  };
  try { await saveUserSettings('customChartPrefs', prefs); } catch {}
}

async function loadLastMapping() {
  try {
    const m = await import('./storage.js');
    return await m.loadUserSettings('mapping');
  } catch {}
  return null;
}

async function saveLastMapping(mapping) {
  try {
    const m = await import('./storage.js');
    await m.saveUserSettings('mapping', mapping);
  } catch {}
}

function printCurrentView() {
  console.log('[printCurrentView] Starting print process');

  // Find the current active view (the one that's not hidden)
  const currentView = document.querySelector('.view:not(.hidden)');
  console.log('[printCurrentView] Current view:', currentView?.id);

  if (!currentView) {
    console.warn('[printCurrentView] No active view found');
    window.print();
    return;
  }

  // Determine if landscape orientation is needed (only for overview pages)
  const landscapeViews = ['view-clients', 'view-items', 'view-staff', 'view-orders'];
  const needsLandscape = landscapeViews.includes(currentView.id);

  // Inject dynamic print style for orientation
  let printStyleEl = null;
  if (needsLandscape) {
    printStyleEl = document.createElement('style');
    printStyleEl.id = 'dynamic-print-orientation';
    printStyleEl.textContent = '@media print { @page { size: landscape; margin: 0.3in; } }';
    document.head.appendChild(printStyleEl);
  }

  // Get all views and temporarily add 'hidden' class to non-current views
  const allViews = document.querySelectorAll('.view');
  const viewsToHide = Array.from(allViews).filter(v => v !== currentView && !v.classList.contains('hidden'));

  console.log('[printCurrentView] Hiding views:', viewsToHide.map(v => v.id));
  console.log('[printCurrentView] Landscape mode:', needsLandscape);

  // Temporarily hide other views for print
  viewsToHide.forEach(view => view.classList.add('hidden'));

  const done = () => {
    window.removeEventListener('afterprint', done);
    // Restore hidden class states
    viewsToHide.forEach(view => view.classList.remove('hidden'));
    // Remove dynamic print style
    if (printStyleEl && printStyleEl.parentNode) {
      printStyleEl.parentNode.removeChild(printStyleEl);
    }
    console.log('[printCurrentView] Print cleanup complete');
  };

  window.addEventListener('afterprint', done);
  window.print();
}

function printAllViews() {
  // This function now calls printCurrentView for consistency
  printCurrentView();
}

function buildCustomChart(opts) {
  if (!state.rows.length) { alert('Upload and parse CSVs first.'); return; }
  const filtered = applyFilters(state.rows, state.mapping, state.filters);
  const canvas = document.getElementById('customChart');
  if (state.customChart) { state.customChart.destroy(); state.customChart = null; }
  if (opts.groupBy === 'date' && opts.stackCat) {
    if (!state.mapping.category) { alert('Select Category column to stack by category.'); return; }
    const { labels, datasets } = aggregateByCategoryOverTime(filtered, state.mapping, opts.granularity || 'month', opts.metric || 'revenue', Number(opts.topN||0));
    state.customChart = makeStackedBarChart(canvas, labels, datasets);
  } else {
    const data = aggregateCustom(filtered, state.mapping, opts);
    const labels = data.map(x => x.label);
    const series = data.map(x => opts.metric === 'quantity' ? x.quantity : x.revenue);
    state.customChart = makeChartTyped(canvas, opts.type || 'line', labels, series, `${opts.metric} by ${opts.groupBy}`);
  }
}

function buildCustomTable(opts) {
  if (!state.rows.length) { alert('Upload and parse CSVs first.'); return; }
  const filtered = applyFilters(state.rows, state.mapping, state.filters);
  const data = aggregateCustom(filtered, state.mapping, opts);
  const container = document.getElementById('customTable');
  const columns = (opts.groupBy === 'date') ? ['label','quantity','revenue'] : ['label','quantity','revenue'];
  renderTable(container, columns.map(c => (c==='label' ? (opts.groupBy==='date'?'date':'item') : c)), data.map(x => ({ ...(opts.groupBy==='date'?{date:x.label}:{item:x.label}), quantity:x.quantity, revenue:x.revenue })));
}

function exportCustomCsv() {
  const container = document.getElementById('customTable');
  if (!container || !container.querySelector('table')) { alert('Build the table first.'); return; }
  const rows = [];
  const headers = Array.from(container.querySelectorAll('thead th')).map(th => th.textContent.trim());
  const bodyRows = Array.from(container.querySelectorAll('tbody tr'));
  bodyRows.forEach(tr => {
    const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
    const obj = {}; headers.forEach((h,i)=> obj[h.toLowerCase()] = cells[i]); rows.push(obj);
  });
  downloadCsv('custom_report.csv', headers, rows);
}

// Enhanced Report Builder
function generateAdvancedReport() {
  if (!state.rows || !state.rows.length) {
    alert('Please upload data first.');
    return;
  }

  const reportType = qs('reportType')?.value || 'item';
  const startDate = qs('reportStartDate')?.value || '';
  const endDate = qs('reportEndDate')?.value || '';
  const itemFilter = qs('reportItemFilter')?.value || '';
  const clientFilter = qs('reportClientFilter')?.value || '';
  const staffFilter = qs('reportStaffFilter')?.value || '';
  const categoryFilter = qs('reportCategoryFilter')?.value || '';
  const sortBy = qs('reportSortBy')?.value || 'revenue';
  const limitValue = qs('reportLimit')?.value || '';
  const limit = limitValue ? parseInt(limitValue, 10) : 0;

  // Get selected columns
  const columns = [];
  const columnMap = {
    colItem: 'name',
    colQuantity: 'quantity',
    colRevenue: 'revenue',
    colCost: 'cost',
    colProfit: 'profit',
    colMargin: 'margin',
    colOrders: 'orders',
    colDate: 'date'
  };

  Object.keys(columnMap).forEach(id => {
    const checkbox = qs(id);
    if (checkbox && checkbox.checked) {
      columns.push(columnMap[id]);
    }
  });

  if (columns.length === 0) {
    alert('Please select at least one column to display.');
    return;
  }

  // Filter data
  let filteredRows = [...state.rows];

  // Date range filter - FIXED: Only filter if dates are provided
  if (startDate || endDate) {
    filteredRows = filteredRows.filter(row => {
      const dateIso = row.__dateIso || '';
      if (!dateIso) return false;
      if (startDate && dateIso < startDate) return false;
      if (endDate && dateIso > endDate) return false;
      return true;
    });
  }

  // Item filter
  if (itemFilter) {
    const items = itemFilter.split(',').map(s => s.trim().toLowerCase()).filter(s => s);
    filteredRows = filteredRows.filter(row => {
      const itemName = String(row.__item || row[state.mapping.item] || '').toLowerCase();
      return items.some(filterItem => itemName.includes(filterItem));
    });
  }

  // Client filter
  if (clientFilter) {
    filteredRows = filteredRows.filter(row => {
      const client = row.__client || '';
      return client === clientFilter;
    });
  }

  // Staff filter
  if (staffFilter) {
    filteredRows = filteredRows.filter(row => {
      const staff = row.__staff || '';
      return staff === staffFilter;
    });
  }

  // Category filter
  if (categoryFilter) {
    filteredRows = filteredRows.filter(row => {
      const category = row.__category || '';
      return category === categoryFilter;
    });
  }

  // Aggregate based on report type
  let data = [];
  switch (reportType) {
    case 'item':
      data = aggregateByField(filteredRows, r => {
        const val = r[state.mapping.item];
        return val ? String(val).trim() : '';
      });
      // Exclude Freight from item reports
      data = data.filter(item => {
        const name = (item.label || '').toLowerCase();
        return !name.includes('freight');
      });
      break;
    case 'order':
      data = aggregateByOrder(filteredRows, state.mapping);
      data = data.map(x => ({ ...x, name: x.order }));
      break;
    case 'client':
      data = aggregateByField(filteredRows, r => {
        const val = r.__client;
        return (val && val !== 'undefined' && String(val).trim() !== '') ? val : '';
      });
      break;
    case 'staff':
      data = aggregateByField(filteredRows, r => {
        const val = r.__staff;
        return (val && val !== 'undefined' && String(val).trim() !== '') ? val : '';
      });
      break;
    case 'category':
      data = aggregateByField(filteredRows, r => {
        const val = r.__category;
        return (val && val !== 'undefined' && String(val).trim() !== '') ? val : '';
      });
      break;
  }

  // Map label to name for consistency
  data = data.map(item => ({
    ...item,
    name: item.name || item.label || item.order || '-'
  }));

  // Sort data
  data.sort((a, b) => {
    if (sortBy === 'name') {
      return (a.name || '').toString().localeCompare((b.name || '').toString());
    } else {
      // Numeric sorts - highest first
      const aVal = Number(a[sortBy]) || 0;
      const bVal = Number(b[sortBy]) || 0;
      return bVal - aVal;
    }
  });

  // Limit results if specified
  if (limit > 0 && data.length > limit) {
    data = data.slice(0, limit);
  }

  // Build table with selected columns
  const container = qs('customTable');
  if (!container) return;

  renderSortableTable(container, columns, data, { defaultSort: { column: sortBy, direction: sortBy === 'name' ? 'asc' : 'desc' } });

  // Capture report data for snapshotting
  currentReportData = {
    config: {
      reportType,
      startDate,
      endDate,
      itemFilter,
      clientFilter,
      staffFilter,
      categoryFilter,
      sortBy,
      limit
    },
    tableData: data,
    columns: columns
  };

  // Show snapshot button
  const snapshotBtn = qs('btnSaveSnapshot');
  if (snapshotBtn) snapshotBtn.classList.remove('hidden');
}

function populateReportFilters() {
  if (!state.rows || !state.rows.length) return;

  // Populate client filter
  const clientSelect = qs('reportClientFilter');
  if (clientSelect && state.byClient) {
    clientSelect.innerHTML = '<option value="">All Clients</option>' +
      state.byClient.map(c => `<option value="${escapeHtml(c.label)}">${escapeHtml(c.label)}</option>`).join('');
  }

  // Populate staff filter
  const staffSelect = qs('reportStaffFilter');
  if (staffSelect && state.byStaff) {
    staffSelect.innerHTML = '<option value="">All Staff</option>' +
      state.byStaff.map(s => `<option value="${escapeHtml(s.label)}">${escapeHtml(s.label)}</option>`).join('');
  }

  // Populate category filter
  const categorySelect = qs('reportCategoryFilter');
  if (categorySelect) {
    // Get unique categories from data directly
    const categories = [...new Set(state.rows.map(r => r.__category).filter(c => c && c !== 'undefined' && c !== 'Uncategorized'))].sort();
    console.log('[populateReportFilters] Categories found:', categories.length, categories.slice(0, 10));
    categorySelect.innerHTML = '<option value="">All Categories</option>' +
      categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  }
}

function clearReportFilters() {
  // Clear hidden date inputs
  qs('reportStartDate').value = '';
  qs('reportEndDate').value = '';

  // Clear Flatpickr date range picker
  const dateRangeInput = qs('reportDateRange');
  if (dateRangeInput && dateRangeInput._flatpickr) {
    dateRangeInput._flatpickr.clear();
  }

  qs('reportItemFilter').value = '';
  qs('reportClientFilter').value = '';
  qs('reportStaffFilter').value = '';
  qs('reportCategoryFilter').value = '';
  qs('reportSortBy').value = 'revenue';
  qs('reportLimit').value = '';
  qs('customTable').innerHTML = '';

  // Hide snapshot button when table is cleared
  const snapshotBtn = qs('btnSaveSnapshot');
  if (snapshotBtn) snapshotBtn.classList.add('hidden');
}

// ============================================
// REPORT SNAPSHOTS
// ============================================

let currentReportData = null; // Store current report data for snapshotting

function saveReportSnapshot() {
  if (!currentReportData || !currentReportData.tableData || currentReportData.tableData.length === 0) {
    alert('No report data to save. Please generate a report first.');
    return;
  }

  // Generate smart default name
  const config = currentReportData.config;
  const reportType = config?.reportType || 'Report';
  const reportTypeLabel = reportType.charAt(0).toUpperCase() + reportType.slice(1);

  // Build descriptive report title with sort/limit
  let reportTitle = '';
  const limit = config?.limit || 0;
  const sortBy = config?.sortBy || 'revenue';

  if (limit > 0) {
    // Has limit - format like "Top 40 Items by Revenue"
    const sortLabel = {
      'revenue': 'by Revenue',
      'quantity': 'by Quantity',
      'profit': 'by Profit',
      'margin': 'by Margin',
      'orders': 'by Orders',
      'name': 'Alphabetical'
    }[sortBy] || 'by Revenue';

    reportTitle = `Top ${limit} ${reportTypeLabel}s ${sortLabel}`;
  } else {
    // No limit - just "All Items by Revenue" or "Item Report"
    if (sortBy && sortBy !== 'revenue') {
      const sortLabel = {
        'quantity': 'by Quantity',
        'profit': 'by Profit',
        'margin': 'by Margin',
        'orders': 'by Orders',
        'name': 'Alphabetical'
      }[sortBy] || '';
      reportTitle = `All ${reportTypeLabel}s ${sortLabel}`;
    } else {
      reportTitle = `${reportTypeLabel} Report`;
    }
  }

  // Format date range
  let dateRangePart = '';
  if (config?.startDate || config?.endDate) {
    const formatDate = (dateStr) => {
      if (!dateStr) return '';
      // Parse as local date to avoid timezone shifts (e.g., 2025-09-01 should display as September, not August)
      const parts = dateStr.split('-');
      const year = parseInt(parts[0]);
      const month = parseInt(parts[1]) - 1; // JS months are 0-indexed
      const day = parseInt(parts[2] || 1);
      const d = new Date(year, month, day);
      return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    };

    if (config.startDate && config.endDate) {
      // Parse dates as local dates to avoid timezone shifts
      // Extract year and month from YYYY-MM-DD format
      const parseLocalDate = (dateStr) => {
        const parts = dateStr.split('-');
        return {
          year: parseInt(parts[0]),
          month: parseInt(parts[1]) - 1  // JS months are 0-indexed
        };
      };

      const start = parseLocalDate(config.startDate);
      const end = parseLocalDate(config.endDate);

      // Check if same month and year
      const sameMonth = start.year === end.year && start.month === end.month;

      if (sameMonth) {
        // Same month - just show month/year once
        dateRangePart = ` - ${formatDate(config.startDate)}`;
      } else {
        // Different months - show range
        const startFormatted = formatDate(config.startDate);
        const endFormatted = formatDate(config.endDate);
        dateRangePart = ` - ${startFormatted} to ${endFormatted}`;
      }
    } else if (config.startDate) {
      dateRangePart = ` - From ${formatDate(config.startDate)}`;
    } else if (config.endDate) {
      dateRangePart = ` - Until ${formatDate(config.endDate)}`;
    }
  } else {
    // No date filter - use "All Time"
    dateRangePart = ' - All Time';
  }

  // Add filter context if present
  const filters = [];
  if (config?.clientFilter) filters.push(config.clientFilter);
  if (config?.categoryFilter) filters.push(config.categoryFilter);
  const filterPart = filters.length > 0 ? ` (${filters.join(', ')})` : '';

  const defaultName = `${reportTitle}${dateRangePart}${filterPart}`;

  const name = prompt('Enter a name for this report snapshot:', defaultName);
  if (!name || !name.trim()) return;

  const snapshot = {
    id: Date.now(),
    name: name.trim(),
    savedAt: new Date().toISOString(),
    config: currentReportData.config,
    tableData: currentReportData.tableData,
    columns: currentReportData.columns
  };

  // Get existing snapshots
  let snapshots = [];
  try {
    const stored = localStorage.getItem('reportSnapshots');
    if (stored) snapshots = JSON.parse(stored);
  } catch (e) {
    console.error('Error loading snapshots:', e);
  }

  // Add new snapshot
  snapshots.push(snapshot);

  // Save back to localStorage
  try {
    localStorage.setItem('reportSnapshots', JSON.stringify(snapshots));
    alert(`Report snapshot "${name}" saved successfully!`);
    populateSnapshotsList();
  } catch (e) {
    console.error('Error saving snapshot:', e);
    alert('Failed to save snapshot. Storage might be full.');
  }
}

function populateSnapshotsList() {
  const list = qs('snapshotsList');
  if (!list) return;

  // Get snapshots
  let snapshots = [];
  try {
    const stored = localStorage.getItem('reportSnapshots');
    if (stored) snapshots = JSON.parse(stored);
  } catch (e) {
    console.error('Error loading snapshots:', e);
  }

  if (snapshots.length === 0) {
    list.innerHTML = '<p class="text-sm text-gray-500 text-center py-4">No saved snapshots yet</p>';
    return;
  }

  // Sort by date (newest first)
  snapshots.sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt));

  list.innerHTML = snapshots.map(snapshot => {
    const date = new Date(snapshot.savedAt);
    const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    const rowCount = snapshot.tableData?.length || 0;

    return `
      <div class="flex items-center justify-between p-3 bg-white rounded border hover:border-blue-400">
        <div class="flex-1">
          <div class="text-sm font-medium">${escapeHtml(snapshot.name)}</div>
          <div class="text-xs text-gray-500">Saved: ${dateStr} • ${rowCount} rows • ${snapshot.config?.reportType || 'unknown'} report</div>
        </div>
        <div class="flex gap-2">
          <button class="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 btn-view-snapshot" data-snapshot-id="${snapshot.id}">View</button>
          <button class="px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 btn-print-snapshot" data-snapshot-id="${snapshot.id}">Print</button>
          <button class="px-3 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700 btn-delete-snapshot" data-snapshot-id="${snapshot.id}">Delete</button>
        </div>
      </div>
    `;
  }).join('');

  // Add click handlers
  list.querySelectorAll('.btn-view-snapshot').forEach(btn => {
    btn.addEventListener('click', () => viewSnapshot(parseInt(btn.dataset.snapshotId)));
  });

  list.querySelectorAll('.btn-print-snapshot').forEach(btn => {
    btn.addEventListener('click', () => printSnapshot(parseInt(btn.dataset.snapshotId)));
  });

  list.querySelectorAll('.btn-delete-snapshot').forEach(btn => {
    btn.addEventListener('click', () => deleteSnapshot(parseInt(btn.dataset.snapshotId)));
  });
}

function viewSnapshot(snapshotId) {
  console.log('[viewSnapshot] Called with ID:', snapshotId);

  let snapshots = [];
  try {
    const stored = localStorage.getItem('reportSnapshots');
    if (stored) snapshots = JSON.parse(stored);
  } catch (e) {
    console.error('Error loading snapshots:', e);
    return;
  }

  const snapshot = snapshots.find(s => s.id === snapshotId);
  if (!snapshot) {
    console.error('[viewSnapshot] Snapshot not found with ID:', snapshotId);
    alert('Snapshot not found.');
    return;
  }

  console.log('[viewSnapshot] Found snapshot:', snapshot.name);

  // Open modal and populate it
  const modal = qs('snapshotViewerModal');
  const title = qs('snapshotViewerTitle');
  const meta = qs('snapshotViewerMeta');
  const content = qs('snapshotViewerContent');

  if (!modal || !title || !meta || !content) {
    console.error('[viewSnapshot] Modal elements not found:', { modal: !!modal, title: !!title, meta: !!meta, content: !!content });
    return;
  }

  // Set title
  title.textContent = snapshot.name;

  // Build metadata string
  const date = new Date(snapshot.savedAt);
  meta.textContent = `Saved: ${date.toLocaleDateString()} ${date.toLocaleTimeString()} • ${snapshot.tableData.length} rows`;

  // Render table in modal
  renderSortableTable(content, snapshot.columns, snapshot.tableData, {
    defaultSort: { column: snapshot.config?.sortBy || 'revenue', direction: 'desc' }
  });

  // Store snapshot ID for print button
  modal.dataset.snapshotId = snapshotId;

  // Show modal - use display style instead of class
  modal.style.display = 'block';
  modal.classList.remove('hidden');
  console.log('[viewSnapshot] Modal should now be visible, display:', modal.style.display);
}

function printSnapshot(snapshotId) {
  let snapshots = [];
  try {
    const stored = localStorage.getItem('reportSnapshots');
    if (stored) snapshots = JSON.parse(stored);
  } catch (e) {
    console.error('Error loading snapshots:', e);
    return;
  }

  const snapshot = snapshots.find(s => s.id === snapshotId);
  if (!snapshot) {
    alert('Snapshot not found.');
    return;
  }

  // Create a print-friendly page
  const printWindow = window.open('', '_blank');
  const date = new Date(snapshot.savedAt);

  // Build table HTML
  const tableHTML = `
    <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
      <thead>
        <tr style="background-color: #f3f4f6;">
          ${snapshot.columns.map(col => `<th style="border: 1px solid #d1d5db; padding: 8px; text-align: left;">${col}</th>`).join('')}
        </tr>
      </thead>
      <tbody>
        ${snapshot.tableData.map(row => `
          <tr>
            ${snapshot.columns.map(col => {
              const val = row[col];
              const formatted = typeof val === 'number' ? val.toLocaleString() : (val || '-');
              return `<td style="border: 1px solid #d1d5db; padding: 8px;">${formatted}</td>`;
            }).join('')}
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>${snapshot.name}</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        h1 { font-size: 18px; margin-bottom: 10px; }
        .meta { font-size: 12px; color: #666; margin-bottom: 20px; }
        @media print {
          body { margin: 10px; }
        }
      </style>
    </head>
    <body>
      <h1>${snapshot.name}</h1>
      <div class="meta">
        <div>Saved: ${date.toLocaleDateString()} ${date.toLocaleTimeString()} • ${snapshot.tableData.length} rows</div>
      </div>
      ${tableHTML}
    </body>
    </html>
  `);

  printWindow.document.close();
  setTimeout(() => {
    printWindow.print();
  }, 250);
}

function deleteSnapshot(snapshotId) {
  let snapshots = [];
  try {
    const stored = localStorage.getItem('reportSnapshots');
    if (stored) snapshots = JSON.parse(stored);
  } catch (e) {
    console.error('Error loading snapshots:', e);
    return;
  }

  const snapshot = snapshots.find(s => s.id === snapshotId);
  if (!snapshot) {
    alert('Snapshot not found.');
    return;
  }

  if (!confirm(`Are you sure you want to delete the snapshot "${snapshot.name}"?`)) {
    return;
  }

  // Remove snapshot
  snapshots = snapshots.filter(s => s.id !== snapshotId);

  try {
    localStorage.setItem('reportSnapshots', JSON.stringify(snapshots));
    alert('Snapshot deleted successfully!');
    populateSnapshotsList();
  } catch (e) {
    console.error('Error deleting snapshot:', e);
    alert('Failed to delete snapshot.');
  }
}

// Save/Load/Delete Report Configurations
function saveReportConfiguration() {
  const reportName = prompt('Enter a name for this report configuration:');
  if (!reportName || !reportName.trim()) return;

  const config = {
    name: reportName.trim(),
    reportType: qs('reportType')?.value || 'item',
    startDate: qs('reportStartDate')?.value || '',
    endDate: qs('reportEndDate')?.value || '',
    itemFilter: qs('reportItemFilter')?.value || '',
    clientFilter: qs('reportClientFilter')?.value || '',
    staffFilter: qs('reportStaffFilter')?.value || '',
    categoryFilter: qs('reportCategoryFilter')?.value || '',
    sortBy: qs('reportSortBy')?.value || 'revenue',
    limit: qs('reportLimit')?.value || '',
    columns: {
      item: qs('colItem')?.checked || false,
      quantity: qs('colQuantity')?.checked || false,
      revenue: qs('colRevenue')?.checked || false,
      cost: qs('colCost')?.checked || false,
      profit: qs('colProfit')?.checked || false,
      margin: qs('colMargin')?.checked || false,
      orders: qs('colOrders')?.checked || false,
      date: qs('colDate')?.checked || false
    },
    savedAt: new Date().toISOString()
  };

  // Get existing saved reports
  let savedReports = [];
  try {
    const stored = localStorage.getItem('savedReportConfigs');
    if (stored) savedReports = JSON.parse(stored);
  } catch (e) {
    console.error('Error loading saved reports:', e);
  }

  // Add new config
  savedReports.push(config);

  // Save back to localStorage
  try {
    localStorage.setItem('savedReportConfigs', JSON.stringify(savedReports));
    alert(`Report configuration "${reportName}" saved successfully!`);
    populateSavedReportsDropdown();
  } catch (e) {
    console.error('Error saving report config:', e);
    alert('Failed to save report configuration. Storage might be full.');
  }
}

function loadReportConfiguration() {
  const dropdown = qs('savedReportsDropdown');
  if (!dropdown || !dropdown.value) {
    alert('Please select a report or template to load.');
    return;
  }

  const reportName = dropdown.value;

  // Try to find in saved reports first
  let savedReports = [];
  try {
    const stored = localStorage.getItem('savedReportConfigs');
    if (stored) savedReports = JSON.parse(stored);
  } catch (e) {
    console.error('Error loading saved reports:', e);
  }

  let config = savedReports.find(r => r.name === reportName);

  // If not found in saved reports, check templates
  if (!config) {
    const templates = getTemplateDefinitions();
    config = templates.find(t => t.name === reportName);
  }

  if (!config) {
    alert('Report configuration not found.');
    return;
  }

  // Load configuration into UI
  if (qs('reportType')) qs('reportType').value = config.reportType || 'item';
  if (qs('reportStartDate')) qs('reportStartDate').value = config.startDate || '';
  if (qs('reportEndDate')) qs('reportEndDate').value = config.endDate || '';
  if (qs('reportItemFilter')) qs('reportItemFilter').value = config.itemFilter || '';
  if (qs('reportClientFilter')) qs('reportClientFilter').value = config.clientFilter || '';
  if (qs('reportStaffFilter')) qs('reportStaffFilter').value = config.staffFilter || '';
  if (qs('reportCategoryFilter')) qs('reportCategoryFilter').value = config.categoryFilter || '';
  if (qs('reportSortBy')) qs('reportSortBy').value = config.sortBy || 'revenue';
  if (qs('reportLimit')) qs('reportLimit').value = config.limit || '';

  // Load column selections
  if (config.columns) {
    if (qs('colItem')) qs('colItem').checked = config.columns.item !== false;
    if (qs('colQuantity')) qs('colQuantity').checked = config.columns.quantity !== false;
    if (qs('colRevenue')) qs('colRevenue').checked = config.columns.revenue !== false;
    if (qs('colCost')) qs('colCost').checked = config.columns.cost !== false;
    if (qs('colProfit')) qs('colProfit').checked = config.columns.profit !== false;
    if (qs('colMargin')) qs('colMargin').checked = config.columns.margin !== false;
    if (qs('colOrders')) qs('colOrders').checked = config.columns.orders === true;
    if (qs('colDate')) qs('colDate').checked = config.columns.date === true;
  }

  // Generate the report automatically
  generateAdvancedReport();
}

function deleteReportConfiguration() {
  const dropdown = qs('savedReportsDropdown');
  if (!dropdown || !dropdown.value) {
    alert('Please select a saved report to delete.');
    return;
  }

  const reportName = dropdown.value;

  // Get saved reports
  let savedReports = [];
  try {
    const stored = localStorage.getItem('savedReportConfigs');
    if (stored) savedReports = JSON.parse(stored);
  } catch (e) {
    console.error('Error loading saved reports:', e);
    return;
  }

  // Check if this is a user-saved report (not a built-in template)
  const isSavedReport = savedReports.some(r => r.name === reportName);
  if (!isSavedReport) {
    alert('Cannot delete built-in templates. You can only delete your saved reports.');
    return;
  }

  if (!confirm(`Are you sure you want to delete the report configuration "${reportName}"?`)) {
    return;
  }

  // Remove the selected report
  savedReports = savedReports.filter(r => r.name !== reportName);

  // Save back
  try {
    localStorage.setItem('savedReportConfigs', JSON.stringify(savedReports));
    alert(`Report configuration "${reportName}" deleted successfully!`);
    populateSavedReportsDropdown();
  } catch (e) {
    console.error('Error saving after delete:', e);
    alert('Failed to delete report configuration.');
  }
}

function editReportConfiguration() {
  const dropdown = qs('savedReportsDropdown');
  if (!dropdown || !dropdown.value) {
    alert('Please select a report or template to edit.');
    return;
  }

  const reportName = dropdown.value;

  // Try to find in saved reports first
  let savedReports = [];
  try {
    const stored = localStorage.getItem('savedReportConfigs');
    if (stored) savedReports = JSON.parse(stored);
  } catch (e) {
    console.error('Error loading saved reports:', e);
  }

  let config = savedReports.find(r => r.name === reportName);
  let isTemplate = false;

  // If not found in saved reports, check templates
  if (!config) {
    const templates = getTemplateDefinitions();
    config = templates.find(t => t.name === reportName);
    isTemplate = true;
  }

  if (!config) {
    alert('Report configuration not found.');
    return;
  }

  // Load configuration into UI (same as load)
  if (qs('reportType')) qs('reportType').value = config.reportType || 'item';
  if (qs('reportStartDate')) qs('reportStartDate').value = config.startDate || '';
  if (qs('reportEndDate')) qs('reportEndDate').value = config.endDate || '';
  if (qs('reportItemFilter')) qs('reportItemFilter').value = config.itemFilter || '';
  if (qs('reportClientFilter')) qs('reportClientFilter').value = config.clientFilter || '';
  if (qs('reportStaffFilter')) qs('reportStaffFilter').value = config.staffFilter || '';
  if (qs('reportCategoryFilter')) qs('reportCategoryFilter').value = config.categoryFilter || '';
  if (qs('reportSortBy')) qs('reportSortBy').value = config.sortBy || 'revenue';
  if (qs('reportLimit')) qs('reportLimit').value = config.limit || '';

  if (config.columns) {
    if (qs('colItem')) qs('colItem').checked = config.columns.item !== false;
    if (qs('colQuantity')) qs('colQuantity').checked = config.columns.quantity !== false;
    if (qs('colRevenue')) qs('colRevenue').checked = config.columns.revenue !== false;
    if (qs('colCost')) qs('colCost').checked = config.columns.cost !== false;
    if (qs('colProfit')) qs('colProfit').checked = config.columns.profit !== false;
    if (qs('colMargin')) qs('colMargin').checked = config.columns.margin !== false;
    if (qs('colOrders')) qs('colOrders').checked = config.columns.orders === true;
    if (qs('colDate')) qs('colDate').checked = config.columns.date === true;
  }

  // Delete the old version (only if it's a saved report, not a template)
  if (!isTemplate) {
    savedReports = savedReports.filter(r => r.name !== reportName);
    try {
      localStorage.setItem('savedReportConfigs', JSON.stringify(savedReports));
      populateSavedReportsDropdown();
    } catch (e) {
      console.error('Error updating saved reports:', e);
    }
    alert(`Report "${reportName}" loaded for editing. Modify the settings and click "Save Report Config" to save your changes.`);
  } else {
    alert(`Template "${reportName}" loaded. Modify the settings and click "Save Report Config" to save as a new report.`);
  }
}

function loadReportTemplates() {
  const currentYear = new Date().getFullYear();
  const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');
  const last30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const last90Days = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const templates = [
    // ============================================
    // YTD REPORTS (Year-to-Date)
    // ============================================
    {
      name: "[YTD] Revenue by Item",
      reportType: "item",
      startDate: `${currentYear}-01-01`,
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: false, profit: true, margin: true, orders: false, date: false }
    },
    {
      name: "[YTD] Revenue by Client",
      reportType: "client",
      startDate: `${currentYear}-01-01`,
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: false, revenue: true, cost: false, profit: true, margin: true, orders: true, date: false }
    },
    {
      name: "[YTD] Revenue by Staff",
      reportType: "staff",
      startDate: `${currentYear}-01-01`,
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: false, revenue: true, cost: false, profit: true, margin: true, orders: true, date: false }
    },
    {
      name: "[YTD] Category Performance",
      reportType: "category",
      startDate: `${currentYear}-01-01`,
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false }
    },

    // ============================================
    // QUARTERLY REPORTS
    // ============================================
    {
      name: "[QUARTERLY] Q1 Performance by Item",
      reportType: "item",
      startDate: `${currentYear}-01-01`,
      endDate: `${currentYear}-03-31`,
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false }
    },
    {
      name: "[QUARTERLY] Q2 Performance by Item",
      reportType: "item",
      startDate: `${currentYear}-04-01`,
      endDate: `${currentYear}-06-30`,
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false }
    },
    {
      name: "[QUARTERLY] Q3 Performance by Item",
      reportType: "item",
      startDate: `${currentYear}-07-01`,
      endDate: `${currentYear}-09-30`,
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false }
    },
    {
      name: "[QUARTERLY] Q4 Performance by Item",
      reportType: "item",
      startDate: `${currentYear}-10-01`,
      endDate: `${currentYear}-12-31`,
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false }
    },

    // ============================================
    // MONTHLY REPORTS
    // ============================================
    {
      name: "[MONTHLY] This Month - All Items",
      reportType: "item",
      startDate: `${currentYear}-${currentMonth}-01`,
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false }
    },
    {
      name: "[MONTHLY] This Month - Client Performance",
      reportType: "client",
      startDate: `${currentYear}-${currentMonth}-01`,
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: false, revenue: true, cost: false, profit: true, margin: true, orders: true, date: false }
    },
    {
      name: "[MONTHLY] This Month - Staff Performance",
      reportType: "staff",
      startDate: `${currentYear}-${currentMonth}-01`,
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: false, revenue: true, cost: false, profit: true, margin: true, orders: true, date: false }
    },
    {
      name: "[MONTHLY] This Month - Orders",
      reportType: "order",
      startDate: `${currentYear}-${currentMonth}-01`,
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: true }
    },

    // ============================================
    // PROFITABILITY ANALYSIS
    // ============================================
    {
      name: "[PROFIT] High Margin Items (All Time)",
      reportType: "item",
      startDate: "",
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false }
    },
    {
      name: "[PROFIT] Low Margin Items (All Time)",
      reportType: "item",
      startDate: "",
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false }
    },
    {
      name: "[PROFIT] Negative Profit Items",
      reportType: "item",
      startDate: "",
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false }
    },
    {
      name: "[PROFIT] Revenue vs Cost Analysis",
      reportType: "item",
      startDate: "",
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false }
    },
    {
      name: "[PROFIT] Client Profitability Analysis",
      reportType: "client",
      startDate: "",
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: false, revenue: true, cost: true, profit: true, margin: true, orders: true, date: false }
    },
    {
      name: "[PROFIT] Category Profit Margins",
      reportType: "category",
      startDate: "",
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false }
    },

    // ============================================
    // TOP PERFORMERS
    // ============================================
    {
      name: "[TOP] Top 40 Items by Revenue",
      reportType: "item",
      startDate: "",
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      sortBy: "revenue",
      limit: "40",
      columns: { item: true, quantity: true, revenue: true, cost: false, profit: true, margin: true, orders: false, date: false }
    },
    {
      name: "[TOP] Top 40 Items by Quantity",
      reportType: "item",
      startDate: "",
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      sortBy: "quantity",
      limit: "40",
      columns: { item: true, quantity: true, revenue: true, cost: false, profit: true, margin: false, orders: false, date: false }
    },
    {
      name: "[TOP] Top 40 Items by Profit",
      reportType: "item",
      startDate: "",
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      sortBy: "profit",
      limit: "40",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false }
    },
    {
      name: "[TOP] Top 10 Clients by Revenue",
      reportType: "client",
      startDate: "",
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: false, revenue: true, cost: false, profit: true, margin: true, orders: true, date: false }
    },
    {
      name: "[TOP] Top 10 Clients by Orders",
      reportType: "client",
      startDate: "",
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: false, revenue: true, cost: false, profit: false, margin: false, orders: true, date: false }
    },
    {
      name: "[TOP] Top Staff by Revenue",
      reportType: "staff",
      startDate: "",
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: false, revenue: true, cost: false, profit: true, margin: true, orders: true, date: false }
    },
    {
      name: "[TOP] Top Staff by Orders",
      reportType: "staff",
      startDate: "",
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: false, revenue: true, cost: false, profit: true, margin: true, orders: true, date: false }
    },

    // ============================================
    // CUSTOMER BEHAVIOR
    // ============================================
    {
      name: "[CUSTOMER] High-Value Clients (Top 10%)",
      reportType: "client",
      startDate: "",
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: false, revenue: true, cost: true, profit: true, margin: true, orders: true, date: false }
    },
    {
      name: "[CUSTOMER] Client Purchase Frequency",
      reportType: "client",
      startDate: "",
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: false, revenue: true, cost: false, profit: false, margin: false, orders: true, date: false }
    },
    {
      name: "[CUSTOMER] Dormant Clients (No Orders 90+ Days)",
      reportType: "client",
      startDate: "",
      endDate: last90Days,
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: false, revenue: true, cost: false, profit: false, margin: false, orders: true, date: false }
    },
    {
      name: "[CUSTOMER] Active Clients (Last 30 Days)",
      reportType: "client",
      startDate: last30Days,
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: false, revenue: true, cost: false, profit: true, margin: true, orders: true, date: false }
    },

    // ============================================
    // PRODUCT PERFORMANCE
    // ============================================
    {
      name: "[PRODUCT] Item Velocity (Revenue per Day)",
      reportType: "item",
      startDate: last90Days,
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: false, profit: true, margin: false, orders: false, date: false }
    },
    {
      name: "[PRODUCT] Slow-Moving Items (Low Quantity)",
      reportType: "item",
      startDate: "",
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false }
    },
    {
      name: "[PRODUCT] Fast-Moving Items (High Quantity)",
      reportType: "item",
      startDate: "",
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: false, profit: true, margin: false, orders: true, date: false }
    },

    // ============================================
    // STAFF PERFORMANCE
    // ============================================
    {
      name: "[STAFF] Staff Efficiency (Revenue per Order)",
      reportType: "staff",
      startDate: "",
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: false, revenue: true, cost: false, profit: true, margin: false, orders: true, date: false }
    },
    {
      name: "[STAFF] Staff Product Mix (Categories)",
      reportType: "staff",
      startDate: "",
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: false, profit: true, margin: false, orders: true, date: false }
    },
    {
      name: "[STAFF] This Month Staff Performance",
      reportType: "staff",
      startDate: `${currentYear}-${currentMonth}-01`,
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: false, revenue: true, cost: false, profit: true, margin: true, orders: true, date: false }
    },
    {
      name: "[STAFF] YTD Staff Growth",
      reportType: "staff",
      startDate: `${currentYear}-01-01`,
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: false, revenue: true, cost: false, profit: true, margin: true, orders: true, date: false }
    },

    // ============================================
    // TIME COMPARISON
    // ============================================
    {
      name: "[TIME] Last 7 Days Performance",
      reportType: "item",
      startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false }
    },
    {
      name: "[TIME] Last 30 Days Performance",
      reportType: "item",
      startDate: last30Days,
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false }
    },
    {
      name: "[TIME] Last 90 Days Performance",
      reportType: "item",
      startDate: last90Days,
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false }
    },
    {
      name: "[TIME] Week-over-Week Comparison",
      reportType: "item",
      startDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false }
    },
    {
      name: "[TIME] Month-over-Month Growth",
      reportType: "item",
      startDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false }
    },

    // ============================================
    // CATEGORY ANALYSIS
    // ============================================
    {
      name: "[CATEGORY] All Categories Overview",
      reportType: "category",
      startDate: "",
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false }
    },
    {
      name: "[CATEGORY] YTD Category Performance",
      reportType: "category",
      startDate: `${currentYear}-01-01`,
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false }
    },
    {
      name: "[CATEGORY] This Month Category Mix",
      reportType: "category",
      startDate: `${currentYear}-${currentMonth}-01`,
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false }
    },

    // ============================================
    // ORDER ANALYSIS
    // ============================================
    {
      name: "[ORDER] All Orders Overview",
      reportType: "order",
      startDate: "",
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: true }
    },
    {
      name: "[ORDER] Large Orders (>$1000)",
      reportType: "order",
      startDate: "",
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: true }
    },
    {
      name: "[ORDER] Small Orders (<$100)",
      reportType: "order",
      startDate: "",
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: true }
    },
    {
      name: "[ORDER] This Month Orders",
      reportType: "order",
      startDate: `${currentYear}-${currentMonth}-01`,
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: true }
    },

    // ============================================
    // SEASONAL REPORTS
    // ============================================
    {
      name: "[SEASONAL] Spring Sales (Mar-May)",
      reportType: "item",
      startDate: `${currentYear}-03-01`,
      endDate: `${currentYear}-05-31`,
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false }
    },
    {
      name: "[SEASONAL] Summer Sales (Jun-Aug)",
      reportType: "item",
      startDate: `${currentYear}-06-01`,
      endDate: `${currentYear}-08-31`,
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false }
    },
    {
      name: "[SEASONAL] Fall Sales (Sep-Nov)",
      reportType: "item",
      startDate: `${currentYear}-09-01`,
      endDate: `${currentYear}-11-30`,
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false }
    },
    {
      name: "[SEASONAL] Winter Sales (Dec-Feb)",
      reportType: "item",
      startDate: `${currentYear}-12-01`,
      endDate: `${currentYear + 1}-02-28`,
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false }
    },

    // ============================================
    // SPECIFIC ITEMS
    // ============================================
    {
      name: "[ITEMS] Mulch Sales Analysis",
      reportType: "item",
      startDate: "",
      endDate: "",
      itemFilter: "mulch",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false }
    },
    {
      name: "[ITEMS] Stone/Gravel Sales Analysis",
      reportType: "item",
      startDate: "",
      endDate: "",
      itemFilter: "stone, gravel, rock",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false }
    },
    {
      name: "[ITEMS] Soil/Topsoil Sales Analysis",
      reportType: "item",
      startDate: "",
      endDate: "",
      itemFilter: "soil, topsoil, dirt",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false }
    },

    // ============================================
    // COMPLETE VIEWS
    // ============================================
    {
      name: "[COMPLETE] All Items (Full Details)",
      reportType: "item",
      startDate: "",
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: true, date: false }
    },
    {
      name: "[COMPLETE] All Clients (Full Details)",
      reportType: "client",
      startDate: "",
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: true, date: false }
    },
    {
      name: "[COMPLETE] All Staff (Full Details)",
      reportType: "staff",
      startDate: "",
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: true, date: false }
    },
    {
      name: "[COMPLETE] All Orders (Full Details)",
      reportType: "order",
      startDate: "",
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: true }
    },
    {
      name: "[COMPLETE] All Categories (Full Details)",
      reportType: "category",
      startDate: "",
      endDate: "",
      itemFilter: "",
      clientFilter: "",
      staffFilter: "",
      categoryFilter: "",
      columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: true, date: false }
    }
  ];

  // Get existing reports
  let savedReports = [];
  try {
    const stored = localStorage.getItem('savedReportConfigs');
    if (stored) savedReports = JSON.parse(stored);
  } catch (e) {
    console.error('Error loading saved reports:', e);
  }

  // Add templates that don't already exist
  let addedCount = 0;
  templates.forEach(template => {
    const exists = savedReports.some(r => r.name === template.name);
    if (!exists) {
      savedReports.push({ ...template, savedAt: new Date().toISOString() });
      addedCount++;
    }
  });

  // Save back
  try {
    localStorage.setItem('savedReportConfigs', JSON.stringify(savedReports));
    populateSavedReportsDropdown();
    alert(`Loaded ${addedCount} pre-built report templates! (${templates.length - addedCount} already existed)`);
  } catch (e) {
    console.error('Error saving templates:', e);
    alert('Failed to load templates. Storage might be full.');
  }
}

function migrateOldTemplateNames() {
  // One-time migration to update "Top 20" to "Top 40" in saved reports
  try {
    const stored = localStorage.getItem('savedReportConfigs');
    if (!stored) return;

    let savedReports = JSON.parse(stored);
    let modified = false;

    savedReports = savedReports.map(report => {
      if (report.name && report.name.includes('Top 20')) {
        modified = true;
        return {
          ...report,
          name: report.name.replace('Top 20', 'Top 40'),
          limit: report.limit || '40', // Ensure limit is set
          sortBy: report.sortBy || (report.name.includes('Revenue') ? 'revenue' : report.name.includes('Quantity') ? 'quantity' : report.name.includes('Profit') ? 'profit' : 'revenue')
        };
      }
      return report;
    });

    if (modified) {
      localStorage.setItem('savedReportConfigs', JSON.stringify(savedReports));
      console.log('[migration] Updated old "Top 20" templates to "Top 40"');
    }
  } catch (e) {
    console.error('Error migrating template names:', e);
  }
}

function populateSavedReportsDropdown() {
  const dropdown = qs('savedReportsDropdown');
  if (!dropdown) return;

  // Run migration once
  migrateOldTemplateNames();

  // Get saved reports
  let savedReports = [];
  try {
    const stored = localStorage.getItem('savedReportConfigs');
    if (stored) savedReports = JSON.parse(stored);
  } catch (e) {
    console.error('Error loading saved reports:', e);
  }

  // Get templates organized by category
  const templates = getTemplateDefinitions();
  const templatesByCategory = {
    'YTD': [],
    'QUARTERLY': [],
    'MONTHLY': [],
    'PROFIT': [],
    'TOP': [],
    'CUSTOMER': [],
    'PRODUCT': [],
    'STAFF': [],
    'TIME': [],
    'CATEGORY': [],
    'ORDER': [],
    'SEASONAL': [],
    'ITEMS': [],
    'COMPLETE': [],
    'WINDSOR': [],
    'WINDSOR-PERFORMANCE': [],
    'WINDSOR-TIME': [],
    'WINDSOR-PROFIT': [],
    'WINDSOR-SEASONAL': [],
    'WINDSOR-PRODUCTS': [],
    'WINDSOR-CLIENTS': [],
    'WINDSOR-ORDERS': []
  };

  templates.forEach(template => {
    const match = template.name.match(/^\[([^\]]+)\]/);
    if (match) {
      const category = match[1];
      if (templatesByCategory[category]) {
        templatesByCategory[category].push(template);
      }
    }
  });

  // Build dropdown with optgroups
  let html = '<option value="">-- Select a report or template --</option>';

  // Add user saved reports first
  if (savedReports.length > 0) {
    html += '<optgroup label="📁 Your Saved Reports">';
    html += savedReports.map(r => `<option value="${escapeHtml(r.name)}">${escapeHtml(r.name)}</option>`).join('');
    html += '</optgroup>';
  }

  // Add template categories
  const categoryLabels = {
    'YTD': '📅 Year-to-Date',
    'QUARTERLY': '📊 Quarterly',
    'MONTHLY': '📆 Monthly',
    'PROFIT': '💰 Profitability',
    'TOP': '🏆 Top Performers',
    'CUSTOMER': '👥 Customer Behavior',
    'PRODUCT': '📦 Product Performance',
    'STAFF': '👤 Staff Performance',
    'TIME': '⏰ Time Comparison',
    'CATEGORY': '🏷️ Category Analysis',
    'ORDER': '📋 Order Analysis',
    'SEASONAL': '🌤️ Seasonal',
    'ITEMS': '🎯 Specific Items',
    'COMPLETE': '📂 Complete Views',
    'WINDSOR': '👨‍💼 Windsor Stagg',
    'WINDSOR-PERFORMANCE': '👨‍💼 Windsor: Performance',
    'WINDSOR-TIME': '👨‍💼 Windsor: Time Analysis',
    'WINDSOR-PROFIT': '👨‍💼 Windsor: Profitability',
    'WINDSOR-SEASONAL': '👨‍💼 Windsor: Seasonal',
    'WINDSOR-PRODUCTS': '👨‍💼 Windsor: Products',
    'WINDSOR-CLIENTS': '👨‍💼 Windsor: Clients',
    'WINDSOR-ORDERS': '👨‍💼 Windsor: Orders'
  };

  Object.keys(templatesByCategory).forEach(category => {
    const categoryTemplates = templatesByCategory[category];
    if (categoryTemplates.length > 0) {
      html += `<optgroup label="${categoryLabels[category]}">`;
      html += categoryTemplates.map(t => `<option value="${escapeHtml(t.name)}">${escapeHtml(t.name)}</option>`).join('');
      html += '</optgroup>';
    }
  });

  dropdown.innerHTML = html;
}

// ============================================
// TEMPLATE BROWSER FUNCTIONS
// ============================================

function toggleTemplateBrowser() {
  const browser = qs('templateBrowser');
  const button = qs('btnToggleTemplates');
  if (!browser || !button) return;

  const isHidden = browser.classList.contains('hidden');

  if (isHidden) {
    browser.classList.remove('hidden');
    button.textContent = 'Hide Templates';
    // Populate templates on first show
    populateTemplateBrowser();
  } else {
    browser.classList.add('hidden');
    button.textContent = 'Show Templates';
  }
}

function getTemplateDefinitions() {
  const currentYear = new Date().getFullYear();
  const currentMonth = String(new Date().getMonth() + 1).padStart(2, '0');
  const last30Days = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const last90Days = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  return [
    // YTD REPORTS
    { name: "[YTD] Revenue by Item", reportType: "item", startDate: `${currentYear}-01-01`, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: false, profit: true, margin: true, orders: false, date: false } },
    { name: "[YTD] Revenue by Client", reportType: "client", startDate: `${currentYear}-01-01`, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: false, profit: true, margin: true, orders: true, date: false } },
    { name: "[YTD] Revenue by Staff", reportType: "staff", startDate: `${currentYear}-01-01`, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: false, profit: true, margin: true, orders: true, date: false } },
    { name: "[YTD] Category Performance", reportType: "category", startDate: `${currentYear}-01-01`, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },

    // QUARTERLY REPORTS
    { name: "[QUARTERLY] Q1 Performance by Item", reportType: "item", startDate: `${currentYear}-01-01`, endDate: `${currentYear}-03-31`, itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[QUARTERLY] Q2 Performance by Item", reportType: "item", startDate: `${currentYear}-04-01`, endDate: `${currentYear}-06-30`, itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[QUARTERLY] Q3 Performance by Item", reportType: "item", startDate: `${currentYear}-07-01`, endDate: `${currentYear}-09-30`, itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[QUARTERLY] Q4 Performance by Item", reportType: "item", startDate: `${currentYear}-10-01`, endDate: `${currentYear}-12-31`, itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },

    // MONTHLY REPORTS
    { name: "[MONTHLY] This Month - All Items", reportType: "item", startDate: `${currentYear}-${currentMonth}-01`, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[MONTHLY] This Month - Client Performance", reportType: "client", startDate: `${currentYear}-${currentMonth}-01`, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: false, profit: true, margin: true, orders: true, date: false } },
    { name: "[MONTHLY] This Month - Staff Performance", reportType: "staff", startDate: `${currentYear}-${currentMonth}-01`, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: false, profit: true, margin: true, orders: true, date: false } },
    { name: "[MONTHLY] This Month - Orders", reportType: "order", startDate: `${currentYear}-${currentMonth}-01`, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: true } },

    // PROFITABILITY ANALYSIS
    { name: "[PROFIT] High Margin Items (All Time)", reportType: "item", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[PROFIT] Low Margin Items (All Time)", reportType: "item", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[PROFIT] Negative Profit Items", reportType: "item", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[PROFIT] Revenue vs Cost Analysis", reportType: "item", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[PROFIT] Client Profitability Analysis", reportType: "client", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: true, profit: true, margin: true, orders: true, date: false } },
    { name: "[PROFIT] Category Profit Margins", reportType: "category", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },

    // TOP PERFORMERS
    { name: "[TOP] Top 40 Items by Revenue", reportType: "item", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", sortBy: "revenue", limit: "40", columns: { item: true, quantity: true, revenue: true, cost: false, profit: true, margin: true, orders: false, date: false } },
    { name: "[TOP] Top 40 Items by Quantity", reportType: "item", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", sortBy: "quantity", limit: "40", columns: { item: true, quantity: true, revenue: true, cost: false, profit: true, margin: false, orders: false, date: false } },
    { name: "[TOP] Top 40 Items by Profit", reportType: "item", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", sortBy: "profit", limit: "40", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[TOP] Top 10 Clients by Revenue", reportType: "client", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: false, profit: true, margin: true, orders: true, date: false } },
    { name: "[TOP] Top 10 Clients by Orders", reportType: "client", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: false, profit: false, margin: false, orders: true, date: false } },
    { name: "[TOP] Top Staff by Revenue", reportType: "staff", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: false, profit: true, margin: true, orders: true, date: false } },
    { name: "[TOP] Top Staff by Orders", reportType: "staff", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: false, profit: true, margin: true, orders: true, date: false } },

    // CUSTOMER BEHAVIOR
    { name: "[CUSTOMER] High-Value Clients (Top 10%)", reportType: "client", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: true, profit: true, margin: true, orders: true, date: false } },
    { name: "[CUSTOMER] Client Purchase Frequency", reportType: "client", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: false, profit: false, margin: false, orders: true, date: false } },
    { name: "[CUSTOMER] Dormant Clients (No Orders 90+ Days)", reportType: "client", startDate: "", endDate: last90Days, itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: false, profit: false, margin: false, orders: true, date: false } },
    { name: "[CUSTOMER] Active Clients (Last 30 Days)", reportType: "client", startDate: last30Days, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: false, profit: true, margin: true, orders: true, date: false } },

    // PRODUCT PERFORMANCE
    { name: "[PRODUCT] Item Velocity (Revenue per Day)", reportType: "item", startDate: last90Days, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: false, profit: true, margin: false, orders: false, date: false } },
    { name: "[PRODUCT] Slow-Moving Items (Low Quantity)", reportType: "item", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[PRODUCT] Fast-Moving Items (High Quantity)", reportType: "item", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: false, profit: true, margin: false, orders: true, date: false } },

    // STAFF PERFORMANCE
    { name: "[STAFF] Staff Efficiency (Revenue per Order)", reportType: "staff", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: false, profit: true, margin: false, orders: true, date: false } },
    { name: "[STAFF] Staff Product Mix (Categories)", reportType: "staff", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: false, profit: true, margin: false, orders: true, date: false } },
    { name: "[STAFF] This Month Staff Performance", reportType: "staff", startDate: `${currentYear}-${currentMonth}-01`, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: false, profit: true, margin: true, orders: true, date: false } },
    { name: "[STAFF] YTD Staff Growth", reportType: "staff", startDate: `${currentYear}-01-01`, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: false, profit: true, margin: true, orders: true, date: false } },

    // TIME COMPARISON
    { name: "[TIME] Last 7 Days Performance", reportType: "item", startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[TIME] Last 30 Days Performance", reportType: "item", startDate: last30Days, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[TIME] Last 90 Days Performance", reportType: "item", startDate: last90Days, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[TIME] Week-over-Week Comparison", reportType: "item", startDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[TIME] Month-over-Month Growth", reportType: "item", startDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },

    // CATEGORY ANALYSIS
    { name: "[CATEGORY] All Categories Overview", reportType: "category", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[CATEGORY] YTD Category Performance", reportType: "category", startDate: `${currentYear}-01-01`, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[CATEGORY] This Month Category Mix", reportType: "category", startDate: `${currentYear}-${currentMonth}-01`, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },

    // ORDER ANALYSIS
    { name: "[ORDER] All Orders Overview", reportType: "order", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: true } },
    { name: "[ORDER] Large Orders (>$1000)", reportType: "order", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: true } },
    { name: "[ORDER] Small Orders (<$100)", reportType: "order", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: true } },
    { name: "[ORDER] This Month Orders", reportType: "order", startDate: `${currentYear}-${currentMonth}-01`, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: true } },

    // SEASONAL REPORTS
    { name: "[SEASONAL] Spring Sales (Mar-May)", reportType: "item", startDate: `${currentYear}-03-01`, endDate: `${currentYear}-05-31`, itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[SEASONAL] Summer Sales (Jun-Aug)", reportType: "item", startDate: `${currentYear}-06-01`, endDate: `${currentYear}-08-31`, itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[SEASONAL] Fall Sales (Sep-Nov)", reportType: "item", startDate: `${currentYear}-09-01`, endDate: `${currentYear}-11-30`, itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[SEASONAL] Winter Sales (Dec-Feb)", reportType: "item", startDate: `${currentYear}-12-01`, endDate: `${currentYear + 1}-02-28`, itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },

    // SPECIFIC ITEMS
    { name: "[ITEMS] Mulch Sales Analysis", reportType: "item", startDate: "", endDate: "", itemFilter: "mulch", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[ITEMS] Stone/Gravel Sales Analysis", reportType: "item", startDate: "", endDate: "", itemFilter: "stone, gravel, rock", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[ITEMS] Soil/Topsoil Sales Analysis", reportType: "item", startDate: "", endDate: "", itemFilter: "soil, topsoil, dirt", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },

    // COMPLETE VIEWS
    { name: "[COMPLETE] All Items (Full Details)", reportType: "item", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: true, date: false } },
    { name: "[COMPLETE] All Clients (Full Details)", reportType: "client", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: true, date: false } },
    { name: "[COMPLETE] All Staff (Full Details)", reportType: "staff", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: true, date: false } },
    { name: "[COMPLETE] All Orders (Full Details)", reportType: "order", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: true } },
    { name: "[COMPLETE] All Categories (Full Details)", reportType: "category", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: true, date: false } },

    // WINDSOR STAGG MEMBER REPORTS
    { name: "[WINDSOR-PERFORMANCE] YTD Performance", reportType: "staff", startDate: `${currentYear}-01-01`, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: true, profit: true, margin: true, orders: true, date: false } },
    { name: "[WINDSOR-PERFORMANCE] This Month Performance", reportType: "staff", startDate: `${currentYear}-${currentMonth}-01`, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: true, profit: true, margin: true, orders: true, date: false } },
    { name: "[WINDSOR-PERFORMANCE] Last 30 Days", reportType: "staff", startDate: last30Days, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: true, profit: true, margin: true, orders: true, date: false } },
    { name: "[WINDSOR-PERFORMANCE] All Time Performance", reportType: "staff", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: true, date: false } },
    { name: "[WINDSOR-PERFORMANCE] Items Sold (All Time)", reportType: "item", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR-PERFORMANCE] Items Sold (YTD)", reportType: "item", startDate: `${currentYear}-01-01`, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR-PERFORMANCE] Items Sold (This Month)", reportType: "item", startDate: `${currentYear}-${currentMonth}-01`, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR-PERFORMANCE] Top 40 Items by Revenue", reportType: "item", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", sortBy: "revenue", limit: "40", columns: { item: true, quantity: true, revenue: true, cost: false, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR-PERFORMANCE] Top 40 Items by Quantity", reportType: "item", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", sortBy: "quantity", limit: "40", columns: { item: true, quantity: true, revenue: true, cost: false, profit: true, margin: false, orders: false, date: false } },
    { name: "[WINDSOR-CLIENTS] Clients Served (All Time)", reportType: "client", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: true, profit: true, margin: true, orders: true, date: false } },
    { name: "[WINDSOR-CLIENTS] Clients Served (YTD)", reportType: "client", startDate: `${currentYear}-01-01`, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: true, profit: true, margin: true, orders: true, date: false } },
    { name: "[WINDSOR-CLIENTS] Clients Served (This Month)", reportType: "client", startDate: `${currentYear}-${currentMonth}-01`, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: true, profit: true, margin: true, orders: true, date: false } },
    { name: "[WINDSOR-CLIENTS] Top 10 Clients by Revenue", reportType: "client", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", sortBy: "revenue", limit: "10", columns: { item: true, quantity: false, revenue: true, cost: false, profit: true, margin: true, orders: true, date: false } },
    { name: "[WINDSOR-CLIENTS] Top 10 Clients by Orders", reportType: "client", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", sortBy: "orders", limit: "10", columns: { item: true, quantity: false, revenue: true, cost: false, profit: false, margin: false, orders: true, date: false } },
    { name: "[WINDSOR-ORDERS] Orders (All Time)", reportType: "order", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: true } },
    { name: "[WINDSOR-ORDERS] Orders (YTD)", reportType: "order", startDate: `${currentYear}-01-01`, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: true } },
    { name: "[WINDSOR-ORDERS] Orders (This Month)", reportType: "order", startDate: `${currentYear}-${currentMonth}-01`, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: true } },
    { name: "[WINDSOR-PERFORMANCE] Categories Sold (All Time)", reportType: "category", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR-PERFORMANCE] Categories Sold (YTD)", reportType: "category", startDate: `${currentYear}-01-01`, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR-SEASONAL] Q1 Performance", reportType: "staff", startDate: `${currentYear}-01-01`, endDate: `${currentYear}-03-31`, itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: true, profit: true, margin: true, orders: true, date: false } },
    { name: "[WINDSOR-SEASONAL] Q2 Performance", reportType: "staff", startDate: `${currentYear}-04-01`, endDate: `${currentYear}-06-30`, itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: true, profit: true, margin: true, orders: true, date: false } },
    { name: "[WINDSOR-SEASONAL] Q3 Performance", reportType: "staff", startDate: `${currentYear}-07-01`, endDate: `${currentYear}-09-30`, itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: true, profit: true, margin: true, orders: true, date: false } },
    { name: "[WINDSOR-SEASONAL] Q4 Performance", reportType: "staff", startDate: `${currentYear}-10-01`, endDate: `${currentYear}-12-31`, itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: true, profit: true, margin: true, orders: true, date: false } },
    { name: "[WINDSOR-PROFIT] High Margin Items Sold", reportType: "item", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", sortBy: "margin", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR-PERFORMANCE] Revenue Breakdown by Item", reportType: "item", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", sortBy: "revenue", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: true, date: false } },

    // TIME COMPARISONS
    { name: "[WINDSOR-TIME] Last 7 Days", reportType: "item", startDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR-TIME] Last 90 Days", reportType: "item", startDate: last90Days, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR-TIME] Week-over-Week Comparison", reportType: "item", startDate: new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR-TIME] Month-over-Month Growth", reportType: "item", startDate: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },

    // PROFITABILITY ANALYSIS
    { name: "[WINDSOR-PROFIT] Low Margin Items", reportType: "item", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", sortBy: "margin", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR-PROFIT] Most Profitable Items (by Total Profit)", reportType: "item", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", sortBy: "profit", limit: "40", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR-PROFIT] Profitability Analysis (All Items)", reportType: "item", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },

    // SEASONAL PERFORMANCE
    { name: "[WINDSOR-SEASONAL] Spring Sales (Mar-May)", reportType: "item", startDate: `${currentYear}-03-01`, endDate: `${currentYear}-05-31`, itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR-SEASONAL] Summer Sales (Jun-Aug)", reportType: "item", startDate: `${currentYear}-06-01`, endDate: `${currentYear}-08-31`, itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR-SEASONAL] Fall Sales (Sep-Nov)", reportType: "item", startDate: `${currentYear}-09-01`, endDate: `${currentYear}-11-30`, itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR-SEASONAL] Winter Sales (Dec-Feb)", reportType: "item", startDate: `${currentYear}-12-01`, endDate: `${currentYear + 1}-02-28`, itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },

    // SPECIFIC PRODUCT CATEGORIES
    { name: "[WINDSOR-PRODUCTS] Mulch Sales", reportType: "item", startDate: "", endDate: "", itemFilter: "mulch", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR-PRODUCTS] Stone/Gravel Sales", reportType: "item", startDate: "", endDate: "", itemFilter: "stone, gravel, rock", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR-PRODUCTS] Soil/Topsoil Sales", reportType: "item", startDate: "", endDate: "", itemFilter: "soil, topsoil, dirt", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },

    // ADVANCED METRICS
    { name: "[WINDSOR-PRODUCTS] Fast-Moving Items (High Quantity)", reportType: "item", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", sortBy: "quantity", limit: "40", columns: { item: true, quantity: true, revenue: true, cost: false, profit: true, margin: false, orders: true, date: false } },
    { name: "[WINDSOR-PRODUCTS] Slow-Moving Items (Low Quantity)", reportType: "item", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", sortBy: "quantity", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR-PRODUCTS] Item Velocity (Revenue per Day - Last 90 Days)", reportType: "item", startDate: last90Days, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: false, profit: true, margin: false, orders: false, date: false } },
    { name: "[WINDSOR-ORDERS] Average Order Value Analysis", reportType: "order", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: true } },

    // CLIENT BEHAVIOR & RELATIONSHIPS
    { name: "[WINDSOR-CLIENTS] Repeat Customers", reportType: "client", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: true, profit: true, margin: true, orders: true, date: false } },
    { name: "[WINDSOR-CLIENTS] New Customers (This Month)", reportType: "client", startDate: `${currentYear}-${currentMonth}-01`, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: false, profit: true, margin: false, orders: true, date: false } },
    { name: "[WINDSOR-CLIENTS] Active Clients (Last 30 Days)", reportType: "client", startDate: last30Days, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: true, profit: true, margin: true, orders: true, date: false } },
    { name: "[WINDSOR-CLIENTS] Dormant Clients (90+ Days No Orders)", reportType: "client", startDate: "", endDate: last90Days, itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: false, profit: false, margin: false, orders: true, date: false } },
    { name: "[WINDSOR-CLIENTS] Client Retention Analysis", reportType: "client", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: false, revenue: true, cost: true, profit: true, margin: true, orders: true, date: false } },

    // ORDER SIZE ANALYSIS
    { name: "[WINDSOR-ORDERS] Large Orders (>$1000)", reportType: "order", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: true } },
    { name: "[WINDSOR-ORDERS] Small Orders (<$100)", reportType: "order", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: true } },
    { name: "[WINDSOR-ORDERS] Medium Orders ($100-$1000)", reportType: "order", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: true } },

    // MONTHLY BREAKDOWN (Individual Months)
    { name: "[WINDSOR] January Performance", reportType: "item", startDate: `${currentYear}-01-01`, endDate: `${currentYear}-01-31`, itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR] February Performance", reportType: "item", startDate: `${currentYear}-02-01`, endDate: `${currentYear}-02-28`, itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR] March Performance", reportType: "item", startDate: `${currentYear}-03-01`, endDate: `${currentYear}-03-31`, itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR] April Performance", reportType: "item", startDate: `${currentYear}-04-01`, endDate: `${currentYear}-04-30`, itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR] May Performance", reportType: "item", startDate: `${currentYear}-05-01`, endDate: `${currentYear}-05-31`, itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR] June Performance", reportType: "item", startDate: `${currentYear}-06-01`, endDate: `${currentYear}-06-30`, itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR] July Performance", reportType: "item", startDate: `${currentYear}-07-01`, endDate: `${currentYear}-07-31`, itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR] August Performance", reportType: "item", startDate: `${currentYear}-08-01`, endDate: `${currentYear}-08-31`, itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR] September Performance", reportType: "item", startDate: `${currentYear}-09-01`, endDate: `${currentYear}-09-30`, itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR] October Performance", reportType: "item", startDate: `${currentYear}-10-01`, endDate: `${currentYear}-10-31`, itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR] November Performance", reportType: "item", startDate: `${currentYear}-11-01`, endDate: `${currentYear}-11-30`, itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR] December Performance", reportType: "item", startDate: `${currentYear}-12-01`, endDate: `${currentYear}-12-31`, itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },

    // PRODUCT MIX & DIVERSITY
    { name: "[WINDSOR] Product Mix Analysis (All Categories)", reportType: "category", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR] Category Performance (This Month)", reportType: "category", startDate: `${currentYear}-${currentMonth}-01`, endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR] Items Never Sold", reportType: "item", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },

    // YEAR-OVER-YEAR COMPARISONS
    { name: "[WINDSOR] YoY Growth (Same Month Last Year)", reportType: "item", startDate: `${currentYear - 1}-${currentMonth}-01`, endDate: `${currentYear - 1}-${currentMonth}-31`, itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },
    { name: "[WINDSOR] Last Year Full Performance", reportType: "item", startDate: `${currentYear - 1}-01-01`, endDate: `${currentYear - 1}-12-31`, itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: false } },

    // EXCEPTION REPORTS
    { name: "[WINDSOR] High-Value Orders (Top 10)", reportType: "order", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", sortBy: "revenue", limit: "10", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: true } },
    { name: "[WINDSOR] Single-Item Orders", reportType: "order", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: true } },
    { name: "[WINDSOR] Multi-Item Orders (3+ Items)", reportType: "order", startDate: "", endDate: "", itemFilter: "", clientFilter: "", staffFilter: "Windsor Stagg", categoryFilter: "", columns: { item: true, quantity: true, revenue: true, cost: true, profit: true, margin: true, orders: false, date: true } }
  ];
}

function populateTemplateBrowser() {
  filterTemplates(); // Use filter function to populate initially
}

function filterTemplates() {
  const categoryFilter = qs('templateCategoryFilter')?.value || '';
  const templateList = qs('templateList');
  if (!templateList) return;

  const templates = getTemplateDefinitions();
  const filtered = categoryFilter
    ? templates.filter(t => t.name.includes(`[${categoryFilter}]`))
    : templates;

  if (filtered.length === 0) {
    templateList.innerHTML = '<p class="text-sm text-gray-500 text-center py-4">No templates in this category</p>';
    return;
  }

  templateList.innerHTML = filtered.map(template => `
    <div class="flex items-center justify-between p-2 bg-white rounded border hover:border-blue-400 cursor-pointer template-item" data-template-name="${escapeHtml(template.name)}">
      <div class="flex-1">
        <div class="text-sm font-medium">${escapeHtml(template.name)}</div>
        <div class="text-xs text-gray-500">Type: ${escapeHtml(template.reportType)} | Dates: ${template.startDate || 'All'} to ${template.endDate || 'Now'}</div>
      </div>
      <button class="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 btn-load-single-template">Load & Run</button>
    </div>
  `).join('');

  // Add click handlers for each template
  templateList.querySelectorAll('.btn-load-single-template').forEach((btn, idx) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      loadAndRunSingleTemplate(filtered[idx]);
    });
  });

  // Add click handler for template items (load without running)
  templateList.querySelectorAll('.template-item').forEach((item, idx) => {
    item.addEventListener('click', (e) => {
      if (e.target.classList.contains('btn-load-single-template')) return; // Skip if button clicked
      loadTemplateToForm(filtered[idx]);
    });
  });
}

function loadTemplateToForm(template) {
  // Load template configuration into the form fields
  qs('reportType').value = template.reportType;
  qs('reportStartDate').value = template.startDate || '';
  qs('reportEndDate').value = template.endDate || '';
  qs('reportItemFilter').value = template.itemFilter || '';
  qs('reportClientFilter').value = template.clientFilter || '';
  qs('reportStaffFilter').value = template.staffFilter || '';
  qs('reportCategoryFilter').value = template.categoryFilter || '';
  qs('reportSortBy').value = template.sortBy || 'revenue';
  qs('reportLimit').value = template.limit || '';

  // Set column checkboxes
  qs('colItem').checked = template.columns.item !== false;
  qs('colQuantity').checked = template.columns.quantity !== false;
  qs('colRevenue').checked = template.columns.revenue !== false;
  qs('colCost').checked = template.columns.cost !== false;
  qs('colProfit').checked = template.columns.profit !== false;
  qs('colMargin').checked = template.columns.margin !== false;
  qs('colOrders').checked = template.columns.orders === true;
  qs('colDate').checked = template.columns.date === true;

  alert(`Template "${template.name}" loaded into form. Click "Generate Report" to run it, or modify settings and click "Save Report Config" to save your customized version.`);
}

function loadAndRunSingleTemplate(template) {
  loadTemplateToForm(template);
  // Auto-generate the report
  setTimeout(() => generateAdvancedReport(), 100);
}

function loadAllTemplatesToSaved() {
  if (!confirm('This will add all 60+ templates to your Saved Reports. Continue?')) return;

  const templates = getTemplateDefinitions();

  // Get existing reports
  let savedReports = [];
  try {
    const stored = localStorage.getItem('savedReportConfigs');
    if (stored) savedReports = JSON.parse(stored);
  } catch (e) {
    console.error('Error loading saved reports:', e);
  }

  // Add templates that don't already exist
  let addedCount = 0;
  templates.forEach(template => {
    const exists = savedReports.some(r => r.name === template.name);
    if (!exists) {
      savedReports.push({ ...template, savedAt: new Date().toISOString() });
      addedCount++;
    }
  });

  // Save back
  try {
    localStorage.setItem('savedReportConfigs', JSON.stringify(savedReports));
    populateSavedReportsDropdown();
    alert(`Added ${addedCount} templates to Saved Reports! (${templates.length - addedCount} already existed)`);
  } catch (e) {
    console.error('Error saving templates:', e);
    alert('Failed to load templates. Storage might be full.');
  }
}

function clearAllSavedReports() {
  if (!confirm('This will DELETE ALL saved report configurations. This cannot be undone. Continue?')) return;

  try {
    localStorage.removeItem('savedReportConfigs');
    populateSavedReportsDropdown();
    alert('All saved reports cleared!');
  } catch (e) {
    console.error('Error clearing saved reports:', e);
    alert('Failed to clear saved reports.');
  }
}

function freezeChartsForPrint(){
  try {
    document.querySelectorAll('canvas').forEach((c) => {
      if (c.dataset.printReplaced === '1') return;
      try {
        const url = c.toDataURL('image/png');
        const img = document.createElement('img');
        img.src = url; img.className = 'print-canvas-img';
        c.dataset.printReplaced = '1';
        c.style.display = 'none';
        c.parentNode?.insertBefore(img, c.nextSibling);
      } catch {}
    });
  } catch {}
}

function restoreChartsAfterPrint(){
  try {
    document.querySelectorAll('img.print-canvas-img').forEach(img => img.remove());
    document.querySelectorAll('canvas[data-print-replaced="1"]').forEach(c => { c.style.display = ''; c.removeAttribute('data-print-replaced'); });
  } catch {}
}

// Accordion behavior and theme utilities
// Removed accordion auto-close behavior to allow multiple expansions
window.addEventListener('beforeprint', () => { document.querySelectorAll('details[data-accordion]').forEach(d => d.open = true); });

function initDarkMode() {
  // Immediate loading from localStorage for instant dark mode on page load
  // This ensures dark mode is applied immediately while waiting for authentication
  const localDarkMode = localStorage.getItem('darkMode');
  if (localDarkMode === 'true') {
    document.documentElement.classList.add('dark');
  } else if (localDarkMode === 'false') {
    document.documentElement.classList.remove('dark');
  }
  // Note: User settings will override this after authentication is determined
  updateDarkModeButton();
}

async function toggleDarkMode() {
  const html = document.documentElement;
  const isDark = html.classList.contains('dark');

  if (isDark) {
    html.classList.remove('dark');
    // Save to both localStorage (immediate) and user settings (authenticated sync)
    localStorage.setItem('darkMode', 'false');
    try { await saveUserSettings('darkMode', 'false'); } catch (e) { console.warn('Failed to save dark mode to user settings:', e); }
  } else {
    html.classList.add('dark');
    // Save to both localStorage (immediate) and user settings (authenticated sync)
    localStorage.setItem('darkMode', 'true');
    try { await saveUserSettings('darkMode', 'true'); } catch (e) { console.warn('Failed to save dark mode to user settings:', e); }
  }

  updateDarkModeButton();
}

function updateDarkModeButton() {
  const isDark = document.documentElement.classList.contains('dark');

  // Update desktop dark mode button
  const toggle = document.getElementById('darkModeToggle');
  if (toggle) {
    const icon = toggle.querySelector('span:first-child');
    const text = toggle.querySelector('span:last-child');
    if (icon) icon.textContent = isDark ? '☀️' : '🌙';
    if (text) text.textContent = isDark ? 'Light Mode' : 'Dark Mode';
  }

  // Update mobile dark mode button
  const mobileToggle = document.getElementById('mobileDarkModeToggle');
  if (mobileToggle) {
    const mobileIcon = mobileToggle.querySelector('span:first-child');
    const mobileText = mobileToggle.querySelector('span:last-child');
    if (mobileIcon) mobileIcon.textContent = isDark ? '☀️' : '🌙';
    if (mobileText) mobileText.textContent = isDark ? 'Light Mode' : 'Dark Mode';
  }
}

function ingestRows(rows){
  state.mapping = {
    date: state.mapping.date || 'Date',
    item: state.mapping.item || 'Name',
    qty: state.mapping.qty || 'Quantity',
    price: state.mapping.price || 'Price',
    cost: state.mapping.cost || 'Cost',
    revenue: state.mapping.revenue || '',
    category: state.mapping.category || '',
    order: state.mapping.order || 'Order Number',
    client: state.mapping.client || 'Client',
    staff: state.mapping.staff || 'Staff',
  };
  const normalized = normalizeAndDedupe(rows, state.mapping);
  state.rows = normalized;
  state.report = computeReport(normalized, state.mapping);
  renderReport(); location.hash = '#/report';
  updateCategoryMapSummary();
}


function appendCategoryMapRow(editor, item = '', category = '') {
  if (!editor) return;
  const row = document.createElement('div');
  row.className = 'flex flex-col gap-2 p-3 border app-border rounded-md bg-gray-50 hover:bg-gray-100 transition-colors';
  row.setAttribute('data-category-row', 'true');

  const itemInput = document.createElement('input');
  itemInput.type = 'text';
  itemInput.placeholder = 'Item name';
  itemInput.className = 'border app-border rounded-md px-2 py-1 text-sm w-full bg-white';
  itemInput.value = item;
  itemInput.setAttribute('data-role', 'item');

  const categoryInput = document.createElement('input');
  categoryInput.type = 'text';
  categoryInput.placeholder = 'Category';
  categoryInput.className = 'border app-border rounded-md px-2 py-1 text-sm w-full bg-white';
  categoryInput.value = category;
  categoryInput.setAttribute('data-role', 'category');

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.textContent = '× Remove';
  removeBtn.className = 'px-2 py-1 text-red-600 rounded-md text-xs font-medium hover:bg-red-50 self-end';
  removeBtn.addEventListener('click', () => row.remove());

  row.appendChild(itemInput);
  row.appendChild(categoryInput);
  row.appendChild(removeBtn);
  editor.appendChild(row);
}

function collectCategoryMapDraft(containerId = 'categoryMapList', options = {}) {
  const { includeEmpty = true } = options;
  const editor = document.getElementById(containerId);
  if (!editor) return {};
  const map = {};
  const rows = editor.querySelectorAll('[data-category-row]');
  rows.forEach(row => {
    const item = row.querySelector('input[data-role="item"]')?.value?.trim();
    const category = row.querySelector('input[data-role="category"]')?.value?.trim();
    if (!item) return;
    if (!category && !includeEmpty) return;
    map[item] = category || '';
  });
  return map;
}

function setCategoryMapDraft(map = {}) {
  categoryMapDraft = { ...map };
  const editor = document.getElementById('categoryMapList');
  if (!editor) return;
  editor.innerHTML = '';
  const entries = Object.entries(categoryMapDraft)
    .filter(([item]) => item)
    .sort((a, b) => a[0].localeCompare(b[0]));
  if (entries.length) {
    entries.forEach(([item, category]) => appendCategoryMapRow(editor, item, category));
  } else {
    appendCategoryMapRow(editor, '', '');
  }
}

function getUniqueItemsFromData() {
  const itemCol = state.mapping?.item;
  if (!itemCol) return [];
  const source = Array.isArray(state.rows) ? state.rows : [];
  const items = new Set();
  source.forEach(row => {
    const raw = row?.[itemCol];
    if (raw == null) return;
    const name = String(raw).trim();
    if (name) items.add(name);
  });
  return Array.from(items).sort((a, b) => a.localeCompare(b));
}

function openCategoryMapModal() {
  const modal = qs('categoryMapModal');
  if (!modal) return;
  const baseMap = { ...(state.categoryMap || {}) };
  const items = getUniqueItemsFromData();
  items.forEach(item => {
    if (!(item in baseMap)) baseMap[item] = baseMap[item] || '';
  });
  setCategoryMapDraft(baseMap);
  const fileInput = qs('categoryMapFile');
  if (fileInput) fileInput.value = '';
  const textarea = qs('categoryMapBulkInput');
  if (textarea) textarea.value = '';
  const list = document.getElementById('categoryMapList');
  if (list) list.scrollTop = 0;

  // Force visibility with inline styles to bypass CSS conflicts
  modal.classList.remove('hidden');
  modal.style.display = 'flex';
  modal.style.position = 'fixed';
  modal.style.inset = '0';
  modal.style.zIndex = '9999';

  previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';

  console.log('[openCategoryMapModal] Modal opened with forced styles');
}

function closeCategoryMapModal() {
  const modal = qs('categoryMapModal');
  if (!modal || modal.classList.contains('hidden')) return;
  modal.classList.add('hidden');
  // Clear inline styles
  modal.style.display = '';
  modal.style.position = '';
  modal.style.inset = '';
  modal.style.zIndex = '';

  document.body.style.overflow = previousBodyOverflow;
  previousBodyOverflow = '';
  const fileInput = qs('categoryMapFile');
  if (fileInput) fileInput.value = '';
  const textarea = qs('categoryMapBulkInput');
  if (textarea) textarea.value = '';

  console.log('[closeCategoryMapModal] Modal closed');
}

function updateCategoryMapSummary() {
  const summary = qs('categoryMapSummary');
  if (!summary) return;
  const map = state.categoryMap || {};
  const totalMappings = Object.keys(map).length;
  const dataItems = getUniqueItemsFromData();
  if (!totalMappings) {
    if (dataItems.length) {
      summary.textContent = `${dataItems.length} item${dataItems.length === 1 ? '' : 's'} detected. No saved mappings yet.`;
    } else {
      summary.textContent = 'No categories configured yet.';
    }
    return;
  }
  const mappedFromData = dataItems.filter(item => map[item]).length;
  if (dataItems.length) {
    summary.textContent = `${totalMappings} mapped item${totalMappings === 1 ? '' : 's'} (${mappedFromData}/${dataItems.length} from current data).`;
  } else {
    summary.textContent = `${totalMappings} mapped item${totalMappings === 1 ? '' : 's'} saved.`;
  }
}


function aggregateOrdersByDate(rows){
  const map = new Map();
  for(const r of rows){ const d = r.__dateIso; const ord = r.__order; if(!d||!ord) continue; const s = map.get(d) || new Set(); s.add(ord); map.set(d,s); }
  const labels = Array.from(map.keys()).sort(); const values = labels.map(l => (map.get(l)?.size || 0));
  return { labels, values };
}

function rollingAverage(series, n){
  const labels = series.map(s=>s.label);
  const values = [];
  let sum = 0; const q = [];
  for (let i=0;i<series.length;i++){
    q.push(series[i].value); sum += series[i].value; if (q.length>n) sum -= q.shift();
    values.push(Number((sum / q.length).toFixed(2)));
  }
  return { labels, values };
}

function monthOverMonthChange(monthSeries){
  const labels = monthSeries.map(m=>m.period);
  const values = monthSeries.map((m,i)=> {
    if (i===0) return 0; const prev = monthSeries[i-1].revenue||0; const cur = m.revenue||0; return prev ? Number((((cur - prev)/prev)*100).toFixed(2)) : 0;
  });
  return { labels, values };
}

function monthYearOverYearChange(monthSeries){
  // monthSeries: [{ period: 'YYYY-MM', revenue, ... }]
  const map = new Map(monthSeries.map(m => [m.period, m]));
  const labels = monthSeries.map(m => m.period);
  const values = labels.map((p) => {
    const [y, m] = p.split('-'); const prev = `${(+y)-1}-${m}`;
    const curRev = map.get(p)?.revenue || 0; const prevRev = map.get(prev)?.revenue || 0;
    return prevRev ? Number((((curRev - prevRev)/prevRev)*100).toFixed(2)) : 0;
  });
  return { labels, values };
}

// loadBranding function removed - now handled in loadUserSettingsAfterAuth()

async function saveBranding() {
  const name = document.getElementById('brandName')?.value || '';
  const logo = document.getElementById('brandLogo')?.value || '';
  try { await saveUserSettings('brandName', name); await saveUserSettings('brandLogo', logo); alert('Branding saved.'); } catch { alert('Could not save branding.'); }
}

function preparePrintCover() {
  const brand = document.getElementById('brandName')?.value || 'Localytics';
  const logo = document.getElementById('brandLogo')?.value || '';
  const elBrand = document.getElementById('printBrand'); if (elBrand) elBrand.textContent = brand;
  const elLogo = document.getElementById('printLogo'); if (elLogo) { if (logo) { elLogo.src = logo; elLogo.style.display = 'block'; } else { elLogo.style.display = 'none'; } }
  // Filters summary
  const fs = state.filters; const fm = state.mapping;
  const fParts = [];
  if (fs.start) fParts.push(`Start: ${fs.start}`);
  if (fs.end) fParts.push(`End: ${fs.end}`);
  if (fs.item) fParts.push(`Item contains: ${fs.item}`);
  if (fs.client) fParts.push(`Client contains: ${fs.client}`);
  if (fs.staff) fParts.push(`Staff contains: ${fs.staff}`);
  if (fs.order) fParts.push(`Order contains: ${fs.order}`);
  if (fs.category) fParts.push(`Category contains: ${fs.category}`);
  if (fs.revMin) fParts.push(`Min revenue: ${fs.revMin}`);
  if (fs.revMax) fParts.push(`Max revenue: ${fs.revMax}`);
  if (fs.qtyMin) fParts.push(`Min quantity: ${fs.qtyMin}`);
  if (fs.qtyMax) fParts.push(`Max quantity: ${fs.qtyMax}`);
  if (fs.noZero) fParts.push('Exclude zero qty/revenue');
  document.getElementById('printFilters')?.replaceChildren(document.createTextNode(fParts.length? fParts.join(' | ') : 'None'));
  const mParts = [];
  ['date','item','qty','price','cost','revenue','category','order','client','staff'].forEach(k => { if (fm[k]) mParts.push(`${k}: ${fm[k]}`); });
  document.getElementById('printMapping')?.replaceChildren(document.createTextNode(mParts.join(', ')));
}
function normalizeAndDedupe(rows, mapping) {
  console.log('[app] normalizeAndDedupe called with', rows.length, 'rows');
  console.log('[app] Category map available:', state.categoryMap ? Object.keys(state.categoryMap).length + ' mappings' : 'none');

  const orderCol = mapping.order;
  const dateCol = mapping.date;
  const itemCol = mapping.item;
  const qtyCol = mapping.qty;
  const priceCol = mapping.price;
  const costCol = mapping.cost;
  const clientCol = mapping.client;
  const staffCol = mapping.staff;
  const out = [];
  let rowIndex = 0;
  for (const r of rows) {
    const rawOrderVal = orderCol ? (r.__orderRaw ?? r[orderCol]) : '';
    const order = rawOrderVal != null ? String(rawOrderVal).trim() : '';
    const rawItemVal = itemCol ? (r.__itemRaw ?? r[itemCol]) : '';
    const name = rawItemVal != null ? String(rawItemVal).trim() : '';
    const canonName = canonicalizeItemName(name);
    const q = num(r[qtyCol]);
    const p = num(r[priceCol]);
    const c = num(r[costCol]);
    const revenue = Number((q * p).toFixed(2));
    const cost = Number((q * c).toFixed(2));
    const originalDateVal = dateCol ? (r.__dateRaw ?? r[dateCol]) : (r.__dateRaw ?? r.__dateIso ?? r.__datePretty ?? '');
    const iso = toIsoDate(originalDateVal);
    const pretty = toPrettyDate(originalDateVal);
    const dFull = parseFullDate(originalDateVal);

    // Debug: Log ALL cases where __dateIso will be empty
    if (!iso) {
      console.warn('[normalize] Missing date ISO:', {
        dateCol,
        originalDateVal,
        originalDateValType: typeof originalDateVal,
        originalDateValEmpty: !originalDateVal,
        order: r[state.mapping.order] || 'no-order',
        item: (r[itemCol] || '').substring(0, 30)
      });
    }

    const obj = { ...r };
    obj.__dateRaw = originalDateVal;
    obj.__datePretty = pretty;
    obj.__dateIso = iso || '';
    obj.__dow = (dFull ? dFull.getDay() : null);
    const rawHourCandidate = extractHourFromString(originalDateVal) ?? (dFull ? dFull.getHours() : null);
    const rawHour = Number.isFinite(rawHourCandidate) ? clampHour(rawHourCandidate) : rawHourCandidate;
    obj.__hourRaw = rawHour;
    const adjustedHour = applyHourOffset(rawHour);
    obj.__hour = Number.isFinite(adjustedHour) ? clampHour(adjustedHour) : adjustedHour;
    obj.__quantity = q || 0;
    obj.__price = p || 0;
    obj.__unitCost = c || 0;
    obj.__revenue = revenue || 0;
    obj.__cost = cost || 0;
    obj.__profit = Number(((revenue || 0) - (cost || 0)).toFixed(2));
    obj.__order = order || 'undefined';
    obj.__orderRaw = rawOrderVal != null ? String(rawOrderVal) : '';
    obj.__itemRaw = rawItemVal != null ? String(rawItemVal) : '';
    obj.__item = canonName;
    obj.__client = clientCol ? (r[clientCol] || 'undefined') : 'undefined';
    obj.__staff = staffCol ? (r[staffCol] || 'undefined') : 'undefined';
    // Category: manual mapping overrides CSV
    const manualCat = state.categoryMap && name ? (state.categoryMap[name] || state.categoryMap[canonName] || '') : '';
    const csvCat = mapping.category ? (r[mapping.category] || '') : '';
    obj.__category = (manualCat || csvCat || '').toString().trim() || 'Uncategorized';
    // Debug log first few rows
    if (rowIndex < 5) {
      console.log(`[app][normalizeAndDedupe Row ${rowIndex}] Item: "${name}", Canon: "${canonName}"`);
      console.log(`[app][normalizeAndDedupe Row ${rowIndex}] Manual: "${manualCat}", CSV: "${csvCat}", Final: "${obj.__category}"`);
    }
    rowIndex++;
    // Allowed items filter (hard-coded list in settings, canonical)
    const allowed = window.__allowedItemsList || [];
    const enforce = window.__enforceAllowed || false;
    const allowedCanon = window.__allowedCanonSet || new Set(allowed.map(canonicalizeItemName));
    if (enforce && allowed.length) {
      if (!allowedCanon.has(canonName)) continue;
    }
    out.push(obj);
  }
  return out;
}

// Async version with chunked progress updates (UI-friendly for large datasets)
async function normalizeAndDedupeAsync(rows, mapping, onProgress) {
  console.log('[app] Starting normalizeAndDedupeAsync with', rows.length, 'rows');
  console.log('[app] Mapping:', mapping);
  console.log('[app] Category map available:', state.categoryMap ? Object.keys(state.categoryMap).length + ' mappings' : 'none');

  const orderCol = mapping.order;
  const dateCol = mapping.date;
  const itemCol = mapping.item;
  const qtyCol = mapping.qty;
  const priceCol = mapping.price;
  const costCol = mapping.cost;
  const clientCol = mapping.client;
  const staffCol = mapping.staff;
  const total = rows.length || 0;
  const chunk = Math.max(500, Math.floor(total / 20) || 500);

  console.log('[app] Using columns - date:', dateCol, 'item:', itemCol, 'qty:', qtyCol, 'price:', priceCol);
  const out = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const rawOrderVal = orderCol ? (r.__orderRaw ?? r[orderCol]) : '';
    const order = rawOrderVal != null ? String(rawOrderVal).trim() : '';
    const rawItemVal = itemCol ? (r.__itemRaw ?? r[itemCol]) : '';
    const name = rawItemVal != null ? String(rawItemVal).trim() : '';
    const canonName = canonicalizeItemName(name);
    const q = num(r[qtyCol]);
    const p = num(r[priceCol]);
    const c = num(r[costCol]);
    const revenue = Number((q * p).toFixed(2));
    const cost = Number((q * c).toFixed(2));
    const originalDateVal = dateCol ? (r.__dateRaw ?? r[dateCol]) : (r.__dateRaw ?? r.__dateIso ?? r.__datePretty ?? '');
    const iso = toIsoDate(originalDateVal);
    const pretty = toPrettyDate(originalDateVal);
    const dFull = parseFullDate(originalDateVal);

    // Debug: Log ALL cases where __dateIso will be empty
    if (!iso) {
      console.warn('[normalize-async] Missing date ISO:', {
        dateCol,
        originalDateVal,
        originalDateValType: typeof originalDateVal,
        originalDateValEmpty: !originalDateVal,
        order: r[state.mapping.order] || 'no-order',
        item: (r[itemCol] || '').substring(0, 30)
      });
    }

    const obj = { ...r };
    obj.__dateRaw = originalDateVal;
    obj.__datePretty = pretty;
    obj.__item = canonName; // Store canonicalized item name for synonym support
    obj.__dateIso = iso || '';
    obj.__dow = (dFull ? dFull.getDay() : null);
    const rawHourCandidate = extractHourFromString(originalDateVal) ?? (dFull ? dFull.getHours() : null);
    const rawHour = Number.isFinite(rawHourCandidate) ? clampHour(rawHourCandidate) : rawHourCandidate;
    obj.__hourRaw = rawHour;
    const adjustedHour = applyHourOffset(rawHour);
    obj.__hour = Number.isFinite(adjustedHour) ? clampHour(adjustedHour) : adjustedHour;
    obj.__quantity = q || 0;
    obj.__price = p || 0;
    obj.__unitCost = c || 0;
    obj.__revenue = revenue || 0;
    obj.__cost = cost || 0;
    obj.__profit = Number(((revenue || 0) - (cost || 0)).toFixed(2));
    obj.__order = order || 'undefined';
    obj.__orderRaw = rawOrderVal != null ? String(rawOrderVal) : '';
    obj.__itemRaw = rawItemVal != null ? String(rawItemVal) : '';
    obj.__client = clientCol ? (r[clientCol] || 'undefined') : 'undefined';
    obj.__staff = staffCol ? (r[staffCol] || 'undefined') : 'undefined';
    const manualCat = state.categoryMap && name ? (state.categoryMap[name] || state.categoryMap[canonName] || '') : '';
    const csvCat = mapping.category ? (r[mapping.category] || '') : '';
    obj.__category = (manualCat || csvCat || '').toString().trim() || 'Uncategorized';
    // Debug log first few category applications
    if (i < 5) {
      console.log(`[app][Row ${i}] Item: "${name}", Canon: "${canonName}"`);
      console.log(`[app][Row ${i}] Manual cat: "${manualCat}", CSV cat: "${csvCat}", Final: "${obj.__category}"`);
      if (state.categoryMap && Object.keys(state.categoryMap).length > 0 && i === 0) {
        console.log(`[app] Sample of categoryMap:`, Object.entries(state.categoryMap).slice(0, 5));
      }
    }
    const allowed = window.__allowedItemsList || [];
    const enforce = window.__enforceAllowed || false;
    const allowedCanon = window.__allowedCanonSet || new Set(allowed.map(canonicalizeItemName));
    if (!(enforce && allowed.length && !allowedCanon.has(canonName))) {
      out.push(obj);
    }
    if (onProgress && (i % chunk === 0 || i === rows.length - 1)) {
      const pct = total > 0 ? Math.floor(((i + 1) / total) * 100) : 100;
      try { onProgress(pct, i + 1); } catch {}
      await new Promise(requestAnimationFrame);
    }
  }
  console.log('[app] normalizeAndDedupeAsync complete - output rows:', out.length);
  if (out.length > 0) {
    console.log('[app] Sample normalized row:', out[0]);

    // DEBUG: Log actual date range in normalized data
    const allDates = out.map(r => r.__dateIso).filter(Boolean).sort();
    const uniqueDates = [...new Set(allDates)];
    console.log('[app] Date range in normalized data:', {
      earliest: allDates[0],
      latest: allDates[allDates.length - 1],
      totalDates: allDates.length,
      uniqueDates: uniqueDates.length,
      first5: uniqueDates.slice(0, 5),
      last5: uniqueDates.slice(-5)
    });

    // Count rows by month
    const monthCounts = {};
    allDates.forEach(iso => {
      const month = iso.substring(0, 7); // YYYY-MM
      monthCounts[month] = (monthCounts[month] || 0) + 1;
    });
    console.log('[app] Rows by month:', monthCounts);
  } else {
    console.warn('[app] WARNING: No rows in normalized output!');
  }
  return out;
}

// Canonicalize item names to match allowed list despite input variants
function canonicalizeItemName(raw) {
  if (!raw) return '';
  let s = String(raw);

  // Debug: Log what's coming in and what synonyms are available
  const debugSynonyms = raw && (raw.toLowerCase().includes('tri') || raw.toLowerCase().includes('northern'));
  if (debugSynonyms) {
    console.log(`[canonicalizeItemName] Input: "${raw}", Synonyms loaded:`, state.itemSynonyms);
  }

  // STEP 1: Normalize quotes and dashes first
  s = s.replace(/[\u2018\u2019\u2032]/g, "'").replace(/[\u201C\u201D\u2033]/g, '"').replace(/[\u2013\u2014]/g, '-');

  // STEP 2: Normalize fractions and decimal inch patterns for .75 and 1.5
  // Replace ¾ with .75, ½ with .5, ¼ with .25
  s = s.replace(/¾/g, '.75').replace(/½/g, '.5').replace(/¼/g, '.25');
  // Convert common fraction text patterns
  s = s.replace(/\b3\s*\/\s*4\b/g, '.75').replace(/\b1\s*[\-\s]?1\s*\/\s*2\b/g, '1.5');
  // Normalize decimals with leading zero
  s = s.replace(/\b0\.75\b/g, '.75');
  // Ensure inch symbol is a straight quote right after number if inches are implied
  s = s.replace(/(\.75|1\.5)\s*(?:in(ch)?|"|"|\b)/gi, (m, num) => `${num}" `);

  // STEP 3: Collapse multiple spaces
  s = s.replace(/\s+/g, ' ').trim();

  // STEP 4: Fix known wording variants (standardize format before applying synonyms)
  s = s.replace(/\btri[-\s]?color\b/gi, 'Tri Color')
       .replace(/\bcolorado\s+rose\b/gi, 'Colorado Rose')
       .replace(/\bsqueegee\b/gi, 'Squeege')
       .replace(/^planters mix\b.*$/i, 'Planters Mix');

  // STEP 5: Apply user-defined synonyms (after standardization so variants are normalized)
  try {
    if (Array.isArray(state.itemSynonyms) && state.itemSynonyms.length > 0) {
      const originalName = s;
      state.itemSynonyms.forEach(({from, to}) => {
        if (!from) return;
        const re = new RegExp(`\\b${escapeRegExp(from)}\\b`, 'gi');
        const beforeReplace = s;
        s = s.replace(re, to);
        if (s !== beforeReplace) {
          console.log(`[canonicalizeItemName] Synonym applied: "${beforeReplace}" → "${s}" (rule: "${from}" => "${to}")`);
        }
      });
      if (s !== originalName) {
        console.log(`[canonicalizeItemName] Final after synonyms: "${originalName}" → "${s}"`);
      }
    }
  } catch (e) {
    console.warn('[canonicalizeItemName] Error applying synonyms:', e);
  }

  // STEP 6: Handle hardcoded rebrands (keep these for specific compound names that synonyms might miss)
  s = s.replace(/\bTri[\-\s]?Color\s+River\s+Rock\b/gi, 'Northern River Rock')
       .replace(/\bTri[\-\s]?Color\s+Cobble\b/gi, 'Northern Cobble');
  // Title case words except those with quotes/numbers preserved
  s = s.split(' ').map(w => {
    if (/^[0-9\.\-\"']/.test(w)) return w; // keep as-is for size/range tokens
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(' ');
  // Tidy quotes spacing
  s = s.replace(/\"\s+/g, '" ')
       .replace(/\s+\"/g, ' "');
  return s.trim();
}

function escapeRegExp(str){ return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function num(v){ if (v==null) return 0; if (typeof v==='number') return v; const s=String(v).replace(/[$,\s]/g,''); const n=Number(s); return Number.isFinite(n)?n:0; }
function toIsoDate(v){ if(!v) return ''; try{ const m=String(v).match(/^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/); if(m){ const months={Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12}; const mm=String(months[m[1]]).padStart(2,'0'); const dd=String(m[2]).padStart(2,'0'); const yyyy=m[3]; return `${yyyy}-${mm}-${dd}`;} const d=new Date(v); if(!Number.isNaN(d.getTime())){ const yyyy=d.getFullYear(); const mm=String(d.getMonth()+1).padStart(2,'0'); const dd=String(d.getDate()).padStart(2,'0'); return `${yyyy}-${mm}-${dd}`; } }catch{} return ''; }
function toPrettyDate(v){ if(!v) return ''; const m=String(v).match(/^([A-Za-z]{3}\s+\d{1,2}\s+\d{4})/); if(m) return m[1]; const isoMatch=String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/); if(isoMatch){ const months=['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']; return `${months[parseInt(isoMatch[2])]} ${parseInt(isoMatch[3])} ${isoMatch[1]}`; } try { return new Date(v).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'2-digit'}); } catch { return String(v); } }
function parseFullDate(v){ try { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; } catch { return null; } }
function extractHourFromString(v){
  if (!v) return null;
  try {
    const str = String(v).trim();
    if (!str) return null;

    const ampmMatch = str.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)/i);
    if (ampmMatch) {
      let hour = parseInt(ampmMatch[1], 10);
      const period = ampmMatch[3].toUpperCase();
      if (period === 'PM' && hour !== 12) hour += 12;
      else if (period === 'AM' && hour === 12) hour = 0;
      return clampHour(hour);
    }

    const ampmCompactMatch = str.match(/(?:^|\s)(\d{1,2})\s*(AM|PM)(?:\b|\s)/i);
    if (ampmCompactMatch) {
      let hour = parseInt(ampmCompactMatch[1], 10);
      const period = ampmCompactMatch[2].toUpperCase();
      if (period === 'PM' && hour !== 12) hour += 12;
      else if (period === 'AM' && hour === 12) hour = 0;
      return clampHour(hour);
    }

    const isoMatch = str.match(/T(\d{2}):(\d{2})/);
    if (isoMatch) {
      return clampHour(parseInt(isoMatch[1], 10));
    }

    const twentyFourMatch = str.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\b/);
    if (twentyFourMatch) {
      return clampHour(parseInt(twentyFourMatch[1], 10));
    }

    const compactMatch = str.match(/(?:T|\s|_)(\d{2})(\d{2})(\d{2})(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/);
    if (compactMatch) {
      return clampHour(parseInt(compactMatch[1], 10));
    }

    const shortCompact = str.match(/(?:^|\s)(\d{2})(\d{2})(?:\d{2})?(?:\s|$)/);
    if (shortCompact) {
      return clampHour(parseInt(shortCompact[1], 10));
    }
  } catch (err) {
    console.debug('[extractHourFromString] Failed to parse hour:', { value: v, error: err });
  }
  return null;
}

function collectFilterValues(prefix) {
  const getInput = (suffix) => document.getElementById(`${prefix}Filter${suffix}`);
  const value = (suffix) => (getInput(suffix)?.value || '').trim();

  // For trends and analytics, only collect staff filter
  if (prefix === 'trends' || prefix === 'analytics') {
    return {
      staff: value('Staff'),
    };
  }

  // For other pages, collect all filters
  return {
    start: value('Start'),
    end: value('End'),
    item: value('Item'),
    client: value('Client'),
    staff: value('Staff'),
    order: value('Order'),
    category: value('Category'),
    revMin: value('RevMin'),
    revMax: value('RevMax'),
    qtyMin: value('QtyMin'),
    qtyMax: value('QtyMax'),
    noZero: !!getInput('NoZero')?.checked
  };
}

function filtersMatchDefault(filters) {
  if (!filters) return true;

  // Check if these are simple filters (trends/analytics)
  const isSimple = Object.keys(filters).length === 1 && 'staff' in filters;
  const defaultToUse = isSimple ? SIMPLE_DEFAULT_FILTERS : DEFAULT_FILTERS;

  return Object.keys(defaultToUse).every(key => {
    const defaultVal = defaultToUse[key];
    const current = filters[key];
    if (key === 'noZero') {
      return !!current === !!defaultVal;
    }
    return (current || '') === (defaultVal || '');
  });
}

function clampHour(hour) {
  const n = Number(hour);
  if (!Number.isFinite(n)) return 0;
  return Math.min(23, Math.max(0, Math.floor(n)));
}

function formatHourLabel(hour) {
  const h = clampHour(hour);
  const period = h < 12 ? 'AM' : 'PM';
  let display = h % 12;
  if (display === 0) display = 12;
  return `${display}${period}`;
}

function aggregateRevenueByHour(rows, options = {}) {
  const {
    businessStart = 7,
    businessEnd = 17,
    filterRow,
    fallbackToUnfiltered = true,
    mapping = null
  } = options;

  const totalRows = Array.isArray(rows) ? rows.length : 0;
  const totalsAll = new Array(24).fill(0);
  const totalsFiltered = filterRow ? new Array(24).fill(0) : null;
  let rowsWithHourAll = 0;
  let rowsWithHourFiltered = 0;

  const seenSources = new WeakMap();
  const missingHourSamples = [];
  const missingHourLimit = 8;

  function resolveHour(row) {
    if (!row) return null;

    const stored = row.__hour;
    if (stored !== undefined && stored !== null && stored !== '') {
      const n = Number(stored);
      if (Number.isFinite(n)) return clampHour(n);
    }

    const cacheKey = row;
    if (seenSources.has(cacheKey)) {
      return seenSources.get(cacheKey);
    }

    const candidates = [];
    if (row.__dateRaw) candidates.push(row.__dateRaw);
    if (mapping?.date && row[mapping.date]) candidates.push(row[mapping.date]);
    if (row.__dateIso) candidates.push(row.__dateIso);
    if (row.__datePretty) candidates.push(row.__datePretty);

    let computed = null;
    for (const candidate of candidates) {
      if (!candidate) continue;
      const fromString = extractHourFromString(candidate);
      if (fromString !== null && fromString !== undefined) {
        computed = clampHour(fromString);
        break;
      }
      const parsed = parseFullDate(candidate);
      if (parsed) {
        computed = clampHour(parsed.getHours());
        break;
      }
    }

    if (computed !== null && computed !== undefined) {
      const adjusted = applyHourOffset(computed);
      row.__hourRaw = clampHour(computed);
      const finalHour = Number.isFinite(adjusted) ? clampHour(adjusted) : adjusted;
      row.__hour = finalHour;
      computed = finalHour;
    }

    seenSources.set(cacheKey, computed);
    return computed;
  }

  function recordMissing(row) {
    if (!row || missingHourSamples.length >= missingHourLimit) return;
    const sample = {
      dateRaw: row.__dateRaw ?? null,
      mappedValue: mapping?.date ? (row[mapping.date] ?? null) : null,
      dateIso: row.__dateIso ?? null,
      hourField: row.__hour ?? null
    };
    missingHourSamples.push(sample);
  }

  for (const row of rows || []) {
    if (!row) continue;
    const computedHour = resolveHour(row);
    if (computedHour === null || computedHour === undefined) {
      recordMissing(row);
      continue;
    }
    const hour = clampHour(computedHour);
    const revenue = Number(row.__revenue || 0);
    rowsWithHourAll++;
    totalsAll[hour] += revenue;
    if (!filterRow || filterRow(row)) {
      rowsWithHourFiltered++;
      if (totalsFiltered) totalsFiltered[hour] += revenue;
    }
  }

  let hourTotals = totalsAll;
  let rowsWithHour = rowsWithHourAll;
  let filterApplied = false;
  let filterDropped = false;

  if (filterRow) {
    if (rowsWithHourFiltered > 0) {
      hourTotals = totalsFiltered;
      rowsWithHour = rowsWithHourFiltered;
      filterApplied = true;
    } else if (!fallbackToUnfiltered) {
      hourTotals = totalsFiltered;
      rowsWithHour = rowsWithHourFiltered;
      filterApplied = true;
    } else {
      hourTotals = totalsAll;
      rowsWithHour = rowsWithHourAll;
      filterDropped = true;
    }
  }

  const start = clampHour(businessStart);
  const end = clampHour(Math.max(businessStart, businessEnd));
  const businessSlice = hourTotals.slice(start, end + 1);
  const businessSum = businessSlice.reduce((sum, val) => sum + val, 0);

  let chartStart = start;
  let chartEnd = end;
  let fallbackRange = false;

  if (businessSum === 0) {
    let first = -1;
    let last = -1;
    for (let i = 0; i < hourTotals.length; i++) {
      if (hourTotals[i] > 0) {
        first = i;
        break;
      }
    }
    for (let i = hourTotals.length - 1; i >= 0; i--) {
      if (hourTotals[i] > 0) {
        last = i;
        break;
      }
    }

    if (first !== -1 && last !== -1 && first <= last) {
      chartStart = first;
      chartEnd = last;
      fallbackRange = true;
    }
  }

  const labels = [];
  const data = [];
  if (chartStart <= chartEnd) {
    for (let h = chartStart; h <= chartEnd; h++) {
      labels.push(formatHourLabel(h));
      data.push(Number(hourTotals[h].toFixed(2)));
    }
  }

  const totalRevenue = data.reduce((sum, val) => sum + val, 0);

  return {
    labels,
    data,
    title: fallbackRange ? 'Revenue by Hour' : 'Revenue (Business Hours)',
    stats: {
      totalRows,
      rowsWithHour,
      businessRange: [start, end],
      chartRange: [chartStart, chartEnd],
      fallbackToObservedRange: fallbackRange,
      filterApplied,
      filterDropped,
      totalRevenue: Number(totalRevenue.toFixed(2)),
      hourOffset: RAW_HOUR_OFFSET,
      missingHourSamples
    },
    buckets: hourTotals.slice(),
    rawAllBuckets: totalsAll.slice(),
    rawFilteredBuckets: totalsFiltered ? totalsFiltered.slice() : null
  };
}

// Chart rendering functions for new pages
function renderTrendsCharts() {
  const usingFiltered = Array.isArray(state.trendsFilteredRows); 
  const baseRows = usingFiltered ? state.trendsFilteredRows : state.rows;
  const workingRows = Array.isArray(baseRows) ? baseRows : [];

  const reportData = computeReport(workingRows, state.mapping);

  if (state.chartRevenue) state.chartRevenue.destroy();
  if (state.chartQty) state.chartQty.destroy();
  if (state.chartOrders) state.chartOrders.destroy();

  const monthlyData = new Map();
  reportData.byDate.forEach(entry => {
    const iso = entry.date || '';
    if (!iso) return;
    const monthKey = iso.substring(0, 7);
    const existing = monthlyData.get(monthKey) || { revenue: 0, quantity: 0, orders: 0 };
    existing.revenue += entry.revenue;
    existing.quantity += entry.quantity;
    existing.orders += (entry.orders || 0);
    monthlyData.set(monthKey, existing);
  });

  // Limit to last 12 months
  const allMonthLabels = Array.from(monthlyData.keys()).sort();
  const monthLabels = allMonthLabels.slice(-12); // Last 12 months only
  const revenueSeries = monthLabels.map(label => round2(monthlyData.get(label).revenue));
  const qtySeries = monthLabels.map(label => round2(monthlyData.get(label).quantity));
  const ordersSeries = monthLabels.map(label => round2(monthlyData.get(label).orders));

  const safeLabels = monthLabels.length ? monthLabels : [''];
  const safeRevenue = monthLabels.length ? revenueSeries : [0];
  const safeQty = monthLabels.length ? qtySeries : [0];
  const safeOrders = monthLabels.length ? ordersSeries : [0];

  const revenueEl = document.getElementById('trends-chart-revenue');
  const qtyEl = document.getElementById('trends-chart-qty');
  const ordersEl = document.getElementById('trends-chart-orders');

  if (revenueEl) {
    state.chartRevenue = makeChart(revenueEl, safeLabels, safeRevenue, 'Revenue by Month');
  }
  if (qtyEl) {
    state.chartQty = makeChart(qtyEl, safeLabels, safeQty, 'Quantity by Month');
  }
  if (ordersEl) {
    state.chartOrders = makeChart(ordersEl, safeLabels, safeOrders, 'Orders by Month');
  }

  renderTrendAnalysisCharts(safeLabels, safeRevenue, safeQty);
  renderTimePatternCharts(workingRows);

  const catTrendCanvas = document.getElementById('trends-chart-cat-trend');
  if (catTrendCanvas) {
    if (state.chartCatTrend) { state.chartCatTrend.destroy(); state.chartCatTrend = null; }
    const catTrend = aggregateByCategoryOverTime(workingRows, state.mapping, 'month', 'revenue', 12);
    if (catTrend.datasets.length) {
      state.chartCatTrend = makeStackedBarChart(catTrendCanvas, catTrend.labels.length ? catTrend.labels : [''], catTrend.datasets);
    } else {
      const ctx = catTrendCanvas.getContext('2d');
      ctx?.clearRect(0, 0, catTrendCanvas.width, catTrendCanvas.height);
    }
  }

  try { enableChartZoom(document.getElementById('view-trends') || document); } catch {}
}

function renderAnalyticsCharts() {
  const usingFiltered = Array.isArray(state.analyticsFilteredRows);
  const baseRows = usingFiltered ? state.analyticsFilteredRows : state.rows;
  const workingRows = Array.isArray(baseRows) ? baseRows : [];
  const hasRows = workingRows.length > 0;

  const reportData = hasRows ? computeReport(workingRows, state.mapping) : (state.report || computeReport([], state.mapping));

  const byClient = hasRows
    ? aggregateByField(workingRows, r => {
        const val = r.__client;
        return (val !== null && val !== undefined && val !== 'undefined' && String(val).trim() !== '') ? val : '';
      })
    : (state.byClient || []);

  const byStaff = hasRows
    ? aggregateByField(workingRows, r => {
        const val = r.__staff;
        const trimmed = String(val).trim();
        return (val !== null && val !== undefined && val !== 'undefined' && trimmed !== '') ? val : '';
      })
    : (state.byStaff || []);

  const byCategory = hasRows
    ? aggregateByField(workingRows, r => {
        const val = r.__category;
        return (val !== null && val !== undefined && val !== 'undefined' && String(val).trim() !== '') ? val : '';
      })
    : (state.byCategory || []);

  const byOrder = hasRows ? aggregateByOrder(workingRows, state.mapping) : (state.byOrder || []);

  const topItems = reportData.byItem.slice(0, 10);
  const topClients = byClient.filter(c => c.label !== 'Windsor Cash').slice(0, 10);

  if (state.chartTopItems) { state.chartTopItems.destroy(); state.chartTopItems = null; }
  if (state.chartTopClients) { state.chartTopClients.destroy(); state.chartTopClients = null; }

  const topItemsCanvas = document.getElementById('analytics-chart-top-items');
  const topClientsCanvas = document.getElementById('analytics-chart-top-clients');

  if (topItemsCanvas) {
    if (topItems.length) {
      state.chartTopItems = makeBarChart(topItemsCanvas,
        topItems.map(x => x.item), topItems.map(x => x.revenue), 'Top Items by Revenue');
    } else {
      topItemsCanvas.getContext('2d')?.clearRect(0, 0, topItemsCanvas.width, topItemsCanvas.height);
    }
  }

  if (topClientsCanvas) {
    if (topClients.length) {
      state.chartTopClients = makeBarChart(topClientsCanvas,
        topClients.map(x => x.label), topClients.map(x => x.revenue), 'Top Clients by Revenue');
    } else {
      topClientsCanvas.getContext('2d')?.clearRect(0, 0, topClientsCanvas.width, topClientsCanvas.height);
    }
  }

  renderProfitabilityCharts(reportData);
  renderSegmentAnalysisCharts(byCategory);

  try { enableChartZoom(document.getElementById('view-analytics') || document); } catch {}
}

function renderTrendAnalysisCharts(labels, revenueData, qtyData) {
  // Rolling averages
  const rolling7Revenue = calculateRollingAverage(revenueData, 7);
  const rolling30Revenue = calculateRollingAverage(revenueData, 30);
  const rollingQty = calculateRollingAverage(qtyData, 7);

  if (state.chartRevRolling) state.chartRevRolling.destroy();
  if (state.chartQtyRolling) state.chartQtyRolling.destroy();
  if (state.chartRevRolling30) state.chartRevRolling30.destroy();

  state.chartRevRolling = makeChart(document.getElementById('trends-chart-rev-rolling'), labels, rolling7Revenue, '7-day Rolling Avg Revenue');
  state.chartQtyRolling = makeChart(document.getElementById('trends-chart-qty-rolling'), labels, rollingQty, '7-day Rolling Quantity');
  state.chartRevRolling30 = makeChart(document.getElementById('trends-chart-rev-rolling-30'), labels, rolling30Revenue, '30-day Rolling Revenue');

  // Month-over-month and YoY changes would require more complex calculations
  // For now, render placeholder charts
  const momData = revenueData.map((v, i) => i > 0 ? ((v - revenueData[i-1]) / revenueData[i-1] * 100) : 0);

  if (state.chartRevMom) state.chartRevMom.destroy();
  state.chartRevMom = makeChart(document.getElementById('trends-chart-rev-mom'), labels, momData, 'Revenue MoM Change %');
}

function renderTimePatternCharts(rowsOverride) {
  const allData = Array.isArray(rowsOverride) ? rowsOverride : state.rows;

  // Day of week analysis
  const dowMap = new Map();
  for (const r of allData) {
    if (r.__client === 'Windsor Cash') continue; // Filter out Windsor Cash
    const dow = r.__dow;
    if (dow !== null && dow !== undefined) {
      const existing = dowMap.get(dow) || { sum: 0, count: 0 };
      existing.sum += Number(r.__revenue || 0);
      existing.count++;
      dowMap.set(dow, existing);
    }
  }

  const dowLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dowData = dowLabels.map((_, i) => {
    const data = dowMap.get(i);
    return data && data.count > 0 ? data.sum / data.count : 0;
  });

  if (state.chartDowRevenue) state.chartDowRevenue.destroy();
  state.chartDowRevenue = makeBarChart(document.getElementById('trends-chart-dow-revenue'), dowLabels, dowData, 'Avg Revenue by Day of Week');

  // Hour of day analysis with Windsor Cash filtered, fallback to full dataset if empty
  const hourSummary = aggregateRevenueByHour(allData, {
    filterRow: (row) => row.__client !== 'Windsor Cash',
    mapping: state.mapping
  });

  console.log('[renderTimePatternCharts] Hour summary:', hourSummary.stats);

  if (state.chartHourRevenue) state.chartHourRevenue.destroy();
  const hourCanvas = document.getElementById('trends-chart-hour-revenue');
  if (hourCanvas) {
    const fallbackHour = hourSummary?.stats?.businessRange ? hourSummary.stats.businessRange[0] : 7;
    const fallbackLabel = formatHourLabel(fallbackHour);
    const labels = hourSummary.labels.length ? hourSummary.labels : [fallbackLabel];
    const data = hourSummary.data.length ? hourSummary.data : [0];
    state.chartHourRevenue = makeBarChart(hourCanvas, labels, data, hourSummary.title);
  }
}

function renderProfitabilityCharts(reportOverride) {
  const source = reportOverride || state.report;
  if (!source) return;

  const monthlyData = new Map();
  source.byDate.forEach(r => {
    const monthKey = r.date.substring(0, 7); // Extract YYYY-MM
    const existing = monthlyData.get(monthKey) || { revenue: 0, cost: 0, profit: 0, count: 0 };
    existing.revenue += r.revenue;
    existing.cost += (r.cost || 0);
    existing.profit += (r.profit || (r.revenue - (r.cost || 0)));
    existing.count++;
    monthlyData.set(monthKey, existing);
  });

  // Limit to last 12 months
  const allLabels = Array.from(monthlyData.keys()).sort();
  const labels = allLabels.slice(-12); // Last 12 months only
  const profitData = labels.map(l => monthlyData.get(l).profit);
  const marginData = labels.map(l => {
    const d = monthlyData.get(l);
    return d.revenue > 0 ? ((d.revenue - d.cost) / d.revenue * 100) : 0;
  });

  if (state.chartProfit) state.chartProfit.destroy();
  if (state.chartMargin) state.chartMargin.destroy();

  state.chartProfit = makeChart(document.getElementById('analytics-chart-profit'), labels, profitData, 'Profit by Month');
  state.chartMargin = makeChart(document.getElementById('analytics-chart-margin'), labels, marginData, 'Margin % by Month');

  // AOV and IPO would require order-level calculations
  const aovData = labels.map(() => Math.random() * 100 + 50); // Placeholder
  const ipoData = labels.map(() => Math.random() * 5 + 1); // Placeholder

  if (state.chartAov) state.chartAov.destroy();
  if (state.chartIpo) state.chartIpo.destroy();

  state.chartAov = makeChart(document.getElementById('analytics-chart-aov'), labels, aovData, 'Average Order Value');
  state.chartIpo = makeChart(document.getElementById('analytics-chart-ipo'), labels, ipoData, 'Items per Order');
}

function renderSegmentAnalysisCharts(categoryDataOverride) {
  const categoryData = categoryDataOverride || state.byCategory || [];
  if (!categoryData.length) {
    // If no category data, show a placeholder or message
    const categoryCanvas = document.getElementById('analytics-chart-category-share');
    if (categoryCanvas) {
      const ctx = categoryCanvas.getContext('2d');
      if (state.chartCatShare) state.chartCatShare.destroy();
      state.chartCatShare = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['No Category Data'],
          datasets: [{
            data: [1],
            backgroundColor: ['#E5E7EB'],
            borderWidth: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            title: { display: true, text: 'Category Share - No Data Available' },
            legend: { display: false }
          }
        }
      });
    }
    return;
  }

  // Sort category data by revenue (descending) for organized legend
  const sortedCategoryData = categoryData.slice().sort((a, b) => b.revenue - a.revenue);

  // Calculate total revenue for percentage calculations
  const totalRevenue = sortedCategoryData.reduce((sum, x) => sum + x.revenue, 0);

  const catLabels = sortedCategoryData.map(x => x.label);
  const catData = sortedCategoryData.map(x => x.revenue);
  const catPercentages = sortedCategoryData.map(x =>
    totalRevenue > 0 ? ((x.revenue / totalRevenue) * 100).toFixed(1) : 0
  );

  if (state.chartCatShare) state.chartCatShare.destroy();

  // Use pie chart with distinct colors from our palette
  const colors = [
    '#dc2626', '#2563eb', '#16a34a', '#f59e0b', '#9333ea',
    '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#8b5cf6',
    '#14b8a6', '#ef4444', '#3b82f6', '#22c55e', '#eab308',
    '#a855f7', '#0ea5e9', '#f43f5e', '#10b981', '#6366f1'
  ];

  const canvas = document.getElementById('analytics-chart-category-share');
  if (canvas) {
    state.chartCatShare = new Chart(canvas, {
      type: 'pie',
      data: {
        labels: catLabels,
        datasets: [{
          data: catData,
          backgroundColor: catLabels.map((_, i) => colors[i % colors.length]),
          borderWidth: 2,
          borderColor: '#fff'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
          legend: {
            position: 'right',
            labels: {
              padding: 10,
              font: { size: 11 },
              color: '#f3f4f6', // Very light grey for better visibility
              generateLabels: (chart) => {
                const data = chart.data;
                return data.labels.map((label, i) => ({
                  text: `${label} (${catPercentages[i]}%)`,
                  fillStyle: data.datasets[0].backgroundColor[i],
                  strokeStyle: data.datasets[0].borderColor,
                  lineWidth: data.datasets[0].borderWidth,
                  hidden: false,
                  index: i,
                  fontColor: '#f3f4f6' // Very light grey for better visibility
                }));
              }
            }
          },
          title: {
            display: true,
            text: 'Category Share (Revenue)'
          }
        }
      }
    });
  }
}

function calculateRollingAverage(data, window) {
  return data.map((val, index) => {
    const start = Math.max(0, index - window + 1);
    const slice = data.slice(start, index + 1);
    return slice.reduce((sum, v) => sum + v, 0) / slice.length;
  });
}

// Enhanced number formatting functions with proper 2 decimal places and commas
function formatCurrency(amount) {
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(amount) || 0);
}

function formatPercent(num) {
  return `${(Number(num) || 0).toFixed(2)}%`;
}


// Client and Order Detail Modal Functions
function showClientDetails(clientName) {
  console.log('showClientDetails called with:', clientName);

  // Get all transactions for this client - always use state.rows to match aggregation source
  const base = state.rows;

  // Match using the same logic as aggregation field function
  const clientTransactions = base.filter(row => {
    const val = row.__client;
    // Apply same transformation as aggregation: filter out null/undefined/'undefined'/empty
    const normalizedClient = (val !== null && val !== undefined && val !== 'undefined' && String(val).trim() !== '') ? String(val).trim() : '';

    // Also check raw column value as fallback
    const rawClient = row[state.mapping?.client] || '';
    const normalizedRaw = (rawClient && rawClient !== 'undefined' && String(rawClient).trim() !== '') ? String(rawClient).trim() : '';

    // Match against either normalized value
    return normalizedClient.toLowerCase() === clientName.toLowerCase() ||
           normalizedRaw.toLowerCase() === clientName.toLowerCase();
  });

  if (!clientTransactions.length) {
    alert('No transactions found for this client.');
    return;
  }

  // Aggregate products by item name with quantities
  const productMap = new Map();
  let totalRevenue = 0;
  let totalQuantity = 0;
  let totalCost = 0;
  let totalOrders = new Set();

  clientTransactions.forEach(row => {
    const itemName = row.__item || row[state.mapping.item] || 'Unknown Item';
    const quantity = row.__quantity || 0;
    const revenue = row.__revenue || 0;
    const cost = row.__cost || 0;
    const order = row.__order || '';

    if (order) totalOrders.add(order);
    totalRevenue += revenue;
    totalQuantity += quantity;
    totalCost += cost;

    if (productMap.has(itemName)) {
      const existing = productMap.get(itemName);
      existing.quantity += quantity;
      existing.revenue += revenue;
      existing.cost += cost;
      existing.orders.add(order);
    } else {
      productMap.set(itemName, {
        item: itemName,
        quantity: quantity,
        revenue: revenue,
        cost: cost,
        orders: new Set([order])
      });
    }
  });

  // Convert to array and sort by revenue
  const products = Array.from(productMap.values())
    .map(p => ({
      ...p,
      profit: p.revenue - p.cost,
      margin: p.revenue > 0 ? ((p.revenue - p.cost) / p.revenue * 100) : 0,
      orders: p.orders.size,
      ordersList: Array.from(p.orders).filter(o => o)
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const totalProfit = totalRevenue - totalCost;
  const totalMargin = totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100) : 0;

  // Build summary and table
  const summaryHtml = `
    <div class="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
      <div class="app-card border app-border rounded-lg p-4">
        <div class="text-sm text-gray-500">Total Revenue</div>
        <div class="text-lg font-semibold text-gray-900">${formatCurrency(totalRevenue)}</div>
      </div>
      <div class="app-card border app-border rounded-lg p-4">
        <div class="text-sm text-gray-500">Total Quantity</div>
        <div class="text-lg font-semibold text-gray-900">${formatNumber(totalQuantity)}</div>
      </div>
      <div class="app-card border app-border rounded-lg p-4">
        <div class="text-sm text-gray-500">Total Orders</div>
        <div class="text-lg font-semibold text-gray-900">${totalOrders.size.toFixed(0)}</div>
      </div>
      <div class="app-card border app-border rounded-lg p-4">
        <div class="text-sm text-gray-500">Profit Margin</div>
        <div class="text-lg font-semibold text-gray-900">${formatPercent(totalMargin)}</div>
      </div>
    </div>
    <h4 class="text-lg font-medium text-gray-900 mb-4">Product Breakdown (${products.length} items)</h4>
  `;


  // Bypass CSS conflicts by creating a fresh modal overlay
  const existingOverlay = document.getElementById('temp-modal-overlay');
  if (existingOverlay) {
    existingOverlay.remove();
  }

  // Detect dark mode
  const isDark = document.documentElement.classList.contains('dark');

  const overlay = document.createElement('div');
  overlay.id = 'temp-modal-overlay';
  overlay.style.cssText = `
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    z-index: 999999 !important;
    background: rgba(0,0,0,0.5) !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    padding: 16px !important;
  `;

  const modalContent = document.createElement('div');
  modalContent.style.cssText = `
    background: ${isDark ? '#1f2937' : '#ffffff'} !important;
    color: ${isDark ? '#f9fafb' : '#1f2937'} !important;
    border-radius: 8px !important;
    max-width: 800px !important;
    width: 100% !important;
    max-height: 90vh !important;
    overflow: hidden !important;
    display: flex !important;
    flex-direction: column !important;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1) !important;
  `;

  const header = document.createElement('div');
  header.style.cssText = `
    padding: 24px !important;
    border-bottom: 1px solid ${isDark ? '#374151' : '#e5e7eb'} !important;
    display: flex !important;
    justify-content: space-between !important;
    align-items: center !important;
  `;

  const titleEl = document.createElement('h3');
  titleEl.textContent = `Client Details: ${clientName}`;
  titleEl.style.cssText = `
    font-size: 18px !important;
    font-weight: 600 !important;
    margin: 0 !important;
    color: ${isDark ? '#f9fafb' : '#1f2937'} !important;
  `;

  const buttonGroup = document.createElement('div');
  buttonGroup.style.cssText = `
    display: flex !important;
    gap: 8px !important;
    align-items: center !important;
  `;

  const printBtn = document.createElement('button');
  printBtn.innerHTML = '🖨️ Print';
  printBtn.className = 'no-print';
  printBtn.style.cssText = `
    background: ${isDark ? '#374151' : '#e5e7eb'} !important;
    border: none !important;
    padding: 6px 12px !important;
    border-radius: 4px !important;
    cursor: pointer !important;
    font-size: 14px !important;
    color: ${isDark ? '#f9fafb' : '#1f2937'} !important;
  `;
  printBtn.onclick = () => window.print();

  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '✕';
  closeBtn.className = 'no-print';
  closeBtn.style.cssText = `
    background: none !important;
    border: none !important;
    font-size: 24px !important;
    cursor: pointer !important;
    padding: 8px !important;
    border-radius: 4px !important;
    color: ${isDark ? '#9ca3af' : '#6b7280'} !important;
  `;
  closeBtn.onclick = () => overlay.remove();

  buttonGroup.appendChild(printBtn);
  buttonGroup.appendChild(closeBtn);

  const contentArea = document.createElement('div');
  contentArea.style.cssText = `
    flex: 1 !important;
    overflow: auto !important;
    padding: 24px !important;
    background: ${isDark ? '#1f2937' : '#ffffff'} !important;
  `;

  // Add summary HTML
  contentArea.innerHTML = summaryHtml;

  // Create table container for sortable table
  const tableWrapper = document.createElement('div');
  tableWrapper.className = 'overflow-x-auto border app-border rounded-md';
  tableWrapper.style.cssText = `
    background: ${isDark ? '#1f2937' : '#ffffff'} !important;
  `;

  contentArea.appendChild(tableWrapper);

  // Render sortable table with product data (pass raw values, formatCell will handle formatting)
  renderSortableTable(
    tableWrapper,
    ['item', 'quantity', 'revenue', 'cost', 'profit', 'margin', 'orders'],
    products.map(product => ({
      item: product.item,
      quantity: product.quantity,
      revenue: product.revenue,
      cost: product.cost,
      profit: product.profit,
      margin: product.margin,
      orders: product.orders
    })),
    { defaultSort: { column: 'revenue', direction: 'desc' } }
  );

  header.appendChild(titleEl);
  header.appendChild(buttonGroup);
  modalContent.appendChild(header);
  modalContent.appendChild(contentArea);
  overlay.appendChild(modalContent);

  // Close on backdrop click
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  document.body.appendChild(overlay);

  console.log('Created bypass modal overlay');
}

function showOrderDetails(orderNumber) {
  // Get all transactions for this order - always use state.rows to match aggregation source
  const base = state.rows;

  // Match using normalized order values (exclude 'undefined' sentinel)
  const orderTransactions = base.filter(row => {
    const orderVal = row.__order || '';
    const normalizedOrder = (orderVal && orderVal !== 'undefined' && String(orderVal).trim() !== '') ? String(orderVal).trim() : '';
    return normalizedOrder.toLowerCase() === orderNumber.toLowerCase();
  });

  if (!orderTransactions.length) {
    alert('No transactions found for this order.');
    return;
  }

  // Debug log for diagnosing quantity issues
  console.log('[showOrderDetails] Order:', orderNumber);
  console.log('[showOrderDetails] Transactions:', orderTransactions.length);
  console.log('[showOrderDetails] Sample transaction:', {
    __quantity: orderTransactions[0].__quantity,
    __revenue: orderTransactions[0].__revenue,
    __price: orderTransactions[0].__price,
    rawQtyCol: orderTransactions[0][state.mapping.qty],
    mapping: state.mapping
  });

  // Get order summary info
  const firstTransaction = orderTransactions[0];
  const orderDate = firstTransaction[state.mapping.date] || 'Unknown Date';
  const clientName = firstTransaction.__client || 'Unknown Client';
  const staffName = firstTransaction.__staff || 'Unknown Staff';

  let totalRevenue = 0;
  let totalQuantity = 0;
  let totalCost = 0;

  const items = orderTransactions.map(row => {
    const quantity = row.__quantity || 0;
    const revenue = row.__revenue || 0;
    const cost = row.__cost || 0;
    const price = row.__price || 0;

    totalRevenue += revenue;
    totalQuantity += quantity;
    totalCost += cost;

    return {
      item: row.__item || row[state.mapping.item] || 'Unknown Item',
      quantity: quantity,
      price: price,
      revenue: revenue,
      cost: cost,
      profit: revenue - cost,
      margin: revenue > 0 ? ((revenue - cost) / revenue * 100) : 0
    };
  });

  const totalProfit = totalRevenue - totalCost;
  const marginPct = totalRevenue > 0 ? ((totalProfit / totalRevenue) * 100) : 0;

  // Build summary and table
  const summaryHtml = `
    <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
      <div class="app-card border app-border rounded-lg p-4">
        <div class="text-sm text-gray-500">Order Date</div>
        <div class="text-lg font-semibold text-gray-900">${escapeHtml(orderDate)}</div>
      </div>
      <div class="app-card border app-border rounded-lg p-4">
        <div class="text-sm text-gray-500">Client</div>
        <div class="text-lg font-semibold text-gray-900 cursor-pointer text-blue-600 hover:text-blue-800" onclick="showClientDetails('${escapeHtml(clientName)}')">${escapeHtml(clientName)}</div>
      </div>
      <div class="app-card border app-border rounded-lg p-4">
        <div class="text-sm text-gray-500">Staff</div>
        <div class="text-lg font-semibold text-gray-900">${escapeHtml(staffName)}</div>
      </div>
      <div class="app-card border app-border rounded-lg p-4">
        <div class="text-sm text-gray-500">Total Items</div>
        <div class="text-lg font-semibold text-gray-900">${items.length.toFixed(0)}</div>
      </div>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-6">
      <div class="app-card border app-border rounded-lg p-4">
        <div class="text-sm text-gray-500">Total Revenue</div>
        <div class="text-lg font-semibold text-gray-900">${formatCurrency(totalRevenue)}</div>
      </div>
      <div class="app-card border app-border rounded-lg p-4">
        <div class="text-sm text-gray-500">Total Quantity</div>
        <div class="text-lg font-semibold text-gray-900">${formatNumber(totalQuantity)}</div>
      </div>
      <div class="app-card border app-border rounded-lg p-4">
        <div class="text-sm text-gray-500">Profit</div>
        <div class="text-lg font-semibold text-gray-900">${formatCurrency(totalProfit)}</div>
      </div>
      <div class="app-card border app-border rounded-lg p-4">
        <div class="text-sm text-gray-500">Margin</div>
        <div class="text-lg font-semibold text-gray-900">${formatPercent(marginPct)}</div>
      </div>
    </div>
    <h4 class="text-lg font-medium text-gray-900 mb-4">Order Items (${items.length} items)</h4>
  `;

  // Bypass CSS conflicts by creating a fresh modal overlay
  const existingOverlay = document.getElementById('temp-order-modal-overlay');
  if (existingOverlay) {
    existingOverlay.remove();
  }

  // Detect dark mode
  const isDark = document.documentElement.classList.contains('dark');

  const overlay = document.createElement('div');
  overlay.id = 'temp-order-modal-overlay';
  overlay.style.cssText = `
    position: fixed !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    bottom: 0 !important;
    z-index: 999999 !important;
    background: rgba(0,0,0,0.5) !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    padding: 16px !important;
  `;

  const modalContent = document.createElement('div');
  modalContent.style.cssText = `
    background: ${isDark ? '#1f2937' : '#ffffff'} !important;
    color: ${isDark ? '#f9fafb' : '#1f2937'} !important;
    border-radius: 8px !important;
    max-width: 900px !important;
    width: 100% !important;
    max-height: 90vh !important;
    overflow: hidden !important;
    display: flex !important;
    flex-direction: column !important;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1) !important;
  `;

  const header = document.createElement('div');
  header.style.cssText = `
    padding: 24px !important;
    border-bottom: 1px solid ${isDark ? '#374151' : '#e5e7eb'} !important;
    display: flex !important;
    justify-content: space-between !important;
    align-items: center !important;
  `;

  const titleEl = document.createElement('h3');
  titleEl.textContent = `Order Details: ${orderNumber}`;
  titleEl.style.cssText = `
    font-size: 18px !important;
    font-weight: 600 !important;
    margin: 0 !important;
    color: ${isDark ? '#f9fafb' : '#1f2937'} !important;
  `;

  const buttonGroup = document.createElement('div');
  buttonGroup.style.cssText = `
    display: flex !important;
    gap: 8px !important;
    align-items: center !important;
  `;

  const printBtn = document.createElement('button');
  printBtn.innerHTML = '🖨️ Print';
  printBtn.className = 'no-print';
  printBtn.style.cssText = `
    background: ${isDark ? '#374151' : '#e5e7eb'} !important;
    border: none !important;
    padding: 6px 12px !important;
    border-radius: 4px !important;
    cursor: pointer !important;
    font-size: 14px !important;
    color: ${isDark ? '#f9fafb' : '#1f2937'} !important;
  `;
  printBtn.onclick = () => window.print();

  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '✕';
  closeBtn.className = 'no-print';
  closeBtn.style.cssText = `
    background: none !important;
    border: none !important;
    font-size: 24px !important;
    cursor: pointer !important;
    padding: 8px !important;
    border-radius: 4px !important;
    color: ${isDark ? '#9ca3af' : '#6b7280'} !important;
  `;
  closeBtn.onclick = () => overlay.remove();

  buttonGroup.appendChild(printBtn);
  buttonGroup.appendChild(closeBtn);

  const contentArea = document.createElement('div');
  contentArea.style.cssText = `
    flex: 1 !important;
    overflow: auto !important;
    padding: 24px !important;
    background: ${isDark ? '#1f2937' : '#ffffff'} !important;
  `;

  // Add summary HTML
  contentArea.innerHTML = summaryHtml;

  // Create table container for sortable table
  const tableWrapper = document.createElement('div');
  tableWrapper.className = 'overflow-x-auto border app-border rounded-md';
  tableWrapper.style.cssText = `
    background: ${isDark ? '#1f2937' : '#ffffff'} !important;
  `;

  contentArea.appendChild(tableWrapper);

  // Render sortable table with items data (pass raw values, formatCell will handle formatting)
  renderSortableTable(
    tableWrapper,
    ['item', 'quantity', 'price', 'revenue', 'cost', 'profit', 'margin'],
    items.map(item => ({
      item: item.item,
      quantity: item.quantity,
      price: item.price,
      revenue: item.revenue,
      cost: item.cost,
      profit: item.profit,
      margin: item.margin
    })),
    { defaultSort: { column: 'revenue', direction: 'desc' } }
  );

  header.appendChild(titleEl);
  header.appendChild(buttonGroup);
  modalContent.appendChild(header);
  modalContent.appendChild(contentArea);
  overlay.appendChild(modalContent);

  // Close on backdrop click
  overlay.onclick = (e) => {
    if (e.target === overlay) overlay.remove();
  };

  document.body.appendChild(overlay);

  console.log('Created order details modal overlay');
}

// Modal event handlers now integrated into bypass overlay creation (see showClientDetails and showOrderDetails)

// Enhanced table rendering with clickable cells
function renderClickableTable(container, columns, rows, clickableColumns = {}) {
  if (!container) {
    console.warn('renderClickableTable: container element is null');
    return;
  }

  container.innerHTML = '';
  const table = document.createElement('table');
  table.className = 'w-full text-sm';

  // Create header
  const thead = document.createElement('thead');
  thead.innerHTML = `<tr class="app-card">${columns.map(c => `<th class="text-left px-3 py-2 font-medium">${escapeHtml(c)}</th>`).join('')}</tr>`;

  // Create body with clickable cells
  const tbody = document.createElement('tbody');
  rows.forEach(row => {
    const tr = document.createElement('tr');
    tr.className = 'border-t hover:bg-gray-50';

    columns.forEach(column => {
      const td = document.createElement('td');
      td.className = 'px-3 py-2';

      const value = row[column];
      const formattedValue = formatTableCell(column, value);

      // Check if this column should be clickable
      if (clickableColumns[column]) {
        const span = document.createElement('span');
        span.className = 'cursor-pointer text-blue-600 hover:text-blue-800 hover:underline';
        span.textContent = formattedValue;
        span.addEventListener('click', () => {
          if (typeof window[clickableColumns[column]] === 'function') {
            window[clickableColumns[column]](value);
          }
        });
        td.appendChild(span);
      } else {
        td.innerHTML = formattedValue;
      }

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(thead);
  table.appendChild(tbody);
  container.appendChild(table);
}

// Enhanced table rendering with both sorting and clickable functionality
function renderSortableClickableTable(container, columns, rows, options = {}) {
  if (!container) {
    console.warn('renderSortableClickableTable: container element is null');
    return;
  }

  const containerId = container.id || 'table_' + Math.random().toString(36).substr(2, 9);
  if (!container.id) container.id = containerId;

  // State management for sorting with persistence
  const storageKey = `tableSort_${containerId}`;
  let sortState = container._sortState;

  // Try to restore from localStorage first
  if (!sortState) {
    try {
      const saved = localStorage.getItem(storageKey);
      sortState = saved ? JSON.parse(saved) : { column: null, direction: 'asc' };
    } catch {
      sortState = { column: null, direction: 'asc' };
    }
  }

  container._sortState = sortState;

  // Apply default sorting if specified and no saved state
  if (options.defaultSort && !sortState.column) {
    sortState.column = options.defaultSort.column;
    sortState.direction = options.defaultSort.direction || 'desc';
  }

  // Sort rows if a column is selected
  let sortedRows = [...rows];
  if (sortState.column) {
    sortedRows.sort((a, b) => {
      let aVal = a[sortState.column];
      let bVal = b[sortState.column];

      // Handle different data types
      if (isNumeric(aVal) && isNumeric(bVal)) {
        aVal = Number(aVal);
        bVal = Number(bVal);
      } else {
        aVal = String(aVal || '').toLowerCase();
        bVal = String(bVal || '').toLowerCase();
      }

      let result = 0;
      if (aVal < bVal) result = -1;
      else if (aVal > bVal) result = 1;

      return sortState.direction === 'desc' ? -result : result;
    });
  }

  container.innerHTML = '';

  // Create table with sortable headers
  const table = document.createElement('table');
  table.className = 'w-full text-sm';

  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headerRow.className = 'app-card';

  columns.forEach(column => {
    const th = document.createElement('th');
    th.className = 'text-left px-3 py-2 font-medium cursor-pointer hover:bg-gray-50 select-none';

    const isCurrentSort = sortState.column === column;
    const sortIcon = isCurrentSort
      ? (sortState.direction === 'asc' ? '↑' : '↓')
      : '↕';

    th.innerHTML = `${escapeHtml(column)} <span class="text-gray-400 text-xs">${sortIcon}</span>`;

    th.addEventListener('click', () => {
      if (sortState.column === column) {
        // Cycle through: desc -> asc -> reset
        if (sortState.direction === 'desc') {
          sortState.direction = 'asc';
        } else if (sortState.direction === 'asc') {
          // Reset sorting
          sortState.column = null;
          sortState.direction = 'desc';
        }
      } else {
        // First click defaults to descending (largest to smallest)
        sortState.column = column;
        sortState.direction = 'desc';
      }

      // Save sort state to localStorage
      try {
        localStorage.setItem(storageKey, JSON.stringify(sortState));
      } catch {}

      renderSortableClickableTable(container, columns, rows, options);
    });

    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  // Create body with clickable cells
  const tbody = document.createElement('tbody');
  sortedRows.forEach(row => {
    const tr = document.createElement('tr');
    tr.className = 'border-t hover:bg-gray-50';

    columns.forEach(column => {
      const td = document.createElement('td');
      td.className = 'px-3 py-2';

      const value = row[column];
      const formattedValue = formatTableCell(column, value);

      // Check if this column should be clickable
      if (options.clickableColumns && options.clickableColumns[column]) {
        const span = document.createElement('span');
        span.className = 'cursor-pointer text-blue-600 hover:text-blue-800 hover:underline';
        span.innerHTML = formattedValue;
        span.addEventListener('click', () => {
          console.log('Click detected on:', value);
          if (typeof window[options.clickableColumns[column]] === 'function') {
            window[options.clickableColumns[column]](value);
          } else {
            console.error('Function not found:', options.clickableColumns[column]);
          }
        });
        td.appendChild(span);
      } else {
        td.innerHTML = formattedValue;
      }

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(thead);
  table.appendChild(tbody);
  container.appendChild(table);
}

// Helper function to check if value is numeric (copied from ui.js)
function isNumeric(v) {
  return v !== null && v !== '' && !Array.isArray(v) && !isNaN(v);
}

// Enhanced table cell formatting with proper number formatting
function formatTableCell(column, value) {
  const columnLower = column.toLowerCase();

  if (columnLower.includes('revenue') || columnLower.includes('cost') || columnLower.includes('profit') || columnLower.includes('price')) {
    return formatCurrency(value);
  }

  if (columnLower.includes('margin')) {
    return formatPercent(value);
  }

  if (columnLower.includes('quantity') || columnLower.includes('orders')) {
    // For quantities and counts, show as integers
    return Number(value || 0).toFixed(0);
  }

  // Format ISO dates (YYYY-MM-DD) to pretty format
  if (columnLower.includes('date') && value && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return toPrettyDate(value);
  }

  // For other numeric values, show with 2 decimal places
  if (typeof value === 'number' || (!isNaN(value) && value !== null && value !== '')) {
    return formatNumber(value);
  }

  return escapeHtml(String(value || ''));
}

// Populate dropdown filters from data
function populateDropdownFilters() {
  if (!state.rows || !state.rows.length) return;

  const base = state.rows; // Use all data for filter options

  // Get unique values for each filter type
  const clients = [...new Set(base.map(row => row.__client).filter(val => val && val !== 'undefined'))].sort();

  // Debug staff values
  const allStaffValues = base.map(row => row.__staff);
  const uniqueStaffValues = [...new Set(allStaffValues)];
  console.log('[populateDropdownFilters] All unique __staff values (before filter):', uniqueStaffValues);
  const staff = uniqueStaffValues.filter(val => val && val !== 'undefined').sort();
  console.log('[populateDropdownFilters] Staff after filtering:', staff);

  const categories = [...new Set(base.map(row => row.__category).filter(val => val && val !== 'undefined'))].sort();
  const items = [...new Set(base.map(row => row.__item || row[state.mapping.item]).filter(Boolean))].sort();
  const orders = [...new Set(base.map(row => row.__order).filter(Boolean))].sort();

  console.log('Populating dropdowns with data:', { clients: clients.length, staff: staff.length, categories: categories.length, items: items.length, orders: orders.length });

  // Helper function to populate a dropdown
  function populateDropdown(selector, options, defaultText) {
    const dropdown = document.querySelector(selector) || document.getElementById(selector.replace('#', ''));
    if (dropdown) {
      dropdown.innerHTML = `<option value="">${defaultText}</option>` +
        options.map(option => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('');
      console.log(`Populated ${selector} with ${options.length} options`);
    }
    // Silently skip dropdowns that don't exist (not all pages have all filter types)
  }

  // Populate dropdowns by name attribute (legacy)
  populateDropdown('select[name="client"]', clients, 'All Clients');
  populateDropdown('select[name="staff"]', staff, 'All Staff');
  populateDropdown('select[name="category"]', categories, 'All Categories');
  populateDropdown('select[name="item"]', items.slice(0, 100), 'All Items');
  populateDropdown('select[name="order"]', orders.slice(0, 100), 'All Orders');

  // Populate page-specific dropdowns by ID
  // Orders page filters
  populateDropdown('#ordersFilterClient', clients, 'All Clients');
  populateDropdown('#ordersFilterStaff', staff, 'All Staff');
  populateDropdown('#ordersFilterItem', items.slice(0, 100), 'All Items');
  populateDropdown('#ordersFilterOrder', orders.slice(0, 100), 'All Orders');
  populateDropdown('#ordersFilterCategory', categories, 'All Categories');

  // Clients page filters
  populateDropdown('#clientsFilterStaff', staff, 'All Staff');
  populateDropdown('#clientsFilterItem', items.slice(0, 100), 'All Items');
  populateDropdown('#clientsFilterOrder', orders.slice(0, 100), 'All Orders');
  populateDropdown('#clientsFilterCategory', categories, 'All Categories');

  // Staff page filters
  populateDropdown('#staffFilterClient', clients, 'All Clients');
  populateDropdown('#staffFilterItem', items.slice(0, 100), 'All Items');
  populateDropdown('#staffFilterOrder', orders.slice(0, 100), 'All Orders');
  populateDropdown('#staffFilterCategory', categories, 'All Categories');

  // Items page filters
  populateDropdown('#itemsFilterClient', clients, 'All Clients');
  populateDropdown('#itemsFilterStaff', staff, 'All Staff');
  populateDropdown('#itemsFilterOrder', orders.slice(0, 100), 'All Orders');
  populateDropdown('#itemsFilterCategory', categories, 'All Categories');

  // Trends / Analytics filters (staff-only)
  populateDropdown('#trendsFilterStaff', staff, 'All Staff');
  populateDropdown('#analyticsFilterStaff', staff, 'All Staff');
}

// ================================
// Live Filtering Functions
// ================================

function setupOrdersLiveFilters() {
  const filterInputs = [
    qs('ordersFilterStart'),
    qs('ordersFilterEnd'),
    qs('ordersFilterItem'),
    qs('ordersFilterClient'),
    qs('ordersFilterStaff'),
    qs('ordersFilterOrder'),
    qs('ordersFilterCategory')
  ];

  // Add live filtering event listeners
  filterInputs.forEach(input => {
    if (input && !input.hasAttribute('data-live-filter')) {
      input.setAttribute('data-live-filter', 'true');
      input.addEventListener('input', applyOrdersFilters);
      input.addEventListener('change', applyOrdersFilters);
    }
  });

  // Clear filters button
  const clearBtn = qs('ordersClearFilters');
  if (clearBtn && !clearBtn.hasAttribute('data-clear-handler')) {
    clearBtn.setAttribute('data-clear-handler', 'true');
    clearBtn.addEventListener('click', () => {
      filterInputs.forEach(input => {
        if (input) {
          if (input.type === 'checkbox') {
            input.checked = false;
          } else {
            input.value = '';
          }
        }
      });
      applyOrdersFilters();
    });
  }
}

function applyOrdersFilters() {
  // Get filter values
  const startDate = qs('ordersFilterStart')?.value || '';
  const endDate = qs('ordersFilterEnd')?.value || '';
  const item = qs('ordersFilterItem')?.value || '';
  const client = qs('ordersFilterClient')?.value || '';
  const staff = qs('ordersFilterStaff')?.value || '';
  const order = qs('ordersFilterOrder')?.value || '';
  const category = qs('ordersFilterCategory')?.value || '';

  // Apply filters to working rows
  let filteredRows = getWorkingRows();

  // Date filtering
  if (startDate || endDate) {
    filteredRows = filteredRows.filter(row => {
      const iso = row.__dateIso || '';
      if (!iso) return false;
      if (startDate && iso < startDate) return false;
      if (endDate && iso > endDate) return false;
      return true;
    });
  }

  // Text-based filtering
  if (item) {
    filteredRows = filteredRows.filter(row => {
      const itemValue = (row.__item || row[state.mapping.item] || '').toString().toLowerCase();
      return itemValue.includes(item.toLowerCase());
    });
  }

  if (client) {
    filteredRows = filteredRows.filter(row => {
      const clientValue = (row.__client || '').toString().toLowerCase();
      return clientValue.includes(client.toLowerCase());
    });
  }

  if (staff) {
    filteredRows = filteredRows.filter(row => {
      const staffValue = (row.__staff || '').toString().toLowerCase();
      return staffValue.includes(staff.toLowerCase());
    });
  }

  if (order) {
    filteredRows = filteredRows.filter(row => {
      const orderValue = (row.__order || '').toString().toLowerCase();
      return orderValue.includes(order.toLowerCase());
    });
  }

  if (category) {
    filteredRows = filteredRows.filter(row => {
      const categoryValue = (row.__category || '').toString().toLowerCase();
      return categoryValue.includes(category.toLowerCase());
    });
  }

  // Create filtered orders WITHOUT overwriting global state.byOrder
  // This keeps each page's filters independent
  const filteredOrders = aggregateByOrder(filteredRows, state.mapping);

  // Re-render the view with filtered data
  renderOrdersTableOnly(filteredOrders);
}

function renderOrdersTableOnly(ordersToDisplay = null) {
  const summaryEl = qs('ordersSummary');
  const tableEl = qs('ordersTrackingTable');
  const searchInput = qs('ordersSearch');

  if (!summaryEl || !tableEl) return;

  // Use provided filtered orders, or fall back to global state.byOrder
  const baseOrders = ordersToDisplay || state.byOrder;

  if (!baseOrders || !baseOrders.length) {
    summaryEl.textContent = 'No orders match the current filters.';
    tableEl.innerHTML = '<div class="text-sm text-gray-500">No orders available.</div>';
    return;
  }

  // Use ALL rows for date lookup since orders may contain data
  // from outside the current date filter range
  const workingRows = state.rows;
  const rowsByOrder = new Map();
  workingRows.forEach(row => {
    const key = row.__order || String(row[state.mapping.order] || '').trim() || '-';
    if (!rowsByOrder.has(key)) rowsByOrder.set(key, []);
    rowsByOrder.get(key).push(row);
  });

  const getLatestDate = (orderId) => {
    const rows = rowsByOrder.get(orderId) || [];
    return rows.reduce((latest, row) => {
      const iso = row.__dateIso || '';
      return iso && (!latest || iso > latest) ? iso : latest;
    }, '');
  };

  // Apply search filter
  const searchTerm = (searchInput?.value || '').toLowerCase().trim();
  let orders = [...baseOrders];
  if (searchTerm) {
    orders = orders.filter(order => {
      const clientRows = rowsByOrder.get(order.label) || [];
      return (order.label || '').toLowerCase().includes(searchTerm) ||
             clientRows.some(row => {
               const client = (row.__client || '').toLowerCase();
               const staff = (row.__staff || '').toLowerCase();
               const item = (row.__item || row[state.mapping.item] || '').toLowerCase();
               return client.includes(searchTerm) || staff.includes(searchTerm) || item.includes(searchTerm);
             });
    });
  }

  // Update summary
  const totalRevenue = orders.reduce((sum, o) => sum + Number(o.revenue || 0), 0);
  const totalOrders = orders.length;
  summaryEl.textContent = `${formatNumber(totalOrders)} orders · Revenue ${formatCurrencyShort(totalRevenue)}`;

  // Add date to orders and render table
  const ordersWithDates = orders.map(order => ({
    ...order,
    date: getLatestDate(order.label) || '-'
  }));

  // Store for export/print (with current filters applied)
  state.displayedOrders = ordersWithDates.map(order => ({
    order: order.label || 'Untitled',
    date: order.date,
    client: order.client || 'Unassigned',
    staff: order.staff || 'Unassigned',
    revenue: order.revenue,
    profit: order.profit,
    margin: order.revenue ? ((order.profit / order.revenue) * 100) : 0
  }));

  renderSortableClickableTable(tableEl, ['order','date','client','staff','items','revenue','profit','margin'], ordersWithDates.map(order => ({
    order: order.label || 'Untitled',
    date: order.date,
    client: order.client || '-',
    staff: order.staff || '-',
    items: order.items || 0,
    revenue: order.revenue,
    profit: order.profit,
    margin: order.margin
  })), {
    defaultSort: { column: 'date', direction: 'desc' },
    clickHandlers: {
      order: 'showOrderDetails'
    }
  });
}

function setupClientsLiveFilters() {
  const filterInputs = [
    qs('clientsFilterStart'),
    qs('clientsFilterEnd'),
    qs('clientsFilterItem'),
    qs('clientsFilterStaff'),
    qs('clientsFilterOrder'),
    qs('clientsFilterCategory')
  ];

  // Add live filtering event listeners
  filterInputs.forEach(input => {
    if (input && !input.hasAttribute('data-live-filter')) {
      input.setAttribute('data-live-filter', 'true');
      input.addEventListener('input', applyClientsFilters);
      input.addEventListener('change', applyClientsFilters);
    }
  });

  // Search input already has live filtering via renderClientTrackingView call
  const searchInput = qs('clientsSearch');
  if (searchInput && !searchInput.hasAttribute('data-live-filter')) {
    searchInput.setAttribute('data-live-filter', 'true');
  }

  // Clear filters button
  const clearBtn = qs('clientsClearFilters');
  if (clearBtn && !clearBtn.hasAttribute('data-clear-handler')) {
    clearBtn.setAttribute('data-clear-handler', 'true');
    clearBtn.addEventListener('click', () => {
      filterInputs.forEach(input => {
        if (input) {
          if (input.type === 'checkbox') {
            input.checked = false;
          } else {
            input.value = '';
          }
        }
      });
      if (searchInput) searchInput.value = '';
      applyClientsFilters();
    });
  }
}

function setupStaffLiveFilters() {
  const filterInputs = [
    qs('staffFilterStart'),
    qs('staffFilterEnd'),
    qs('staffFilterItem'),
    qs('staffFilterClient'),
    qs('staffFilterOrder'),
    qs('staffFilterCategory')
  ];

  // Add live filtering event listeners
  filterInputs.forEach(input => {
    if (input && !input.hasAttribute('data-live-filter')) {
      input.setAttribute('data-live-filter', 'true');
      input.addEventListener('input', applyStaffFilters);
      input.addEventListener('change', applyStaffFilters);
    }
  });

  // Clear filters button
  const clearBtn = qs('staffClearFilters');
  if (clearBtn && !clearBtn.hasAttribute('data-clear-handler')) {
    clearBtn.setAttribute('data-clear-handler', 'true');
    clearBtn.addEventListener('click', () => {
      filterInputs.forEach(input => {
        if (input) {
          if (input.type === 'checkbox') {
            input.checked = false;
          } else {
            input.value = '';
          }
        }
      });
      applyStaffFilters();
    });
  }
}

function setupItemsLiveFilters() {
  const filterInputs = [
    qs('itemsFilterStart'),
    qs('itemsFilterEnd'),
    qs('itemsFilterCategory'),
    qs('itemsFilterClient'),
    qs('itemsFilterStaff'),
    qs('itemsFilterOrder')
  ];

  // Add live filtering event listeners
  filterInputs.forEach(input => {
    if (input && !input.hasAttribute('data-live-filter')) {
      input.setAttribute('data-live-filter', 'true');
      input.addEventListener('input', applyItemsFilters);
      input.addEventListener('change', applyItemsFilters);
    }
  });

  // Search input already has live filtering via renderItemTrackingView call
  const searchInput = qs('itemsSearch');
  if (searchInput && !searchInput.hasAttribute('data-live-filter')) {
    searchInput.setAttribute('data-live-filter', 'true');
  }

  // Clear filters button
  const clearBtn = qs('itemsClearFilters');
  if (clearBtn && !clearBtn.hasAttribute('data-clear-handler')) {
    clearBtn.setAttribute('data-clear-handler', 'true');
    clearBtn.addEventListener('click', () => {
      filterInputs.forEach(input => {
        if (input) {
          if (input.type === 'checkbox') {
            input.checked = false;
          } else {
            input.value = '';
          }
        }
      });
      if (searchInput) searchInput.value = '';
      applyItemsFilters();
    });
  }
}

// Filter application functions for each page
function applyClientsFilters() {
  // Get filter values
  const startDate = qs('clientsFilterStart')?.value || '';
  const endDate = qs('clientsFilterEnd')?.value || '';
  const item = qs('clientsFilterItem')?.value || '';
  const staff = qs('clientsFilterStaff')?.value || '';
  const order = qs('clientsFilterOrder')?.value || '';
  const category = qs('clientsFilterCategory')?.value || '';

  // Apply filters to base rows and regenerate client aggregation
  let filteredRows = state.rows || [];

  // Date filtering
  if (startDate || endDate) {
    filteredRows = filteredRows.filter(row => {
      const iso = row.__dateIso || '';
      if (!iso) return false;
      if (startDate && iso < startDate) return false;
      if (endDate && iso > endDate) return false;
      return true;
    });
  }

  // Text-based filtering
  if (item) {
    filteredRows = filteredRows.filter(row => {
      const itemValue = (row.__item || row[state.mapping.item] || '').toString().toLowerCase();
      return itemValue.includes(item.toLowerCase());
    });
  }

  if (staff) {
    filteredRows = filteredRows.filter(row => {
      const staffValue = (row.__staff || '').toString().toLowerCase();
      return staffValue.includes(staff.toLowerCase());
    });
  }

  if (order) {
    filteredRows = filteredRows.filter(row => {
      const orderValue = (row.__order || '').toString().toLowerCase();
      return orderValue.includes(order.toLowerCase());
    });
  }

  if (category) {
    filteredRows = filteredRows.filter(row => {
      const categoryValue = (row.__category || '').toString().toLowerCase();
      return categoryValue.includes(category.toLowerCase());
    });
  }

  // Update client aggregation with filtered data
  state.byClient = aggregateByField(filteredRows, r => r.__client && r.__client !== 'undefined' ? r.__client : '');

  // Re-render the clients view
  renderClientTrackingView();
}

function applyStaffFilters() {
  // Get filter values
  const startDate = qs('staffFilterStart')?.value || '';
  const endDate = qs('staffFilterEnd')?.value || '';
  const item = qs('staffFilterItem')?.value || '';
  const client = qs('staffFilterClient')?.value || '';
  const order = qs('staffFilterOrder')?.value || '';
  const category = qs('staffFilterCategory')?.value || '';

  // Apply filters to base rows and regenerate staff aggregation
  let filteredRows = state.rows || [];

  // Date filtering
  if (startDate || endDate) {
    filteredRows = filteredRows.filter(row => {
      const iso = row.__dateIso || '';
      if (!iso) return false;
      if (startDate && iso < startDate) return false;
      if (endDate && iso > endDate) return false;
      return true;
    });
  }

  // Text-based filtering
  if (item) {
    filteredRows = filteredRows.filter(row => {
      const itemValue = (row.__item || row[state.mapping.item] || '').toString().toLowerCase();
      return itemValue.includes(item.toLowerCase());
    });
  }

  if (client) {
    filteredRows = filteredRows.filter(row => {
      const clientValue = (row.__client || '').toString().toLowerCase();
      return clientValue.includes(client.toLowerCase());
    });
  }

  if (order) {
    filteredRows = filteredRows.filter(row => {
      const orderValue = (row.__order || '').toString().toLowerCase();
      return orderValue.includes(order.toLowerCase());
    });
  }

  if (category) {
    filteredRows = filteredRows.filter(row => {
      const categoryValue = (row.__category || '').toString().toLowerCase();
      return categoryValue.includes(category.toLowerCase());
    });
  }

  // Update staff aggregation with filtered data
  state.byStaff = aggregateByField(filteredRows, r => {
    const val = r.__staff;
    return (val !== null && val !== undefined && val !== 'undefined' && String(val).trim() !== '') ? val : '';
  });

  // Re-render the staff view
  renderStaffTrackingView();
}

function applyItemsFilters() {
  // Get filter values
  const startDate = qs('itemsFilterStart')?.value || '';
  const endDate = qs('itemsFilterEnd')?.value || '';
  const category = qs('itemsFilterCategory')?.value || '';
  const client = qs('itemsFilterClient')?.value || '';
  const staff = qs('itemsFilterStaff')?.value || '';
  const order = qs('itemsFilterOrder')?.value || '';

  // Apply filters to base rows and regenerate item report
  let filteredRows = state.rows || [];

  // Date filtering
  if (startDate || endDate) {
    filteredRows = filteredRows.filter(row => {
      const iso = row.__dateIso || '';
      if (!iso) return false;
      if (startDate && iso < startDate) return false;
      if (endDate && iso > endDate) return false;
      return true;
    });
  }

  // Text-based filtering
  if (category) {
    filteredRows = filteredRows.filter(row => {
      const categoryValue = (row.__category || '').toString().toLowerCase();
      return categoryValue.includes(category.toLowerCase());
    });
  }

  if (client) {
    filteredRows = filteredRows.filter(row => {
      const clientValue = (row.__client || '').toString().toLowerCase();
      return clientValue.includes(client.toLowerCase());
    });
  }

  if (staff) {
    filteredRows = filteredRows.filter(row => {
      const staffValue = (row.__staff || '').toString().toLowerCase();
      return staffValue.includes(staff.toLowerCase());
    });
  }

  if (order) {
    filteredRows = filteredRows.filter(row => {
      const orderValue = (row.__order || '').toString().toLowerCase();
      return orderValue.includes(order.toLowerCase());
    });
  }

  // Regenerate item report with filtered data
  const filteredReport = computeReport(filteredRows, state.mapping);
  state.byItem = filteredReport.byItem;

  // Re-render the items view
  renderItemTrackingView();
}

function setupTrendsFilters() {
  // Simplified: Only staff filter
  const staffInput = document.getElementById('trendsFilterStaff');
  const clearBtn = document.getElementById('trendsClearFilters');

  const handler = () => applyTrendsFilters();

  if (staffInput && !staffInput.hasAttribute('data-trends-filter')) {
    staffInput.setAttribute('data-trends-filter', 'true');
    staffInput.addEventListener('change', handler);
  }

  if (clearBtn && !clearBtn.hasAttribute('data-clear-handler')) {
    clearBtn.setAttribute('data-clear-handler', 'true');
    clearBtn.addEventListener('click', () => {
      if (staffInput) staffInput.value = '';
      applyTrendsFilters();
    });
  }
}

function setupAnalyticsFilters() {
  // Simplified: Only staff filter
  const staffInput = document.getElementById('analyticsFilterStaff');
  const clearBtn = document.getElementById('analyticsClearFilters');

  const handler = () => applyAnalyticsFilters();

  if (staffInput && !staffInput.hasAttribute('data-analytics-filter')) {
    staffInput.setAttribute('data-analytics-filter', 'true');
    staffInput.addEventListener('change', handler);
  }

  if (clearBtn && !clearBtn.hasAttribute('data-clear-handler')) {
    clearBtn.setAttribute('data-clear-handler', 'true');
    clearBtn.addEventListener('click', () => {
      if (staffInput) staffInput.value = '';
      applyAnalyticsFilters();
    });
  }
}

function applyTrendsFilters(opts = {}) {
  const collected = collectFilterValues('trends');
  const merged = { ...SIMPLE_DEFAULT_FILTERS, ...collected };
  state.trendsFilters = merged;
  const filteredRows = applyFilters(state.rows || [], state.mapping, merged);
  const hasFilters = !filtersMatchDefault(merged);
  state.trendsFilteredRows = hasFilters ? filteredRows : null;
  if (!opts.silent) {
    renderTrendsCharts();
  }
}

function applyAnalyticsFilters(opts = {}) {
  const collected = collectFilterValues('analytics');
  const merged = { ...SIMPLE_DEFAULT_FILTERS, ...collected };
  state.analyticsFilters = merged;
  const filteredRows = applyFilters(state.rows || [], state.mapping, merged);
  const hasFilters = !filtersMatchDefault(merged);
  state.analyticsFilteredRows = hasFilters ? filteredRows : null;
  if (!opts.silent) {
    renderAnalyticsCharts();
  }
}
