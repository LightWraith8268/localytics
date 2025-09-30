import { parseCsv, detectColumns, parseCsvFiles } from './csv.js';
import { computeReport, aggregateCustom, aggregateByGranularity, aggregateByCategoryOverTime, aggregateByField, aggregateByOrder } from './reports.js';
import { renderTotals, renderTable, renderSortableTable, makeChart, makeBarChart, makeChartTyped, makeStackedBarChart, downloadCsv, setActiveNav, exportExcelBook } from './ui.js';
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
const state = {
  rows: [],
  headers: [],
  mapping: { date: '', item: '', qty: '', price: '', cost: '', revenue: '', category: '', order: '', client: '', staff: '' },
  report: null,
  chart: null,
  chartQty: null,
  chartTop: null,
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
  user: null,
  customChart: null,
  categoryMap: {},
  itemSynonyms: [],
};

let categoryMapDraft = {};
let previousBodyOverflow = '';



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
  }
}

window.addEventListener('hashchange', () => showView(location.hash));
window.addEventListener('DOMContentLoaded', () => {
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
    try { const f = await loadUserSettings('filters'); if (f) { state.filters = { ...DEFAULT_FILTERS, ...f }; restoreFilterUI(); } } catch (e) { console.warn('Failed to load filters settings:', e); }
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
        const synonymsTextarea = document.getElementById('itemSynonyms');
        if (synonymsTextarea && !synonymsTextarea.value.trim()) {
          synonymsTextarea.value = 'Tri Color => Northern\nTri-Color => Northern';
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

        // Show data info in upload status
        const uploadStatus = qs('uploadStatus');
        if (uploadStatus) {
          const uploadedDate = storedData.uploadedAt ? new Date(storedData.uploadedAt).toLocaleDateString() : 'unknown date';
          uploadStatus.textContent = `${storedData.rowCount} rows loaded from ${uploadedDate}`;
        }

        // Generate reports automatically
        const filtered = applyFilters(state.rows, state.mapping, state.filters);
        state.filtered = filtered;
        state.report = computeReport(filtered, state.mapping);
        renderReport();
        updateCategoryMapSummary();
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

  async function reapplyCategoryMap() {
    if (!state.rows.length) {
      const filtered = applyFilters(state.rows, state.mapping, state.filters);
      state.filtered = filtered;
      state.report = computeReport(filtered, state.mapping);
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
      const filtered = applyFilters(state.rows, state.mapping, state.filters);
      state.filtered = filtered;
      state.report = computeReport(filtered, state.mapping);
      renderReport();
      updateCategoryMapSummary();
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

    // Save CSV data to Firebase/localStorage for persistence
    await saveCsvData(normalized, headers, state.mapping);

    console.log('[app] Applying filters to', normalized.length, 'rows');
    let filtered = applyFilters(normalized, state.mapping, state.filters);
    console.log('[app] After filtering:', filtered.length, 'rows remain');
    if (normalized.length && !filtered.length) {
      console.warn('[app] Filters removed all rows; resetting filters to defaults.');
      state.filters = { ...DEFAULT_FILTERS };
      restoreFilterUI();
      try { await saveUserSettings('filters', state.filters); } catch (e) { console.warn('[app] Failed to reset filters in storage:', e); }
      filtered = applyFilters(normalized, state.mapping, state.filters);
      console.log('[app] After resetting filters,', filtered.length, 'rows remain');
    }
    state.filtered = filtered;
    console.log('[app] Computing report from', filtered.length, 'filtered rows');
    state.report = computeReport(filtered, state.mapping);
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

  // Custom view
  const elGroupBy = qs('customGroupBy');
  const elGranWrap = document.getElementById('granularityWrap');
  const elGran = qs('customGranularity');
  const elMetric = qs('customMetric');
  const elType = qs('customChartType');
  const elTopN = qs('customTopN');
  const elStack = document.getElementById('customStackCat');
  elGroupBy.addEventListener('change', async () => {
    elGranWrap.style.display = (elGroupBy.value === 'date') ? '' : 'none';
    await saveCustomChartPrefs();
  });
  elGran.addEventListener('change', saveCustomChartPrefs);
  elMetric.addEventListener('change', saveCustomChartPrefs);
  elType.addEventListener('change', saveCustomChartPrefs);
  elGranWrap.style.display = (elGroupBy.value === 'date') ? '' : 'none';
  qs('btnBuildChart').addEventListener('click', () => {
    buildCustomChart({ groupBy: elGroupBy.value, granularity: elGran.value, metric: elMetric.value, type: elType.value, topN: elTopN.value, stackCat: elStack?.checked });
  });
  qs('btnPrintChart').addEventListener('click', () => printCurrentView());
  qs('btnBuildTable').addEventListener('click', () => buildCustomTable({ groupBy: elGroupBy.value, granularity: elGran.value, metric: elMetric.value, topN: elTopN.value }));
  qs('btnExportCustomCsv').addEventListener('click', () => exportCustomCsv());
  qs('btnPrintTable').addEventListener('click', () => printCurrentView());

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
    if (!state.byOrder) return;
    const cols = ['order','date','client','staff','revenue','profit','margin'];
    const workingRows = getWorkingRows();
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
    const ordersData = state.byOrder.map(order => ({
      order: order.order,
      date: getLatestDate(order.order) ? toPrettyDate(getLatestDate(order.order)) : '-',
      client: order.client || 'Unassigned',
      staff: order.staff || 'Unassigned',
      revenue: order.revenue,
      profit: order.profit,
      margin: order.revenue ? ((order.profit / order.revenue) * 100) : 0
    }));
    downloadCsv('orders.csv', cols, ordersData);
  });
  qs('btnOrdersExportExcel')?.addEventListener('click', () => {
    if (!state.byOrder) return;
    const report = { byItem: [], byDate: [], totals: {} };
    const workingRows = getWorkingRows();
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
    const ordersData = state.byOrder.map(order => ({
      order: order.order,
      date: getLatestDate(order.order) ? toPrettyDate(getLatestDate(order.order)) : '-',
      client: order.client || 'Unassigned',
      staff: order.staff || 'Unassigned',
      revenue: order.revenue,
      profit: order.profit,
      margin: order.revenue ? ((order.profit / order.revenue) * 100) : 0
    }));
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
      state.filtered = [];
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
      state.filtered = [];
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
      state.filtered = [];
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
    await saveUserSettings('itemSynonyms', map);
    alert('Synonyms saved. They will apply to new ingested data.');
  });
  qs('btnClearSynonyms')?.addEventListener('click', async () => {
    state.itemSynonyms = [];
    const ta = document.getElementById('itemSynonyms'); if (ta) ta.value = '';
    await saveUserSettings('itemSynonyms', []);
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

  document.addEventListener('keydown', (evt) => {
    if (evt.key === 'Escape') {
      const modal = qs('categoryMapModal');
      if (modal && !modal.classList.contains('hidden')) {
        closeCategoryMapModal();
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
      state.categoryMap = map;
      await saveUserSettings('categoryMap', map);
      await reapplyCategoryMap();
      updateCategoryMapSummary();
      closeCategoryMapModal();
      alert('Category mapping saved.');
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
      const entries = Object.entries(state.categoryMap || {});
      if (!entries.length) {
        alert('No category mappings to export.');
        return;
      }
      const rows = entries.map(([item, category]) => ({ item, category }));
      downloadCsv('category_mapping.csv', ['item','category'], rows);
    });
  } else {
    console.warn('[app] btnExportCategoryMapCsv not found in DOM');
  }

  // Initialize modals for client and order details
  initializeModals();

  // Initialize dropdown filters when data is available
  if (state.rows && state.rows.length) {
    populateDropdownFilters();
  }
});


function renderDashboard() {
  // Dashboard shows ALL parsed data (unfiltered), not filtered data
  if (!state.rows || !state.rows.length) return;

  // Generate report from all rows for dashboard view
  const dashboardReport = computeReport(state.rows, state.mapping);

  // Temporarily store the current report and filtered data
  const originalReport = state.report;
  const originalFiltered = state.filtered;

  // Set dashboard data
  state.report = dashboardReport;
  state.filtered = state.rows; // Use all rows instead of filtered

  // Render with all data
  renderReport();

  // Restore original data (for other views that may use filtered data)
  state.report = originalReport;
  state.filtered = originalFiltered;
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

  // Additional aggregates (based on filtered rows)
  const base = state.filtered || state.rows;

  // Staff aggregation uses filtered data

  state.byClient = aggregateByField(base, r => r.__client && r.__client !== 'undefined' ? r.__client : '');
  state.byStaff = aggregateByField(base, r => r.__staff && r.__staff !== 'undefined' ? r.__staff : '');
  state.byCategory = aggregateByField(base, r => r.__category && r.__category !== 'undefined' ? r.__category : '');
  state.byOrder = aggregateByOrder(base);

  // Items data comes from the report
  state.byItem = state.report.byItem;

  // Populate dropdown filters with current data
  populateDropdownFilters();

  const clientRows = state.byClient.map(x => ({ client: x.label, orders: x.orders, quantity: x.quantity, revenue: x.revenue, cost: x.cost, profit: x.profit, margin: x.margin }));
  const staffRows = state.byStaff.map(x => ({ staff: x.label, orders: x.orders, quantity: x.quantity, revenue: x.revenue, cost: x.cost, profit: x.profit, margin: x.margin }));
  renderTable(qs('table-client-main'), ['client','orders','quantity','revenue','cost','profit','margin'], clientRows);
  renderTable(qs('table-staff-main'), ['staff','orders','quantity','revenue','cost','profit','margin'], staffRows);
  const catSection = document.getElementById('section-category');
  if (state.byCategory && state.byCategory.length) {
    catSection?.classList.remove('hidden');
    const catRows = state.byCategory.map(x => ({ category: x.label, orders: x.orders, quantity: x.quantity, revenue: x.revenue, cost: x.cost, profit: x.profit, margin: x.margin }));
    renderTable(qs('table-category-main'), ['category','orders','quantity','revenue','cost','profit','margin'], catRows);
    // Category share chart
    if (state.chartCatShare) { state.chartCatShare.destroy(); state.chartCatShare = null; }
    const labelsCat = state.byCategory.map(x => x.label);
    const valsCat = state.byCategory.map(x => x.revenue);
    state.chartCatShare = makeChartTyped(document.getElementById('chart-category-share'), 'doughnut', labelsCat, valsCat, 'Category Share');
  } else {
    catSection?.classList.add('hidden');
  }
  renderTable(qs('table-order-main'), ['order','date','client','staff','quantity','revenue','cost','profit','margin'], state.byOrder);
  if (state.chartTopClients) { state.chartTopClients.destroy(); state.chartTopClients = null; }
  const topClients = state.byClient.slice(0, 10);
  state.chartTopClients = makeBarChart(document.getElementById('chart-top-clients'), topClients.map(x=>x.label), topClients.map(x=>x.revenue), 'Top Clients by Revenue');

  // Additional summary charts
  try {
    const byClientTop = state.byClient.slice(0, 10);
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
  const ordersByDate = aggregateOrdersByDate(base);
  state.chartOrders = makeChart(document.getElementById('chart-orders'), ordersByDate.labels, ordersByDate.values, 'Orders');
  if (state.chartRevRolling) { state.chartRevRolling.destroy(); state.chartRevRolling = null; }
  const rolling = rollingAverage(state.report.byDate.map(x=>({label:x.date,value:x.revenue})), 7);
  state.chartRevRolling = makeChart(document.getElementById('chart-rev-rolling'), rolling.labels, rolling.values, '7d Avg Revenue');
  if (state.chartRevMoM) { state.chartRevMoM.destroy(); state.chartRevMoM = null; }
  const month = aggregateByGranularity(base, state.mapping, 'month');
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

  // Hour-of-day revenue (sum)
  const hourAgg = new Array(24).fill(0);
  for (const r of base) { const h = (r.__hour ?? -1); if (h>=0) hourAgg[h] += Number(r.__revenue||0); }
  const hourLabels = Array.from({length:24},(_,i)=> i.toString().padStart(2,'0'));
  if (state.chartHourRevenue) { state.chartHourRevenue.destroy(); state.chartHourRevenue = null; }
  const chartHour = document.getElementById('chart-hour-revenue'); if (chartHour) state.chartHourRevenue = makeBarChart(chartHour, hourLabels, hourAgg.map(v=>Number(v.toFixed(2))), 'Revenue');

  // YoY change (monthly)
  const yoy = monthYearOverYearChange(month);
  if (state.chartRevYoy) { state.chartRevYoy.destroy(); state.chartRevYoy = null; }
  const chartYoy = document.getElementById('chart-rev-yoy'); if (chartYoy) state.chartRevYoy = makeChart(chartYoy, yoy.labels, yoy.values, 'YoY Change %');

  // Category trend by month (stacked)
  const catTrendCanvas = document.getElementById('chart-cat-trend');
  if (catTrendCanvas && state.byCategory && state.byCategory.length) {
    if (state.chartCatTrend) { state.chartCatTrend.destroy(); state.chartCatTrend = null; }
    const catTrend = aggregateByCategoryOverTime(base, state.mapping, 'month', 'revenue', 8);
    state.chartCatTrend = makeStackedBarChart(catTrendCanvas, catTrend.labels, catTrend.datasets);
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

  // Restore search state and add persistence
  if (searchInput) {
    const savedSearch = loadSearchState('orders');
    if (savedSearch && !searchInput.value) {
      searchInput.value = savedSearch;
    }

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

  const workingRows = getWorkingRows();
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
        const itemName = String(row[state.mapping.item] || row.item || '').toLowerCase();
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

  const totals = orders.reduce((acc, order) => {
    acc.revenue += Number(order.revenue || 0);
    acc.profit += Number(order.profit || 0);
    return acc;
  }, { revenue: 0, profit: 0 });

  const totalOrdersCount = state.byOrder.length;
  const isFiltered = orders.length !== totalOrdersCount || searchTerm;
  const summaryText = isFiltered
    ? `${formatNumber(orders.length)} of ${formatNumber(totalOrdersCount)} orders${searchTerm ? ` matching "${searchTerm}"` : ''} · Revenue ${formatCurrencyShort(totals.revenue)} · Profit ${formatCurrencyShort(totals.profit)}`
    : `${formatNumber(orders.length)} orders · Revenue ${formatCurrencyShort(totals.revenue)} · Profit ${formatCurrencyShort(totals.profit)}`;
  summaryEl.textContent = summaryText;

  renderSortableClickableTable(tableEl, ['order','date','client','staff','revenue','profit','margin'], ordersWithDates.map(order => ({
    order: order.order,
    date: order.displayDate,
    client: order.client || 'Unassigned',
    staff: order.staff || 'Unassigned',
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

  // Restore search state from localStorage
  if (searchInput && !searchInput.hasAttribute('data-state-restored')) {
    searchInput.setAttribute('data-state-restored', 'true');
    const savedState = loadSearchState('clients');
    if (savedState && savedState.search) {
      searchInput.value = savedState.search;
    }
  }

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

  const topClients = clients.slice(0, 3);
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

  // Restore search state from localStorage
  if (searchInput && !searchInput.hasAttribute('data-state-restored')) {
    searchInput.setAttribute('data-state-restored', 'true');
    const savedState = loadSearchState('items');
    if (savedState && savedState.search) {
      searchInput.value = savedState.search;
    }
  }

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
      const it = (r[mapping.item] || '').toString().toLowerCase();
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
  // Hide all navigation and non-essential elements for printing
  const elementsToHide = document.querySelectorAll('.no-print, nav, header, .sidebar-scroll');
  const originalDisplay = Array.from(elementsToHide).map(el => el.style.display);

  // Hide elements
  elementsToHide.forEach(el => el.style.display = 'none');

  // Find the current active view (the one that's not hidden)
  const currentView = document.querySelector('.view:not(.hidden)');

  // If there's an active view, hide all other views temporarily
  const allViews = document.querySelectorAll('.view');
  const originalViewStates = Array.from(allViews).map(v => v.classList.contains('hidden'));

  if (currentView) {
    allViews.forEach(view => {
      if (view !== currentView) {
        view.style.display = 'none';
      }
    });
  }

  const done = () => {
    window.removeEventListener('afterprint', done);
    // Restore original display states
    elementsToHide.forEach((el, i) => el.style.display = originalDisplay[i]);
    allViews.forEach((view, i) => {
      view.style.display = '';
      if (originalViewStates[i]) view.classList.add('hidden');
    });
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
  state.rows = normalized; state.filtered = normalized;
  state.report = computeReport(normalized, state.mapping);
  renderReport(); location.hash = '#/report';
  updateCategoryMapSummary();
}


function appendCategoryMapRow(editor, item = '', category = '') {
  if (!editor) return;
  const row = document.createElement('div');
  row.className = 'flex flex-col md:flex-row md:items-center md:gap-3 p-3';
  row.setAttribute('data-category-row', 'true');

  const itemInput = document.createElement('input');
  itemInput.type = 'text';
  itemInput.placeholder = 'Item name';
  itemInput.className = 'border app-border rounded-md px-2 py-1 text-sm flex-1';
  itemInput.value = item;
  itemInput.setAttribute('data-role', 'item');

  const categoryInput = document.createElement('input');
  categoryInput.type = 'text';
  categoryInput.placeholder = 'Category';
  categoryInput.className = 'border app-border rounded-md px-2 py-1 text-sm flex-1 mt-2 md:mt-0';
  categoryInput.value = category;
  categoryInput.setAttribute('data-role', 'category');

  const actions = document.createElement('div');
  actions.className = 'flex items-center gap-2 mt-2 md:mt-0 md:ml-2';
  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.textContent = 'Remove';
  removeBtn.className = 'px-3 py-1 border border-red-200 text-red-600 rounded-md text-sm font-medium hover:bg-red-50';
  removeBtn.addEventListener('click', () => row.remove());
  actions.appendChild(removeBtn);

  row.appendChild(itemInput);
  row.appendChild(categoryInput);
  row.appendChild(actions);
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
  modal.classList.remove('hidden');
  previousBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
}

function closeCategoryMapModal() {
  const modal = qs('categoryMapModal');
  if (!modal || modal.classList.contains('hidden')) return;
  modal.classList.add('hidden');
  document.body.style.overflow = previousBodyOverflow;
  previousBodyOverflow = '';
  const fileInput = qs('categoryMapFile');
  if (fileInput) fileInput.value = '';
  const textarea = qs('categoryMapBulkInput');
  if (textarea) textarea.value = '';
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
  const elDate = document.getElementById('printDate'); if (elDate) elDate.textContent = new Date().toLocaleString();
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
  const orderCol = mapping.order;
  const dateCol = mapping.date;
  const itemCol = mapping.item;
  const qtyCol = mapping.qty;
  const priceCol = mapping.price;
  const costCol = mapping.cost;
  const clientCol = mapping.client;
  const staffCol = mapping.staff;
  const out = [];
  for (const r of rows) {
    const order = orderCol ? String(r[orderCol] ?? '').trim() : '';
    const name = itemCol ? String(r[itemCol] ?? '').trim() : '';
    const canonName = canonicalizeItemName(name);
    const q = num(r[qtyCol]);
    const p = num(r[priceCol]);
    const c = num(r[costCol]);
    const revenue = Number((q * p).toFixed(2));
    const cost = Number((q * c).toFixed(2));
    const originalDateVal = r[dateCol];
    const iso = toIsoDate(originalDateVal);
    const pretty = toPrettyDate(originalDateVal);
    const dFull = parseFullDate(originalDateVal);
    const obj = { ...r };
    if (dateCol) obj[dateCol] = pretty; // replace display date
    obj.__dateIso = iso || '';
    obj.__dow = (dFull ? dFull.getDay() : null);
    obj.__hour = (dFull ? dFull.getHours() : null);
    obj.__quantity = q || 0;
    obj.__price = p || 0;
    obj.__unitCost = c || 0;
    obj.__revenue = revenue || 0;
    obj.__cost = cost || 0;
    obj.__profit = Number(((revenue || 0) - (cost || 0)).toFixed(2));
    obj.__order = order || 'undefined';
    obj.__client = clientCol ? (r[clientCol] || 'undefined') : 'undefined';
    obj.__staff = staffCol ? (r[staffCol] || 'undefined') : 'undefined';
    // Category: manual mapping overrides CSV
    const manualCat = state.categoryMap && name ? (state.categoryMap[name] || state.categoryMap[canonName] || '') : '';
    const csvCat = mapping.category ? (r[mapping.category] || '') : '';
    obj.__category = (manualCat || csvCat || '').toString().trim() || 'Uncategorized';
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
    const order = orderCol ? String(r[orderCol] ?? '').trim() : '';
    const name = itemCol ? String(r[itemCol] ?? '').trim() : '';
    const canonName = canonicalizeItemName(name);
    const q = num(r[qtyCol]);
    const p = num(r[priceCol]);
    const c = num(r[costCol]);
    const revenue = Number((q * p).toFixed(2));
    const cost = Number((q * c).toFixed(2));
    const originalDateVal = r[dateCol];
    const iso = toIsoDate(originalDateVal);
    const pretty = toPrettyDate(originalDateVal);
    const dFull = parseFullDate(originalDateVal);
    const obj = { ...r };
    if (dateCol) obj[dateCol] = pretty;
    obj.__dateIso = iso || '';
    obj.__dow = (dFull ? dFull.getDay() : null);
    obj.__hour = (dFull ? dFull.getHours() : null);
    obj.__quantity = q || 0;
    obj.__price = p || 0;
    obj.__unitCost = c || 0;
    obj.__revenue = revenue || 0;
    obj.__cost = cost || 0;
    obj.__profit = Number(((revenue || 0) - (cost || 0)).toFixed(2));
    obj.__order = order || 'undefined';
    obj.__client = clientCol ? (r[clientCol] || 'undefined') : 'undefined';
    obj.__staff = staffCol ? (r[staffCol] || 'undefined') : 'undefined';
    const manualCat = state.categoryMap && name ? (state.categoryMap[name] || state.categoryMap[canonName] || '') : '';
    const csvCat = mapping.category ? (r[mapping.category] || '') : '';
    obj.__category = (manualCat || csvCat || '').toString().trim() || 'Uncategorized';
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
  } else {
    console.warn('[app] WARNING: No rows in normalized output!');
  }
  return out;
}

// Canonicalize item names to match allowed list despite input variants
function canonicalizeItemName(raw) {
  if (!raw) return '';
  let s = String(raw);
  // Apply synonyms first (user-defined)
  try {
    if (Array.isArray(state.itemSynonyms)) {
      state.itemSynonyms.forEach(({from, to}) => {
        if (!from) return;
        const re = new RegExp(`\\b${escapeRegExp(from)}\\b`, 'gi');
        s = s.replace(re, to);
      });
    }
  } catch {}
  // Normalize quotes and dashes
  s = s.replace(/[\u2018\u2019\u2032]/g, "'").replace(/[\u201C\u201D\u2033]/g, '"').replace(/[\u2013\u2014]/g, '-');
  // Normalize fractions and decimal inch patterns for .75 and 1.5
  // Replace ¾ with .75, ½ with .5, ¼ with .25
  s = s.replace(/¾/g, '.75').replace(/½/g, '.5').replace(/¼/g, '.25');
  // Convert common fraction text patterns
  s = s.replace(/\b3\s*\/\s*4\b/g, '.75').replace(/\b1\s*[\-\s]?1\s*\/\s*2\b/g, '1.5');
  // Normalize decimals with leading zero
  s = s.replace(/\b0\.75\b/g, '.75');
  // Ensure inch symbol is a straight quote right after number if inches are implied
  s = s.replace(/(\.75|1\.5)\s*(?:in(ch)?|”|"|\b)/gi, (m, num) => `${num}" `);
  // Collapse multiple spaces
  s = s.replace(/\s+/g, ' ').trim();
  // Fix known wording variants
  s = s.replace(/\btri[-\s]?color\b/gi, 'Tri Color')
       .replace(/\bcolorado\s+rose\b/gi, 'Colorado Rose')
       .replace(/\bsqueegee\b/gi, 'Squeege')
       .replace(/^planters mix\b.*$/i, 'Planters Mix');
  // Handle rebrand: display as Northern (Tri Color -> Northern)
  s = s.replace(/\bTri[\-\s]?Color\s+River\s+Rock\b/gi, 'Northern River Rock')
       .replace(/\bTri[\-\s]?Color\s+Cobble\b/gi, 'Northern Cobble')
       .replace(/\bTri[\-\s]?Color\b/gi, 'Northern');
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
function toPrettyDate(v){ if(!v) return ''; const m=String(v).match(/^([A-Za-z]{3}\s+\d{1,2}\s+\d{4})/); if(m) return m[1]; try { return new Date(v).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'2-digit'}); } catch { return String(v); } }
function parseFullDate(v){ try { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; } catch { return null; } }

// Chart rendering functions for new pages
function renderTrendsCharts() {
  if (!state.report) return;

  // Core Time Series - reuse existing chart rendering logic
  if (state.chartRevenue) state.chartRevenue.destroy();
  if (state.chartQty) state.chartQty.destroy();
  if (state.chartOrders) state.chartOrders.destroy();

  const labels = state.report.byDate.map(r => r.date);
  const revenueData = state.report.byDate.map(r => r.revenue);
  const qtyData = state.report.byDate.map(r => r.quantity);
  const ordersData = state.report.byDate.map(r => r.orders || 0);

  state.chartRevenue = makeChart(document.getElementById('trends-chart-revenue'), labels, revenueData, 'Revenue by Date');
  state.chartQty = makeChart(document.getElementById('trends-chart-qty'), labels, qtyData, 'Quantity by Date');
  state.chartOrders = makeChart(document.getElementById('trends-chart-orders'), labels, ordersData, 'Orders by Date');

  // Trend Analysis charts - these would use more complex calculations
  renderTrendAnalysisCharts(labels, revenueData, qtyData);
  renderTimePatternCharts();
}

function renderAnalyticsCharts() {
  console.log('renderAnalyticsCharts called', { hasReport: !!state.report, reportKeys: state.report ? Object.keys(state.report) : [] });

  if (!state.report) {
    console.warn('No state.report available for analytics');
    return;
  }

  // Ensure aggregated data is available by regenerating it if needed
  if (!state.byClient || !state.byStaff || !state.byCategory) {
    console.log('Regenerating aggregated data for analytics');
    const base = state.filtered || state.rows;
    state.byClient = aggregateByField(base, r => r.__client && r.__client !== 'undefined' ? r.__client : '');
    state.byStaff = aggregateByField(base, r => r.__staff && r.__staff !== 'undefined' ? r.__staff : '');
    state.byCategory = aggregateByField(base, r => r.__category && r.__category !== 'undefined' ? r.__category : '');
    state.byOrder = aggregateByOrder(base);
    console.log('Analytics data generated:', {
      clientCount: state.byClient?.length || 0,
      staffCount: state.byStaff?.length || 0,
      categoryCount: state.byCategory?.length || 0
    });
  }

  // Top Rankings
  const topItems = state.report.byItem.slice(0, 10);
  const topClients = state.byClient ? state.byClient.slice(0, 10) : [];

  console.log('Rendering analytics charts:', { topItemsCount: topItems.length, topClientsCount: topClients.length });

  if (state.chartTopItems) state.chartTopItems.destroy();
  if (state.chartTopClients) state.chartTopClients.destroy();

  const topItemsCanvas = document.getElementById('analytics-chart-top-items');
  const topClientsCanvas = document.getElementById('analytics-chart-top-clients');

  console.log('Canvas elements:', { topItemsCanvas: !!topItemsCanvas, topClientsCanvas: !!topClientsCanvas });

  if (topItemsCanvas && topItems.length > 0) {
    state.chartTopItems = makeBarChart(topItemsCanvas,
      topItems.map(x => x.item), topItems.map(x => x.revenue), 'Top Items by Revenue');
  }

  if (topClientsCanvas && topClients.length > 0) {
    state.chartTopClients = makeBarChart(topClientsCanvas,
      topClients.map(x => x.label), topClients.map(x => x.revenue), 'Top Clients by Revenue');
  }

  // Profitability Analysis
  renderProfitabilityCharts();
  renderSegmentAnalysisCharts();
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

function renderTimePatternCharts() {
  // Day of week and hour analysis would require processing the raw data
  // For now, create placeholder charts
  const dowLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dowData = [100, 120, 110, 130, 140, 90, 80]; // Placeholder data

  if (state.chartDowRevenue) state.chartDowRevenue.destroy();
  state.chartDowRevenue = makeBarChart(document.getElementById('trends-chart-dow-revenue'), dowLabels, dowData, 'Avg Revenue by Day of Week');
}

function renderProfitabilityCharts() {
  if (!state.report) return;

  const labels = state.report.byDate.map(r => r.date);
  const profitData = state.report.byDate.map(r => r.profit || (r.revenue - (r.cost || 0)));
  const marginData = state.report.byDate.map(r => r.margin || 0);

  if (state.chartProfit) state.chartProfit.destroy();
  if (state.chartMargin) state.chartMargin.destroy();

  state.chartProfit = makeChart(document.getElementById('analytics-chart-profit'), labels, profitData, 'Profit by Date');
  state.chartMargin = makeChart(document.getElementById('analytics-chart-margin'), labels, marginData, 'Margin % by Date');

  // AOV and IPO would require order-level calculations
  const aovData = labels.map(() => Math.random() * 100 + 50); // Placeholder
  const ipoData = labels.map(() => Math.random() * 5 + 1); // Placeholder

  if (state.chartAov) state.chartAov.destroy();
  if (state.chartIpo) state.chartIpo.destroy();

  state.chartAov = makeChart(document.getElementById('analytics-chart-aov'), labels, aovData, 'Average Order Value');
  state.chartIpo = makeChart(document.getElementById('analytics-chart-ipo'), labels, ipoData, 'Items per Order');
}

function renderSegmentAnalysisCharts() {
  if (!state.byCategory || !state.byCategory.length) {
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

  const catLabels = state.byCategory.map(x => x.label);
  const catData = state.byCategory.map(x => x.revenue);

  if (state.chartCatShare) state.chartCatShare.destroy();
  state.chartCatShare = makeChartTyped(document.getElementById('analytics-chart-category-share'), 'doughnut', catLabels, catData, 'Category Share');
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

  const modal = document.getElementById('clientDetailsModal');
  const content = document.getElementById('clientDetailsContent');
  const title = document.getElementById('clientDetailsModalTitle');

  if (!modal || !content || !title) {
    console.error('Modal elements not found:', { modal: !!modal, content: !!content, title: !!title });
    return;
  }

  // Get all transactions for this client
  const base = state.filtered || state.rows;
  console.log('Base data length:', base?.length);

  // Try multiple matching strategies
  const clientTransactions = base.filter(row => {
    const rowClient = row.__client || row[state.mapping?.client] || '';
    return rowClient.toLowerCase() === clientName.toLowerCase();
  });

  console.log('Found transactions:', clientTransactions.length);

  if (!clientTransactions.length) {
    content.innerHTML = '<div class="text-sm text-gray-500">No transactions found for this client.</div>';
    title.textContent = `Client Details: ${clientName}`;
    modal.classList.remove('hidden');
    return;
  }

  // Aggregate products by item name with quantities
  const productMap = new Map();
  let totalRevenue = 0;
  let totalQuantity = 0;
  let totalCost = 0;
  let totalOrders = new Set();

  clientTransactions.forEach(row => {
    const itemName = row[state.mapping.item] || 'Unknown Item';
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

  const tableHtml = `
    <div class="overflow-x-auto border app-border rounded-md">
      <table class="w-full text-sm">
        <thead class="app-card">
          <tr>
            <th class="text-left px-3 py-2 font-medium">Product</th>
            <th class="text-left px-3 py-2 font-medium">Quantity</th>
            <th class="text-left px-3 py-2 font-medium">Revenue</th>
            <th class="text-left px-3 py-2 font-medium">Cost</th>
            <th class="text-left px-3 py-2 font-medium">Profit</th>
            <th class="text-left px-3 py-2 font-medium">Margin</th>
            <th class="text-left px-3 py-2 font-medium">Orders</th>
          </tr>
        </thead>
        <tbody>
          ${products.map(product => `
            <tr class="border-t hover:bg-gray-50">
              <td class="px-3 py-2">${escapeHtml(product.item)}</td>
              <td class="px-3 py-2">${formatNumber(product.quantity)}</td>
              <td class="px-3 py-2">${formatCurrency(product.revenue)}</td>
              <td class="px-3 py-2">${formatCurrency(product.cost)}</td>
              <td class="px-3 py-2">${formatCurrency(product.profit)}</td>
              <td class="px-3 py-2">${formatPercent(product.margin)}</td>
              <td class="px-3 py-2">${product.orders.toFixed(0)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  content.innerHTML = summaryHtml + tableHtml;
  title.textContent = `Client Details: ${clientName}`;
  modal.classList.remove('hidden');
}

function showOrderDetails(orderNumber) {
  const modal = document.getElementById('orderDetailsModal');
  const content = document.getElementById('orderDetailsContent');
  const title = document.getElementById('orderDetailsModalTitle');

  if (!modal || !content || !title) return;

  // Get all transactions for this order
  const base = state.filtered || state.rows;
  const orderTransactions = base.filter(row => (row.__order || '').toLowerCase() === orderNumber.toLowerCase());

  if (!orderTransactions.length) {
    content.innerHTML = '<div class="text-sm text-gray-500">No transactions found for this order.</div>';
    title.textContent = `Order Details: ${orderNumber}`;
    modal.classList.remove('hidden');
    return;
  }

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
      item: row[state.mapping.item] || 'Unknown Item',
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

  const tableHtml = `
    <div class="overflow-x-auto border app-border rounded-md">
      <table class="w-full text-sm">
        <thead class="app-card">
          <tr>
            <th class="text-left px-3 py-2 font-medium">Item</th>
            <th class="text-left px-3 py-2 font-medium">Quantity</th>
            <th class="text-left px-3 py-2 font-medium">Unit Price</th>
            <th class="text-left px-3 py-2 font-medium">Revenue</th>
            <th class="text-left px-3 py-2 font-medium">Cost</th>
            <th class="text-left px-3 py-2 font-medium">Profit</th>
            <th class="text-left px-3 py-2 font-medium">Margin</th>
          </tr>
        </thead>
        <tbody>
          ${items.map(item => `
            <tr class="border-t hover:bg-gray-50">
              <td class="px-3 py-2">${escapeHtml(item.item)}</td>
              <td class="px-3 py-2">${formatNumber(item.quantity)}</td>
              <td class="px-3 py-2">${formatCurrency(item.price)}</td>
              <td class="px-3 py-2">${formatCurrency(item.revenue)}</td>
              <td class="px-3 py-2">${formatCurrency(item.cost)}</td>
              <td class="px-3 py-2">${formatCurrency(item.profit)}</td>
              <td class="px-3 py-2">${formatPercent(item.margin)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;

  content.innerHTML = summaryHtml + tableHtml;
  title.textContent = `Order Details: ${orderNumber}`;
  modal.classList.remove('hidden');
}

// Modal event handlers and initialization
function initializeModals() {
  // Client details modal
  const clientModal = document.getElementById('clientDetailsModal');
  const clientCloseBtn = document.getElementById('clientDetailsModalClose');

  if (clientCloseBtn) {
    clientCloseBtn.addEventListener('click', () => {
      clientModal?.classList.add('hidden');
    });
  }

  if (clientModal) {
    clientModal.addEventListener('click', (e) => {
      if (e.target === clientModal) {
        clientModal.classList.add('hidden');
      }
    });
  }

  // Order details modal
  const orderModal = document.getElementById('orderDetailsModal');
  const orderCloseBtn = document.getElementById('orderDetailsModalClose');

  if (orderCloseBtn) {
    orderCloseBtn.addEventListener('click', () => {
      orderModal?.classList.add('hidden');
    });
  }

  if (orderModal) {
    orderModal.addEventListener('click', (e) => {
      if (e.target === orderModal) {
        orderModal.classList.add('hidden');
      }
    });
  }

  // Escape key handler
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      clientModal?.classList.add('hidden');
      orderModal?.classList.add('hidden');
    }
  });
}

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
        span.innerHTML = formattedValue;  // Use innerHTML for formatted display
        span.addEventListener('click', () => {
          console.log('Click detected on:', column, 'value:', value, 'function:', options.clickableColumns[column]);
          if (typeof window[options.clickableColumns[column]] === 'function') {
            window[options.clickableColumns[column]](value);  // Pass original value
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
  const staff = [...new Set(base.map(row => row.__staff).filter(val => val && val !== 'undefined'))].sort();
  const categories = [...new Set(base.map(row => row.__category).filter(val => val && val !== 'undefined'))].sort();
  const items = [...new Set(base.map(row => row[state.mapping.item]).filter(Boolean))].sort();
  const orders = [...new Set(base.map(row => row.__order).filter(Boolean))].sort();

  console.log('Populating dropdowns with data:', { clients: clients.length, staff: staff.length, categories: categories.length, items: items.length, orders: orders.length });

  // Helper function to populate a dropdown
  function populateDropdown(selector, options, defaultText) {
    const dropdown = document.querySelector(selector) || document.getElementById(selector.replace('#', ''));
    if (dropdown) {
      dropdown.innerHTML = `<option value="">${defaultText}</option>` +
        options.map(option => `<option value="${escapeHtml(option)}">${escapeHtml(option)}</option>`).join('');
      console.log(`Populated ${selector} with ${options.length} options`);
    } else {
      console.warn(`Dropdown not found: ${selector}`);
    }
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
      const itemValue = (row[state.mapping.item] || '').toString().toLowerCase();
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

  // Update orders aggregation with filtered data
  state.byOrder = aggregateByOrder(filteredRows);

  // Re-render the view with filtered data
  renderOrdersTableOnly();
}

function renderOrdersTableOnly() {
  const summaryEl = qs('ordersSummary');
  const tableEl = qs('ordersTrackingTable');
  const searchInput = qs('ordersSearch');

  if (!summaryEl || !tableEl) return;

  if (!state.byOrder || !state.byOrder.length) {
    summaryEl.textContent = 'No orders match the current filters.';
    tableEl.innerHTML = '<div class="text-sm text-gray-500">No orders available.</div>';
    return;
  }

  // Continue with existing orders rendering logic but with filtered data
  const workingRows = getWorkingRows();
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
  let orders = [...state.byOrder];
  if (searchTerm) {
    orders = orders.filter(order => {
      const clientRows = rowsByOrder.get(order.label) || [];
      return (order.label || '').toLowerCase().includes(searchTerm) ||
             clientRows.some(row => {
               const client = (row.__client || '').toLowerCase();
               const staff = (row.__staff || '').toLowerCase();
               const item = (row[state.mapping.item] || '').toLowerCase();
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

  renderSortableClickableTable(tableEl, ['order','date','client','staff','revenue','profit','margin'], ordersWithDates.map(order => ({
    order: order.label || 'Untitled',
    date: order.date,
    client: order.client || '-',
    staff: order.staff || '-',
    revenue: order.revenue,
    profit: order.profit,
    margin: order.margin
  })), {
    defaultSort: { column: 'revenue', direction: 'desc' },
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
      const itemValue = (row[state.mapping.item] || '').toString().toLowerCase();
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
      const itemValue = (row[state.mapping.item] || '').toString().toLowerCase();
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
  state.byStaff = aggregateByField(filteredRows, r => r.__staff && r.__staff !== 'undefined' ? r.__staff : '');

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
