import { parseCsv, detectColumns } from './csv.js';
import { computeReport } from './reports.js';
import { renderTotals, renderTable, makeChart, downloadCsv, setActiveNav } from './ui.js';
import { saveReport, listReports, loadReport, deleteReport, observeAuth, signInWithGoogle, signOutUser } from './storage.js';

const state = {
  rows: [],
  headers: [],
  mapping: { date: '', item: '', qty: '', price: '', revenue: '' },
  report: null,
  chart: null,
  user: null,
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
    const file = fileInput.files?.[0];
    if (!file) return;
    qs('uploadStatus').textContent = 'Reading sample to detect columns…';
    const { rows, headers } = await parseCsv(file, { preview: 100 });
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
  });

  qs('btnParse').addEventListener('click', async () => {
    const file = fileInput.files?.[0];
    if (!file) { alert('Choose a CSV first.'); return; }
    // Read full file
    qs('uploadStatus').textContent = 'Parsing CSV…';
    const { rows, headers } = await parseCsv(file);
    state.rows = rows; state.headers = headers;
    state.mapping = {
      date: qs('col-date').value,
      item: qs('col-item').value,
      qty: qs('col-qty').value,
      price: qs('col-price').value,
      revenue: qs('col-revenue').value,
    };
    state.report = computeReport(rows, state.mapping);
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

