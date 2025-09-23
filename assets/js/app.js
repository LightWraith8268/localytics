import { parseCsv, detectColumns, parseCsvFiles } from './csv.js';
import { computeReport, aggregateCustom } from './reports.js';
import { renderTotals, renderTable, makeChart, makeBarChart, makeChartTyped, downloadCsv, setActiveNav, exportExcelBook } from './ui.js';
import { saveReport, listReports, loadReport, deleteReport, observeAuth, signInWithGoogle, signOutUser } from './storage.js';

const state = {
  rows: [],
  headers: [],
  mapping: { date: '', item: '', qty: '', price: '', revenue: '' },
  report: null,
  chart: null,
  chartQty: null,
  chartTop: null,
  filters: { start: '', end: '', item: '' },
  user: null,
  customChart: null,
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
    for (const id of ['col-date','col-item','col-qty','col-price','col-revenue']) {
      const sel = qs(id); sel.innerHTML = '';
      const blank = document.createElement('option'); blank.value=''; blank.textContent='—'; sel.appendChild(blank);
      for (const h of headers) {
        const opt = document.createElement('option'); opt.value=h; opt.textContent=h; sel.appendChild(opt);
      }
    }
    qs('col-date').value = detected.date || '';
    qs('col-item').value = detected.item || '';
    qs('col-qty').value = detected.qty || '';
    qs('col-price').value = detected.price || '';
    qs('col-revenue').value = detected.revenue || '';
    qs('uploadStatus').textContent = headers.length ? `Detected ${headers.length} columns.` : 'No headers found.';
    // Try loading saved mapping and apply
    const saved = await loadLastMapping();
    if (saved) {
      ['date','item','qty','price','revenue'].forEach(k => {
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
      revenue: qs('col-revenue').value,
    };
    await saveLastMapping(state.mapping);
    const filtered = applyFilters(rows, state.mapping, state.filters);
    state.report = computeReport(filtered, state.mapping);
    renderReport();
    location.hash = '#/report';
    qs('uploadStatus').textContent = `Parsed ${rows.length} rows.`;
  });

  qs('btnExportItem').addEventListener('click', () => {
    if (!state.report) return;
    const cols = ['item','quantity','revenue'];
    downloadCsv('report_by_item.csv', cols, state.report.byItem.map(x => ({ item:x.item, quantity:x.quantity, revenue:x.revenue })));
  });
  qs('btnExportDate').addEventListener('click', () => {
    if (!state.report) return;
    const cols = ['date','quantity','revenue'];
    downloadCsv('report_by_date.csv', cols, state.report.byDate.map(x => ({ date:x.date, quantity:x.quantity, revenue:x.revenue })));
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
  qs('btnApplyFilters').addEventListener('click', () => {
    state.filters = { start: st.value, end: en.value, item: it.value };
    if (!state.rows.length || !state.mapping.date) return;
    const filtered = applyFilters(state.rows, state.mapping, state.filters);
    state.report = computeReport(filtered, state.mapping);
    renderReport();
  });
  qs('btnClearFilters').addEventListener('click', () => {
    st.value = en.value = it.value = '';
    state.filters = { start:'', end:'', item:'' };
    if (!state.rows.length || !state.mapping.date) return;
    state.report = computeReport(state.rows, state.mapping);
    renderReport();
  });
  qs('btnExportExcel').addEventListener('click', () => exportExcel(state.report));
  function exportExcel(report){ if (!report) return; exportExcelBook('report.xlsx', report); }

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
  elGroupBy.addEventListener('change', () => {
    elGranWrap.style.display = (elGroupBy.value === 'date') ? '' : 'none';
  });
  elGranWrap.style.display = (elGroupBy.value === 'date') ? '' : 'none';
  qs('btnBuildChart').addEventListener('click', () => {
    buildCustomChart({ groupBy: elGroupBy.value, granularity: elGran.value, metric: elMetric.value, type: elType.value, topN: elTopN.value });
  });
  qs('btnPrintChart').addEventListener('click', () => window.print());
  qs('btnBuildTable').addEventListener('click', () => buildCustomTable({ groupBy: elGroupBy.value, granularity: elGran.value, metric: elMetric.value, topN: elTopN.value }));
  qs('btnExportCustomCsv').addEventListener('click', () => exportCustomCsv());
  qs('btnPrintTable').addEventListener('click', () => window.print());
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
  const start = filters.start ? new Date(filters.start) : null;
  const end = filters.end ? new Date(filters.end) : null;
  const itemQ = (filters.item || '').toLowerCase();
  return rows.filter(r => {
    let ok = true;
    if (start || end) {
      const d = new Date(r[mapping.date]);
      if (Number.isNaN(d.getTime())) return false;
      if (start && d < start) ok = false;
      if (end) {
        const endDay = new Date(end); endDay.setHours(23,59,59,999);
        if (d > endDay) ok = false;
      }
    }
    if (itemQ) {
      const it = (r[mapping.item] || '').toString().toLowerCase();
      if (!it.includes(itemQ)) ok = false;
    }
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
  const data = aggregateCustom(filtered, state.mapping, opts);
  const labels = data.map(x => x.label);
  const series = data.map(x => opts.metric === 'quantity' ? x.quantity : x.revenue);
  const canvas = document.getElementById('customChart');
  if (state.customChart) { state.customChart.destroy(); state.customChart = null; }
  state.customChart = makeChartTyped(canvas, opts.type || 'line', labels, series, `${opts.metric} by ${opts.groupBy}`);
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
