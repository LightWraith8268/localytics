import { parseCsv, detectColumns, parseCsvFiles } from './csv.js';
import { computeReport, aggregateCustom, aggregateByGranularity, aggregateByCategoryOverTime } from './reports.js';
import { renderTotals, renderTable, makeChart, makeBarChart, makeChartTyped, makeStackedBarChart, downloadCsv, setActiveNav, exportExcelBook } from './ui.js';
import { saveReport, listReports, loadReport, deleteReport, observeAuth, signInWithGoogle, signOutUser, loadUserSettings, saveUserSettings } from './storage.js';

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
  filters: { start: '', end: '', item: '' },
  user: null,
  customChart: null,
  categoryMap: {},
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
      status.textContent = 'Not signed in.';
      btnIn.classList.remove('hidden');
      btnOut.classList.add('hidden');
    }
  });

  qs('btnSignIn').addEventListener('click', signInWithGoogle);
  qs('btnSignOut').addEventListener('click', signOutUser);
  // Load category map
  (async ()=>{ try { const m = await loadUserSettings('categoryMap'); if (m) state.categoryMap = m; } catch {} })();

  // File handling
  const fileInput = qs('fileInput');
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

  qs('btnParse').addEventListener('click', async () => {
    const files = fileInput.files;
    if (!files || !files.length) { alert('Choose at least one CSV.'); return; }
    // Read full files
    qs('uploadStatus').textContent = 'Parsing CSV…';
    const { rows, headers } = await parseCsvFiles(files);
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
    const normalized = normalizeAndDedupe(rows, state.mapping);
    state.rows = normalized;
  const filtered = applyFilters(normalized, state.mapping, state.filters);
    state.filtered = filtered;
    state.report = computeReport(filtered, state.mapping);
    renderReport();
    location.hash = '#/report';
    qs('uploadStatus').textContent = `Parsed ${rows.length} rows.`;
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
  qs('btnApplyFilters').addEventListener('click', () => {
    state.filters = {
      start: st.value, end: en.value, item: it.value,
      client: fClient?.value || '', staff: fStaff?.value || '', order: fOrder?.value || '', category: fCat?.value || '',
      revMin: fRevMin?.value || '', revMax: fRevMax?.value || '', qtyMin: fQtyMin?.value || '', qtyMax: fQtyMax?.value || '',
      noZero: !!(fNoZero && fNoZero.checked)
    };
    if (!state.rows.length || !state.mapping.date) return;
    const filtered = applyFilters(state.rows, state.mapping, state.filters);
    state.report = computeReport(filtered, state.mapping);
    renderReport();
  });
  qs('btnClearFilters').addEventListener('click', () => {
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
      const rows = state.rows; const mapping = state.mapping;
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
    } catch {}
    exportExcelBook('report.xlsx', report, extras);
  }

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
  elGroupBy.addEventListener('change', () => {
    elGranWrap.style.display = (elGroupBy.value === 'date') ? '' : 'none';
  });
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
    if (!state.byClient) return; const cols = ['client','quantity','revenue','cost','profit','margin'];
    downloadCsv('report_by_client.csv', cols, state.byClient.map(x => ({ client:x.label, quantity:x.quantity, revenue:x.revenue, cost:x.cost, profit:x.profit, margin:x.margin })));
  });
  qs('btnExportStaff')?.addEventListener('click', () => {
    if (!state.byStaff) return; const cols = ['staff','quantity','revenue','cost','profit','margin'];
    downloadCsv('report_by_staff.csv', cols, state.byStaff.map(x => ({ staff:x.label, quantity:x.quantity, revenue:x.revenue, cost:x.cost, profit:x.profit, margin:x.margin })));
  });
  qs('btnExportOrder')?.addEventListener('click', () => {
    if (!state.byOrder) return; const cols = ['order','date','client','staff','quantity','revenue','cost','profit','margin'];
    downloadCsv('report_by_order.csv', cols, state.byOrder);
  });
  qs('btnExportCategory')?.addEventListener('click', () => {
    if (!state.byCategory) return; const cols = ['category','quantity','revenue','cost','profit','margin'];
    downloadCsv('report_by_category.csv', cols, state.byCategory.map(x => ({ category:x.label, quantity:x.quantity, revenue:x.revenue, cost:x.cost, profit:x.profit, margin:x.margin })));
  });

  // Branding load
  loadBranding();
  qs('btnSaveBrand').addEventListener('click', saveBranding);
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

  // Additional aggregates
  state.byClient = aggregateByField(state.rows, r => r.__client || '');
  state.byStaff = aggregateByField(state.rows, r => r.__staff || '');
  if (state.mapping.category) state.byCategory = aggregateByField(state.rows, r => r[state.mapping.category] || ''); else state.byCategory = null;
  state.byOrder = aggregateByOrder(state.rows);

  renderTable(qs('table-client'), ['label','quantity','revenue','cost','profit','margin'], state.byClient);
  renderTable(qs('table-staff'), ['label','quantity','revenue','cost','profit','margin'], state.byStaff);
  const catSection = document.getElementById('section-category');
  if (state.byCategory && state.byCategory.length) {
    catSection?.classList.remove('hidden');
    renderTable(qs('table-category'), ['label','quantity','revenue','cost','profit','margin'], state.byCategory);
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
    if (filters.category && mapping.category) {
      const v = (r[mapping.category] || '').toString().toLowerCase(); if (!v.includes(filters.category.toLowerCase())) ok = false;
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

async function loadLastMapping() {
  try {
    const local = localStorage.getItem('qr_mapping');
    return local ? JSON.parse(local) : null;
  } catch {}
  try {
    const m = await import('./storage.js');
    return await m.loadUserSettings('mapping');
  } catch {}
  return null;
}

async function saveLastMapping(mapping) {
  try { localStorage.setItem('qr_mapping', JSON.stringify(mapping)); } catch {}
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
  const brand = document.getElementById('brandName')?.value || 'Reports';
  const logo = document.getElementById('brandLogo')?.value || '';
  const elBrand = document.getElementById('printBrand'); if (elBrand) elBrand.textContent = brand;
  const elLogo = document.getElementById('printLogo'); if (elLogo) { if (logo) { elLogo.src = logo; elLogo.style.display = 'block'; } else { elLogo.style.display = 'none'; } }
  // Filters summary
  const fs = state.filters; const fm = state.mapping;
  const fParts = [];
  if (fs.start) fParts.push(`Start: ${fs.start}`); if (fs.end) fParts.push(`End: ${fs.end}`); if (fs.item) fParts.push(`Item contains: ${fs.item}`);
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
  const map = new Map();
  for (const r of rows) {
    const order = orderCol ? String(r[orderCol] ?? '').trim() : '';
    const name = itemCol ? String(r[itemCol] ?? '').trim() : '';
    const key = order ? `${order}|${name}` : JSON.stringify(r);
    if (!key) continue;
    const q = num(r[qtyCol]);
    const p = num(r[priceCol]);
    const c = num(r[costCol]);
    const revenue = Number((q * p).toFixed(2));
    const cost = Number((q * c).toFixed(2));
    const iso = toIsoDate(r[dateCol]);
    const pretty = toPrettyDate(r[dateCol]);
    const obj = { ...r };
    obj[dateCol] = pretty; // replace display date
    obj.__dateIso = iso;
    obj.__quantity = q;
    obj.__price = p;
    obj.__unitCost = c;
    obj.__revenue = revenue;
    obj.__cost = cost;
    obj.__profit = Number((revenue - cost).toFixed(2));
    obj.__order = key;
    obj.__client = clientCol ? r[clientCol] : '';
    obj.__staff = staffCol ? r[staffCol] : '';
    map.set(key, obj); // last occurrence wins
  }
  return Array.from(map.values());
}
function num(v){ if (v==null) return 0; if (typeof v==='number') return v; const s=String(v).replace(/[$,\s]/g,''); const n=Number(s); return Number.isFinite(n)?n:0; }
function toIsoDate(v){ if(!v) return ''; try{ const m=String(v).match(/^([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/); if(m){ const months={Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12}; const mm=String(months[m[1]]).padStart(2,'0'); const dd=String(m[2]).padStart(2,'0'); const yyyy=m[3]; return `${yyyy}-${mm}-${dd}`;} const d=new Date(v); if(!Number.isNaN(d.getTime())){ const yyyy=d.getFullYear(); const mm=String(d.getMonth()+1).padStart(2,'0'); const dd=String(d.getDate()).padStart(2,'0'); return `${yyyy}-${mm}-${dd}`; } }catch{} return ''; }
function toPrettyDate(v){ if(!v) return ''; const m=String(v).match(/^([A-Za-z]{3}\s+\d{1,2}\s+\d{4})/); if(m) return m[1]; try { return new Date(v).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'2-digit'}); } catch { return String(v); } }

