import { parseCsv, detectColumns, parseCsvFiles } from './csv.js';
import { computeReport, aggregateCustom, aggregateByGranularity, aggregateByCategoryOverTime, aggregateByField, aggregateByOrder } from './reports.js';
import { renderTotals, renderTable, makeChart, makeBarChart, makeChartTyped, makeStackedBarChart, downloadCsv, setActiveNav, exportExcelBook } from './ui.js';
import { saveReport, listReports, loadReport, deleteReport, observeAuth, signInWithGoogle, signOutUser, loadUserSettings, saveUserSettings, saveCsvData, loadCsvData, deleteCsvData, deleteAllUserData } from './storage.js';
import { SAMPLE_ROWS } from './sample-data.js';
import { ALLOWED_ITEMS } from './allowed-items.js';

const APP_VERSION = '1.2.32';
// Expose version for SW registration cache-busting
try { window.APP_VERSION = APP_VERSION; } catch {}
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
  filters: { start: '', end: '', item: '', client: '', staff: '', order: '', category: '', revMin: '', revMax: '', qtyMin: '', qtyMax: '', noZero: false },
  user: null,
  customChart: null,
  categoryMap: {},
  itemSynonyms: [],
};

function qs(id) { return document.getElementById(id); }
function showView(hash) {
  const route = (hash || location.hash || '#/upload').replace('#', '');
  document.querySelectorAll('.view').forEach(el => el.classList.add('hidden'));
  const [ , view = 'upload' ] = route.split('/');
  const el = document.getElementById(`view-${view}`) || document.getElementById('view-upload');
  el.classList.remove('hidden');
  setActiveNav(`#/` + view);
}

