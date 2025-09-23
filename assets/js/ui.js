export function setActiveNav(hash) {
  document.querySelectorAll('a.nav-link').forEach(a => {
    if (a.getAttribute('href') === hash) a.classList.add('text-blue-600');
    else a.classList.remove('text-blue-600');
  });
}

export function renderTotals(container, totals) {
  container.innerHTML = '';
  const cards = [
    { label: 'Total Revenue', value: formatCurrency(totals.totalRevenue) },
    { label: 'Total Cost', value: formatCurrency(totals.totalCost || 0) },
    { label: 'Total Profit', value: formatCurrency(totals.totalProfit || 0) },
    { label: 'Margin', value: formatPercent(totals.marginPct) },
    { label: 'Total Quantity', value: String(totals.totalQuantity) },
    { label: 'Distinct Items', value: String(totals.distinctItems) },
  ];
  cards.forEach(c => {
    const d = document.createElement('div');
    d.className = 'p-4 border rounded-md bg-gray-50';
    d.innerHTML = `<div class="text-xs text-gray-500">${c.label}</div><div class="mt-1 text-lg font-semibold">${c.value}</div>`;
    container.appendChild(d);
  });
}

export function renderTable(container, columns, rows) {
  container.innerHTML = '';
  const table = document.createElement('table');
  table.className = 'w-full text-sm';
  const thead = document.createElement('thead');
  thead.innerHTML = `<tr class="bg-gray-50">${columns.map(c=>`<th class="text-left px-3 py-2 font-medium text-gray-600">${escapeHtml(c)}</th>`).join('')}</tr>`;
  const tbody = document.createElement('tbody');
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.className = 'border-t';
    tr.innerHTML = columns.map(c => `<td class="px-3 py-2">${formatCell(c, r[c])}</td>`).join('');
    tbody.appendChild(tr);
  });
  table.appendChild(thead); table.appendChild(tbody);
  container.appendChild(table);
}

export function makeChart(canvas, labels, data, label='Series') {
  if (!window.Chart) return null;
  const ctx = canvas.getContext('2d');
  return new window.Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{ label, data, tension: 0.2, borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.15)', fill: true }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

export function makeBarChart(canvas, labels, data, label='Series') {
  if (!window.Chart) return null;
  const ctx = canvas.getContext('2d');
  return new window.Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label, data, backgroundColor: '#60a5fa' }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

export function makeChartTyped(canvas, type, labels, data, label='Series') {
  if (!window.Chart) return null;
  const ctx = canvas.getContext('2d');
  return new window.Chart(ctx, {
    type,
    data: {
      labels,
      datasets: [{ label, data, tension: 0.2, borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.35)', fill: ['line','radar'].includes(type) }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true } },
      scales: (type === 'pie' || type === 'doughnut') ? undefined : { y: { beginAtZero: true } }
    }
  });
}

export function makeStackedBarChart(canvas, labels, datasets) {
  if (!window.Chart) return null;
  const ctx = canvas.getContext('2d');
  return new window.Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: true } },
      scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } }
    }
  });
}

export function downloadCsv(filename, columns, rows) {
  const header = columns.join(',');
  const lines = rows.map(r => columns.map(c => csvEscape(r[c])).join(','));
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(()=>URL.revokeObjectURL(url), 1000);
}

export function exportExcelBook(filename, report, extraSheets) {
  if (!window.XLSX || !report) return;
  const wb = window.XLSX.utils.book_new();
  const totalsRows = [
    { metric: 'Total Revenue', value: report.totals.totalRevenue },
    { metric: 'Total Quantity', value: report.totals.totalQuantity },
    { metric: 'Distinct Items', value: report.totals.distinctItems },
  ];
  const wsTotals = window.XLSX.utils.json_to_sheet(totalsRows);
  const wsItem = window.XLSX.utils.json_to_sheet(report.byItem);
  const wsDate = window.XLSX.utils.json_to_sheet(report.byDate);
  window.XLSX.utils.book_append_sheet(wb, wsTotals, 'Totals');
  window.XLSX.utils.book_append_sheet(wb, wsItem, 'By Item');
  window.XLSX.utils.book_append_sheet(wb, wsDate, 'By Date');
  if (extraSheets && typeof extraSheets === 'object') {
    for (const [name, rows] of Object.entries(extraSheets)) {
      try {
        const ws = window.XLSX.utils.json_to_sheet(rows || []);
        window.XLSX.utils.book_append_sheet(wb, ws, name.substring(0,31));
      } catch {}
    }
  }
  window.XLSX.writeFile(wb, filename);
}

function formatCurrency(n) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: guessCurrency(), maximumFractionDigits: 2 }).format(Number(n||0));
}
function guessCurrency() { try { return (Intl.NumberFormat().resolvedOptions().currency) || 'USD'; } catch { return 'USD'; } }
function formatCell(col, val) {
  if (/revenue|price|total|cost|profit/i.test(col)) return formatCurrency(val);
  if (/margin/i.test(col)) return formatPercent(val);
  return escapeHtml(String(val ?? ''));
}
function formatPercent(n) { const v = Number(n||0); return `${v.toFixed(2)}%`; }
function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])); }
function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
  return s;
}
