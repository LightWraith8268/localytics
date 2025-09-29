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
    { label: 'Total Orders', value: String(totals.totalOrders || 0) },
    { label: 'Distinct Items', value: String(totals.distinctItems) },
  ];
  cards.forEach(c => {
    const d = document.createElement('div');
    d.className = 'p-4 border app-border rounded-md app-card';
    d.innerHTML = `<div class="text-xs text-gray-500">${c.label}</div><div class="mt-1 text-lg font-semibold">${c.value}</div>`;
    container.appendChild(d);
  });
}

export function renderTable(container, columns, rows) {
  if (!container) {
    console.warn('renderTable: container element is null');
    return;
  }
  container.innerHTML = '';
  const table = document.createElement('table');
  table.className = 'w-full text-sm';
  const thead = document.createElement('thead');
  thead.innerHTML = `<tr class="app-card">${columns.map(c=>`<th class="text-left px-3 py-2 font-medium">${escapeHtml(c)}</th>`).join('')}</tr>`;
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
  if (!canvas) { console.warn('[ui] makeChart: canvas element not found'); return null; }
  const ctx = canvas.getContext ? canvas.getContext('2d') : null;
  if (!ctx) { console.warn('[ui] makeChart: unable to acquire 2d context'); return null; }
  return new window.Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{ label, data, tension: 0.2, borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.15)', fill: true }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label ?? ''}: ${formatNumberTwo(ctx.parsed.y)}` } }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: (v) => formatNumberTwo(v) }
        }
      }
    }
  });
}

export function makeBarChart(canvas, labels, data, label='Series') {
  if (!window.Chart) return null;
  if (!canvas) { console.warn('[ui] makeBarChart: canvas element not found'); return null; }
  const ctx = canvas.getContext ? canvas.getContext('2d') : null;
  if (!ctx) { console.warn('[ui] makeBarChart: unable to acquire 2d context'); return null; }
  return new window.Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{ label, data, backgroundColor: '#60a5fa' }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label ?? ''}: ${formatNumberTwo(ctx.parsed.y)}` } }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: { callback: (v) => formatNumberTwo(v) }
        }
      }
    }
  });
}

export function makeChartTyped(canvas, type, labels, data, label='Series') {
  if (!window.Chart) return null;
  if (!canvas) { console.warn('[ui] makeChartTyped: canvas element not found'); return null; }
  const ctx = canvas.getContext ? canvas.getContext('2d') : null;
  if (!ctx) { console.warn('[ui] makeChartTyped: unable to acquire 2d context'); return null; }
  return new window.Chart(ctx, {
    type,
    data: {
      labels,
      datasets: [{ label, data, tension: 0.2, borderColor: '#2563eb', backgroundColor: 'rgba(37,99,235,0.35)', fill: ['line','radar'].includes(type) }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const val = (type === 'pie' || type === 'doughnut') ? ctx.parsed : ctx.parsed.y;
              return `${ctx.dataset.label ?? ''}: ${formatNumberTwo(val)}`;
            }
          }
        }
      },
      scales: (type === 'pie' || type === 'doughnut') ? undefined : {
        y: { beginAtZero: true, ticks: { callback: (v) => formatNumberTwo(v) } }
      }
    }
  });
}

export function makeStackedBarChart(canvas, labels, datasets) {
  if (!window.Chart) return null;
  if (!canvas) { console.warn('[ui] makeStackedBarChart: canvas element not found'); return null; }
  const ctx = canvas.getContext ? canvas.getContext('2d') : null;
  if (!ctx) { console.warn('[ui] makeStackedBarChart: unable to acquire 2d context'); return null; }
  return new window.Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label ?? ''}: ${formatNumberTwo(ctx.parsed.y)}` } }
      },
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true, ticks: { callback: (v) => formatNumberTwo(v) } }
      }
    }
  });
}

export function downloadCsv(filename, columns, rows) {
  const header = columns.join(',');
  const lines = rows.map(r => columns.map(c => csvEscape(formatCsvValue(r[c]))).join(','));
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
    { metric: 'Total Orders', value: report.totals.totalOrders || 0 },
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

// Enable click-to-zoom for charts: clicking a canvas shows a large image
export function enableChartZoom(root=document) {
  try {
    const modal = document.getElementById('chartZoom');
    const img = document.getElementById('chartZoomImg');
    if (!modal || !img) return;
    const handler = (e) => {
      const target = e.target;
      if (!(target instanceof HTMLCanvasElement)) return;
      if (!target.hasAttribute('data-zoom')) return;
      try {
        const url = target.toDataURL('image/png');
        img.src = url; modal.classList.remove('hidden');
      } catch {}
    };
    root.addEventListener('click', handler);
    modal.addEventListener('click', () => { modal.classList.add('hidden'); img.removeAttribute('src'); });
  } catch {}
}
function formatCurrency(n) {
  const num = Number(n ?? 0);
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: guessCurrency(), minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
}
function guessCurrency() { try { return (Intl.NumberFormat().resolvedOptions().currency) || 'USD'; } catch { return 'USD'; } }
function formatCell(col, val) {
  if (/revenue|price|total|cost|profit/i.test(col)) return formatCurrency(val);
  if (/margin/i.test(col)) return formatPercent(val);
  // For any other numeric values, show exactly two decimals
  if (isNumeric(val)) return escapeHtml(formatNumberTwo(val));
  return escapeHtml(String(val ?? ''));
}
function formatPercent(n) { const v = Number(n||0); return `${v.toFixed(2)}%`; }
function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])); }
function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
  return s;
}
function isNumeric(v){ return v !== null && v !== '' && !Array.isArray(v) && !isNaN(v); }
function formatNumberTwo(v){ const num = Number(v||0); return (Number.isFinite(num)? num : 0).toFixed(2); }
function formatCsvValue(v){ if (isNumeric(v)) return formatNumberTwo(v); const s=String(v??''); return s; }