window.addEventListener('hashchange', () => showView(location.hash));
window.addEventListener('DOMContentLoaded', () => {
  // Router
  showView(location.hash);
  // Simple dark mode toggle
  try {
    const darkModeToggle = document.getElementById('darkModeToggle');
    if (darkModeToggle) {
      darkModeToggle.addEventListener('click', toggleDarkMode);
    }
  } catch {}
  // Update sidebar version
  const sidebarVersionEl = document.getElementById('sidebarVersion');
  if (sidebarVersionEl) sidebarVersionEl.textContent = `v${APP_VERSION}`;
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
    } else {
      if (window.__firebaseDisabled) {
        status.textContent = 'Sign-in disabled (no Firebase config).';
        try { btnIn.setAttribute('disabled','disabled'); btnIn.title = 'Configure Firebase to enable sign-in.'; } catch {}
      } else {
        status.textContent = 'Not signed in.';
      }
      btnIn.classList.remove('hidden');
      btnOut.classList.add('hidden');
    }
  });

  qs('btnSignIn').addEventListener('click', signInWithGoogle);
  qs('btnSignOut').addEventListener('click', signOutUser);

  // Load stored CSV data on app startup
  (async () => {
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
      } else {
        // No stored data, load sample data for demo
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
      console.warn('Failed to load stored CSV data:', e);
    }
  })();

  // Initialize dark mode
  initDarkMode();
  // Load category map, filters, and custom chart preferences
  (async ()=>{ try { const m = await loadUserSettings('categoryMap'); if (m) state.categoryMap = m; } catch {} })();
  (async ()=>{ try { const f = await loadUserSettings('filters'); if (f) { state.filters = { ...state.filters, ...f }; restoreFilterUI(); } } catch {} })();
  (async ()=>{ try { const c = await loadUserSettings('customChartPrefs'); if (c) restoreCustomChartPrefs(c); } catch {} })();

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
    qs('uploadStatus').textContent = files.length > 1 ? `Reading ${files.length} files…` : 'Reading sample to detect columns…';
    const { rows, headers } = await parseCsvFiles(files, { preview: 100 });
    state.rows = rows;
    state.headers = headers;
    const detected = detectColumns(headers);
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

  qs('btnParse').addEventListener('click', async () => {
    const files = fileInput.files;
    if (!files || !files.length) { alert('Choose at least one CSV.'); return; }
    // Read full files
    qs('uploadStatus').textContent = 'Parsing CSV…';
    const btn = qs('btnParse'); if (btn) btn.disabled = true;
    showProgress(true); setProgress(0, '0%');
    let lastText = '';
    const { rows, headers } = await parseCsvFiles(files, {
      onProgress: (p) => {
        const pct = Number.isFinite(p.percent) ? p.percent : 0;
        const txt = `Parsing ${p.fileIndex + 1}/${p.filesCount}: ${p.fileName} — ${pct}% (${(p.rowsParsed||0).toLocaleString()} rows)`;
        if (txt !== lastText) { setProgress(pct, txt); lastText = txt; }
      }
    });
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
      setProgress(Math.min(99, pct), `Normalizing ${Math.min(processed,total).toLocaleString()}/${total.toLocaleString()} rows — ${pct}%`);
    });
    state.rows = normalized;

    // Save CSV data to Firebase/localStorage for persistence
    await saveCsvData(normalized, headers, state.mapping);

    const filtered = applyFilters(normalized, state.mapping, state.filters);
    state.filtered = filtered;
    state.report = computeReport(filtered, state.mapping);
    renderReport();
    location.hash = '#/report';
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

  // Filters
  const st = qs('filterStart'); const en = qs('filterEnd'); const it = qs('filterItem');
  const fClient = qs('filterClient'); const fStaff = qs('filterStaff'); const fOrder = qs('filterOrder'); const fCat = qs('filterCategory');
  const fRevMin = qs('filterRevMin'); const fRevMax = qs('filterRevMax'); const fQtyMin = qs('filterQtyMin'); const fQtyMax = qs('filterQtyMax'); const fNoZero = qs('filterNoZero');
  qs('btnApplyFilters').addEventListener('click', async () => {
    state.filters = {
      start: st.value, end: en.value, item: it.value,
      client: fClient?.value || '', staff: fStaff?.value || '', order: fOrder?.value || '', category: fCat?.value || '',
      revMin: fRevMin?.value || '', revMax: fRevMax?.value || '', qtyMin: fQtyMin?.value || '', qtyMax: fQtyMax?.value || '',
      noZero: !!(fNoZero && fNoZero.checked)
    };
    // Save filters for persistence
    try { await saveUserSettings('filters', state.filters); } catch {}
    if (!state.rows.length || !state.mapping.date) return;
    const filtered = applyFilters(state.rows, state.mapping, state.filters);
    state.report = computeReport(filtered, state.mapping);
    renderReport();
  });
  qs('btnClearFilters').addEventListener('click', async () => {
    st.value = en.value = it.value = '';
    if (fClient) fClient.value = '';
    if (fStaff) fStaff.value = '';
    if (fOrder) fOrder.value = '';
    if (fCat) fCat.value = '';
    if (fRevMin) fRevMin.value = '';
    if (fRevMax) fRevMax.value = '';
    if (fQtyMin) fQtyMin.value = '';
    if (fQtyMax) fQtyMax.value = '';
    if (fNoZero) fNoZero.checked = false;
    state.filters = { start:'', end:'', item:'', client:'', staff:'', order:'', category:'', revMin:'', revMax:'', qtyMin:'', qtyMax:'', noZero:false };
    // Save cleared filters for persistence
    try { await saveUserSettings('filters', state.filters); } catch {}
    if (!state.rows.length || !state.mapping.date) return;
    state.filtered = state.rows;
    state.report = computeReport(state.rows, state.mapping);
    renderReport();
  });
  qs('btnExportExcel').addEventListener('click', () => exportExcel(state.report));
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

  // Close dropdowns when clicking outside
  document.addEventListener('click', () => {
    exportMenu?.classList.add('hidden');
    printMenu?.classList.add('hidden');
  });

  // Printing
  qs('btnPrintReport').addEventListener('click', () => window.print());
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
  qs('btnPrintChart').addEventListener('click', () => window.print());
  qs('btnBuildTable').addEventListener('click', () => buildCustomTable({ groupBy: elGroupBy.value, granularity: elGran.value, metric: elMetric.value, topN: elTopN.value }));
  qs('btnExportCustomCsv').addEventListener('click', () => exportCustomCsv());
  qs('btnPrintTable').addEventListener('click', () => window.print());

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

  // Branding load
  loadBranding();
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
  (async ()=>{
    try {
      let list = await loadUserSettings('allowedItemsList');
      if (!list || !Array.isArray(list) || list.length === 0) {
        // Prefill with default allowed list (hardcoded) if user has no saved list yet
        list = ALLOWED_ITEMS;
        document.getElementById('allowedItems').value = list.join('\n');
      } else {
        document.getElementById('allowedItems').value = list.join('\n');
      }
      window.__allowedItemsList = list;
      window.__allowedCanonSet = new Set(list.map(canonicalizeItemName));
      const enforce = await loadUserSettings('enforceAllowed');
      if (typeof enforce === 'boolean') { document.getElementById('enforceAllowed').checked = enforce; window.__enforceAllowed = enforce; }
      // Load synonyms
      const syn = await loadUserSettings('itemSynonyms');
      if (Array.isArray(syn)) {
        state.itemSynonyms = syn;
        const ta = document.getElementById('itemSynonyms'); if (ta) ta.value = syn.map(p => `${p.from} => ${p.to}`).join('\n');
      } else {
        // Default include Tri Color => Northern
        const ta = document.getElementById('itemSynonyms');
        if (ta && !ta.value.trim()) ta.value = 'Tri Color => Northern\nTri-Color => Northern';
      }
    } catch {}
  })();

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
  qs('btnLoadItemsMapping')?.addEventListener('click', () => buildCategoryMapEditor());
  qs('btnSaveCategoryMap')?.addEventListener('click', async () => {
    const editor = document.getElementById('categoryMapEditor'); if (!editor) return;
    const inputs = editor.querySelectorAll('input[data-item]'); const map = {};
    inputs.forEach(inp => { const item = inp.getAttribute('data-item'); const val = inp.value.trim(); if (item && val) map[item] = val; });
    state.categoryMap = map; await saveUserSettings('categoryMap', map);
    // Re-normalize rows to apply categories (with progress)
    if (state.rows.length) {
      showProgress(true); setProgress(0, 'Reapplying category map…');
      const normalized = await normalizeAndDedupeAsync(state.rows, state.mapping, (pct, processed) => {
        setProgress(Math.min(99, pct), `Reapplying map — ${pct}%`);
      });
      state.rows = normalized;
      const filtered = applyFilters(state.rows, state.mapping, state.filters); state.filtered = filtered;
      state.report = computeReport(filtered, state.mapping); renderReport();
      showProgress(false);
    }
    alert('Category mapping saved.');
  });
  qs('btnClearCategoryMap')?.addEventListener('click', async () => {
    state.categoryMap = {}; await saveUserSettings('categoryMap', {});
    document.getElementById('categoryMapEditor')?.replaceChildren();
  });
});

function renderReport() {
  if (!state.report) return;
  renderTotals(qs('totals'), state.report.totals);
  renderTable(qs('table-item'), ['item','quantity','revenue'], state.report.byItem);
  renderTable(qs('table-date'), ['date','quantity','revenue'], state.report.byDate);
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
  state.byClient = aggregateByField(base, r => r.__client || '');
  state.byStaff = aggregateByField(base, r => r.__staff || '');
  state.byCategory = aggregateByField(base, r => r.__category || '');
  state.byOrder = aggregateByOrder(base);

  const clientRows = state.byClient.map(x => ({ client: x.label, orders: x.orders, quantity: x.quantity, revenue: x.revenue, cost: x.cost, profit: x.profit, margin: x.margin }));
  const staffRows = state.byStaff.map(x => ({ staff: x.label, orders: x.orders, quantity: x.quantity, revenue: x.revenue, cost: x.cost, profit: x.profit, margin: x.margin }));
  renderTable(qs('table-client'), ['client','orders','quantity','revenue','cost','profit','margin'], clientRows);
  renderTable(qs('table-staff'), ['staff','orders','quantity','revenue','cost','profit','margin'], staffRows);
  const catSection = document.getElementById('section-category');
  if (state.byCategory && state.byCategory.length) {
    catSection?.classList.remove('hidden');
    const catRows = state.byCategory.map(x => ({ category: x.label, orders: x.orders, quantity: x.quantity, revenue: x.revenue, cost: x.cost, profit: x.profit, margin: x.margin }));
    renderTable(qs('table-category'), ['category','orders','quantity','revenue','cost','profit','margin'], catRows);
    // Category share chart
    if (state.chartCatShare) { state.chartCatShare.destroy(); state.chartCatShare = null; }
    const labelsCat = state.byCategory.map(x => x.label);
    const valsCat = state.byCategory.map(x => x.revenue);
    state.chartCatShare = makeChartTyped(document.getElementById('chart-category-share'), 'doughnut', labelsCat, valsCat, 'Category Share');
  } else {
    catSection?.classList.add('hidden');
  }
  renderTable(qs('table-order'), ['order','date','client','staff','quantity','revenue','cost','profit','margin'], state.byOrder);
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

// Expose for debugging
window.__appState = state;

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
  const fs = state.filters;
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

function printAllViews() {
  const views = Array.from(document.querySelectorAll('.view'));
  const prev = views.map(v => v.classList.contains('hidden'));
  views.forEach(v => v.classList.remove('hidden'));
  preparePrintCover();
  const done = () => {
    window.removeEventListener('afterprint', done);
    views.forEach((v,i) => { if (prev[i]) v.classList.add('hidden'); });
  };
  window.addEventListener('afterprint', done);
  window.print();
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
  // Load dark mode preference
  const isDark = localStorage.getItem('darkMode') === 'true';
  if (isDark) {
    document.documentElement.classList.add('dark');
  }
  updateDarkModeButton();
}

function toggleDarkMode() {
  const html = document.documentElement;
  const isDark = html.classList.contains('dark');

  if (isDark) {
    html.classList.remove('dark');
    localStorage.setItem('darkMode', 'false');
  } else {
    html.classList.add('dark');
    localStorage.setItem('darkMode', 'true');
  }

  updateDarkModeButton();
}

function updateDarkModeButton() {
  const isDark = document.documentElement.classList.contains('dark');
  const toggle = document.getElementById('darkModeToggle');
  if (toggle) {
    const icon = toggle.querySelector('span:first-child');
    const text = toggle.querySelector('span:last-child');
    if (icon) icon.textContent = isDark ? '☀️' : '🌙';
    if (text) text.textContent = isDark ? 'Light Mode' : 'Dark Mode';
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
}

function buildCategoryMapEditor(){
  const editor = document.getElementById('categoryMapEditor'); if (!editor) return;
  const base = state.filtered?.length ? state.filtered : state.rows;
  const items = Array.from(new Set(base.map(r => (r[state.mapping.item] || '').toString().trim()).filter(Boolean))).sort();
  editor.innerHTML = '';
  if (!items.length) { editor.innerHTML = '<div class="p-3 text-sm text-gray-600">No items found. Upload and parse CSVs first.</div>'; return; }
  items.forEach(it => {
    const row = document.createElement('div'); row.className = 'flex items-center justify-between p-2';
    const label = document.createElement('div'); label.className = 'text-sm text-gray-700'; label.textContent = it;
    const input = document.createElement('input'); input.type = 'text'; input.className = 'border rounded-md px-2 py-1 text-sm w-60'; input.setAttribute('data-item', it);
    input.value = state.categoryMap?.[it] || '';
    row.appendChild(label); row.appendChild(input); editor.appendChild(row);
  });
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

async function loadBranding() {
  const nameInput = document.getElementById('brandName');
  const logoInput = document.getElementById('brandLogo');
  try {
    const name = await loadUserSettings('brandName');
    const logo = await loadUserSettings('brandLogo');
    if (nameInput && name) nameInput.value = name;
    if (logoInput && logo) logoInput.value = logo;
  } catch {}
}

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
