export function setActiveNav(hash) {
  console.log('[setActiveNav] Called with hash:', hash);
  const navLinks = document.querySelectorAll('a.nav-link');
  console.log('[setActiveNav] Found nav links:', navLinks.length);
  navLinks.forEach(a => {
    const href = a.getAttribute('href');
    console.log('[setActiveNav] Checking link:', href, 'against', hash);
    if (href === hash) {
      console.log('[setActiveNav] MATCH - adding active class');
      a.classList.add('active');
    } else {
      a.classList.remove('active');
    }
  });
}

export function renderTotals(container, totals) {
  container.innerHTML = '';
  const cards = [
    { label: 'Total Revenue', value: formatCurrency(totals.totalRevenue) },
    { label: 'Total Cost', value: formatCurrency(totals.totalCost || 0) },
    { label: 'Total Profit', value: formatCurrency(totals.totalProfit || 0) },
    { label: 'Margin', value: formatPercent(totals.marginPct) },
    { label: 'Total Quantity', value: formatNumberTwo(totals.totalQuantity) },
    { label: 'Total Orders', value: (totals.totalOrders || 0).toFixed(0) },
    { label: 'Distinct Items', value: (totals.distinctItems || 0).toFixed(0) },
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

export function renderSortableTable(container, columns, rows, options = {}) {
  if (!container) {
    console.warn('renderSortableTable: container element is null');
    return;
  }

  const containerId = container.id || 'table_' + Math.random().toString(36).substr(2, 9);
  if (!container.id) container.id = containerId;

  // State management for sorting
  const sortState = container._sortState || { column: null, direction: 'asc' };
  container._sortState = sortState;

  // Apply default sorting if specified
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
        sortState.direction = sortState.direction === 'asc' ? 'desc' : 'asc';
      } else {
        sortState.column = column;
        sortState.direction = 'asc';
      }
      renderSortableTable(container, columns, rows, options);
    });

    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);

  const tbody = document.createElement('tbody');
  sortedRows.forEach(row => {
    const tr = document.createElement('tr');
    tr.className = 'border-t hover:bg-gray-50';

    columns.forEach(column => {
      const td = document.createElement('td');
      td.className = 'px-3 py-2';
      td.innerHTML = formatCell(column, row[column]);
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  table.appendChild(thead);
  table.appendChild(tbody);
  container.appendChild(table);
}

function prepareCanvasForChart(canvas, fallbackHeight = 320) {
  if (!canvas) return null;
  try {
    canvas.style.width = '100%';
    if (!canvas.style.height) {
      canvas.style.height = '100%';
    }

    const parent = canvas.parentElement;
    if (parent && !parent.style.minHeight) {
      parent.style.minHeight = `${fallbackHeight}px`;
    }

    const rect = canvas.getBoundingClientRect();
    if (!rect || rect.width < 8) {
      const width = parent?.clientWidth || canvas.width || 640;
      canvas.width = Math.max(320, width);
    }
    if (!rect || rect.height < 8) {
      const height = parent?.clientHeight || canvas.height || fallbackHeight;
      canvas.height = Math.max(fallbackHeight, height);
    }
  } catch (err) {
    console.debug('[ui] prepareCanvasForChart failed', { err });
  }
  return canvas.getContext ? canvas.getContext('2d') : null;
}

function finalizeChartInstance(chart) {
  if (!chart) return chart;
  try {
    requestAnimationFrame(() => {
      try { chart.resize(); } catch (err) {
        console.debug('[ui] chart resize skipped', err);
      }
    });
  } catch (err) {
    console.debug('[ui] chart resize scheduling failed', err);
  }
  return chart;
}

export function makeChart(canvas, labels, data, label='Series', opts = {}) {
  if (!window.Chart) return null;
  if (!canvas) { console.info('[ui] makeChart: canvas element not found (skipping)'); return null; }
  const ctx = prepareCanvasForChart(canvas, opts?.fallbackHeight || 320);
  if (!ctx) { console.info('[ui] makeChart: unable to acquire 2d context (skipping)'); return null; }

  // Create gradient for better visual appeal
  const gradient = ctx.createLinearGradient(0, 0, 0, 400);
  gradient.addColorStop(0, 'rgba(59, 130, 246, 0.3)');
  gradient.addColorStop(1, 'rgba(59, 130, 246, 0.05)');

  const chart = new window.Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label,
        data,
        tension: 0.4,
        borderColor: '#3B82F6',
        backgroundColor: gradient,
        fill: true,
        borderWidth: 3,
        pointBackgroundColor: '#3B82F6',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        pointRadius: 5,
        pointHoverRadius: 7
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index'
      },
      plugins: {
        tooltip: {
          enabled: true,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          titleFont: { size: 14, weight: 'bold' },
          bodyFont: { size: 13 },
          padding: 12,
          displayColors: true,
          callbacks: {
            label: function(context) {
              let label = context.dataset.label || '';
              if (label) {
                label += ': ';
              }
              if (context.parsed.y !== null) {
                // Format large numbers with commas
                const value = context.parsed.y;
                const formatted = Math.abs(value) >= 1000
                  ? value.toLocaleString('en-US', { maximumFractionDigits: 2 })
                  : value.toFixed(2);
                label += formatted;
              }
              return label;
            }
          }
        },
        title: {
          display: true,
          text: label,
          font: { size: 16, weight: 'bold' },
          padding: { top: 10, bottom: 20 },
          color: '#1F2937'
        },
        legend: {
          display: true,
          labels: {
            usePointStyle: true,
            padding: 20,
            font: { size: 12, weight: '500' },
            color: '#f3f4f6' // Very light grey for better visibility
          }
        }
      },
      scales: {
        x: {
          grid: {
            display: true,
            color: 'rgba(0, 0, 0, 0.05)'
          },
          ticks: {
            color: '#6B7280',
            font: { size: 13, weight: '500' }
          }
        },
        y: {
          beginAtZero: true,
          grid: {
            display: true,
            color: 'rgba(0, 0, 0, 0.05)'
          },
          ticks: {
            callback: (v) => formatNumberTwo(v),
            color: '#6B7280',
            font: { size: 11 }
          }
        }
      }
    }
  });
  return finalizeChartInstance(chart);
}

export function makeBarChart(canvas, labels, data, label='Series', opts = {}) {
  if (!window.Chart) return null;
  if (!canvas) { console.info('[ui] makeBarChart: canvas element not found (skipping)'); return null; }
  const ctx = prepareCanvasForChart(canvas, opts?.fallbackHeight || 320);
  if (!ctx) { console.info('[ui] makeBarChart: unable to acquire 2d context (skipping)'); return null; }

  const isHorizontal = opts.indexAxis === 'y';

  // Create gradient for bars
  const gradient = isHorizontal
    ? ctx.createLinearGradient(0, 0, 400, 0)
    : ctx.createLinearGradient(0, 0, 0, 400);
  gradient.addColorStop(0, '#3B82F6');
  gradient.addColorStop(1, '#1E40AF');

  const chart = new window.Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label,
        data,
        backgroundColor: gradient,
        borderColor: '#1E40AF',
        borderWidth: 1,
        borderRadius: 6,
        borderSkipped: false,
      }]
    },
    options: {
      indexAxis: opts.indexAxis || 'x',
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index'
      },
      plugins: {
        title: {
          display: true,
          text: label,
          font: { size: 16, weight: 'bold' },
          padding: { top: 10, bottom: 20 },
          color: '#1F2937'
        },
        legend: {
          display: false, // Hide legend since title shows the metric
          labels: {
            usePointStyle: true,
            padding: 20,
            font: { size: 12, weight: '500' },
            color: '#f3f4f6' // Very light grey for better visibility
          }
        },
        tooltip: {
          enabled: true,
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          titleColor: '#ffffff',
          titleFont: { size: 14, weight: 'bold' },
          bodyColor: '#ffffff',
          bodyFont: { size: 13 },
          borderColor: '#3B82F6',
          borderWidth: 1,
          cornerRadius: 8,
          padding: 12,
          displayColors: true,
          callbacks: {
            title: (items) => {
              // Show full label text in tooltip (useful for truncated labels)
              return items[0]?.label || '';
            },
            label: (ctx) => {
              const val = isHorizontal ? ctx.parsed.x : ctx.parsed.y;
              const formatted = Math.abs(val) >= 1000
                ? val.toLocaleString('en-US', { maximumFractionDigits: 2 })
                : val.toFixed(2);
              return `${ctx.dataset.label ?? ''}: ${formatted}`;
            }
          }
        }
      },
      scales: {
        x: {
          beginAtZero: isHorizontal,
          grid: {
            display: isHorizontal,
            color: 'rgba(0, 0, 0, 0.05)'
          },
          ticks: {
            callback: isHorizontal
              ? (v) => formatNumberTwo(v)
              : function(value) { return this.getLabelForValue(value); },
            color: '#6B7280',
            font: { size: 13, weight: '500' },
            maxRotation: isHorizontal ? 0 : 45,
            minRotation: isHorizontal ? 0 : 0,
            autoSkip: false, // Show all labels, don't skip
            autoSkipPadding: 10
          }
        },
        y: {
          beginAtZero: !isHorizontal,
          grid: {
            display: !isHorizontal,
            color: 'rgba(0, 0, 0, 0.05)'
          },
          ticks: {
            callback: !isHorizontal
              ? (v) => formatNumberTwo(v)
              : function(value) { return this.getLabelForValue(value); },
            color: '#6B7280',
            font: { size: 13, weight: '500' },
            autoSkip: false // Show all labels for horizontal bars
          }
        }
      }
    }
  });
  return finalizeChartInstance(chart);
}

export function makeChartTyped(canvas, type, labels, data, label='Series') {
  if (!window.Chart) return null;
  if (!canvas) { console.info('[ui] makeChartTyped: canvas element not found (skipping)'); return null; }
  const ctx = canvas.getContext ? canvas.getContext('2d') : null;
  if (!ctx) { console.info('[ui] makeChartTyped: unable to acquire 2d context (skipping)'); return null; }

  // Enhanced color palettes for different chart types
  let backgroundColor, borderColor;

  if (type === 'pie' || type === 'doughnut') {
    // Beautiful color palette for pie/doughnut charts
    backgroundColor = [
      '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6',
      '#06B6D4', '#84CC16', '#F97316', '#EC4899', '#6366F1'
    ];
    borderColor = '#ffffff';
  } else {
    // Gradients for line/bar charts
    const gradient = ctx.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(59, 130, 246, 0.4)');
    gradient.addColorStop(1, 'rgba(59, 130, 246, 0.1)');
    backgroundColor = gradient;
    borderColor = '#3B82F6';
  }

  return new window.Chart(ctx, {
    type,
    data: {
      labels,
      datasets: [{
        label,
        data,
        tension: 0.4,
        borderColor,
        backgroundColor,
        fill: ['line','radar'].includes(type),
        borderWidth: type === 'doughnut' ? 3 : 2,
        pointBackgroundColor: '#3B82F6',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 2,
        pointRadius: type === 'line' ? 5 : 0,
        pointHoverRadius: type === 'line' ? 7 : 0
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: 'index'
      },
      plugins: {
        legend: {
          display: true,
          position: (type === 'pie' || type === 'doughnut') ? 'bottom' : 'top',
          labels: {
            usePointStyle: true,
            padding: 20,
            font: { size: 12, weight: '500' },
            color: '#f3f4f6' // Very light grey for better visibility
          }
        },
        tooltip: {
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          titleColor: '#ffffff',
          bodyColor: '#ffffff',
          borderColor: '#3B82F6',
          borderWidth: 1,
          cornerRadius: 8,
          displayColors: type !== 'doughnut',
          callbacks: {
            label: (ctx) => {
              const val = (type === 'pie' || type === 'doughnut') ? ctx.parsed : ctx.parsed.y;
              return `${ctx.dataset.label ?? ''}: ${formatNumberTwo(val)}`;
            }
          }
        }
      },
      scales: (type === 'pie' || type === 'doughnut') ? undefined : {
        x: {
          grid: {
            display: true,
            color: 'rgba(0, 0, 0, 0.05)'
          },
          ticks: {
            color: '#6B7280',
            font: { size: 13, weight: '500' }
          }
        },
        y: {
          beginAtZero: true,
          grid: {
            display: true,
            color: 'rgba(0, 0, 0, 0.05)'
          },
          ticks: {
            callback: (v) => formatNumberTwo(v),
            color: '#6B7280',
            font: { size: 11 }
          }
        }
      }
    }
  });
  return finalizeChartInstance(chart);
}

export function makeStackedBarChart(canvas, labels, datasets) {
  if (!window.Chart) return null;
  if (!canvas) { console.info('[ui] makeStackedBarChart: canvas element not found (skipping)'); return null; }
  const ctx = canvas.getContext ? canvas.getContext('2d') : null;
  if (!ctx) { console.info('[ui] makeStackedBarChart: unable to acquire 2d context (skipping)'); return null; }
  return new window.Chart(ctx, {
    type: 'bar',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          display: true,
          labels: {
            color: '#f3f4f6' // Very light grey for better visibility
          }
        },
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

// Chart zoom modal instance tracker
let zoomedChartInstance = null;

// Enable click-to-zoom for charts: clicking chart title shows enlarged chart
export function enableChartZoom(root=document) {
  try {
    const modal = document.getElementById('chartZoomModal');
    const modalTitle = document.getElementById('chartZoomTitle');
    const modalCanvas = document.getElementById('chartZoomCanvas');
    const closeBtn = document.getElementById('btnCloseChartZoom');

    console.log('[enableChartZoom] Modal elements:', { modal: !!modal, modalTitle: !!modalTitle, modalCanvas: !!modalCanvas, closeBtn: !!closeBtn });

    if (!modal || !modalCanvas || !closeBtn || !modalTitle) {
      console.warn('[enableChartZoom] Missing required modal elements');
      return;
    }

    // Make chart titles clickable with visual feedback
    const chartTitles = root.querySelectorAll('h3.text-sm.font-semibold');
    console.log('[enableChartZoom] Found h3 titles:', chartTitles.length);

    let zoomableCount = 0;
    chartTitles.forEach(title => {
      const nextElement = title.nextElementSibling;
      // Check if next element contains a canvas with data-zoom attribute
      const canvas = nextElement ? nextElement.querySelector('canvas[data-zoom]') : null;

      // Only process if canvas exists
      if (!canvas) {
        return;
      }

      // Skip if already enabled for this specific canvas
      if (title.hasAttribute('data-zoom-enabled') && title.getAttribute('data-zoom-canvas') === canvas.id) {
        return;
      }

      zoomableCount++;
      title.setAttribute('data-zoom-enabled', 'true');
      title.setAttribute('data-zoom-canvas', canvas.id);
      title.style.cursor = 'pointer';
      title.style.transition = 'color 0.2s';

      const hoverEnter = () => { title.style.color = '#3b82f6'; };
      const hoverLeave = () => { title.style.color = ''; };
      const clickHandler = () => {
        console.log('[enableChartZoom] Chart title clicked:', title.textContent);
        openChartZoomModal(title.textContent, canvas);
      };

      title.addEventListener('mouseenter', hoverEnter);
      title.addEventListener('mouseleave', hoverLeave);
      title.addEventListener('click', clickHandler);
    });

    console.log('[enableChartZoom] Made', zoomableCount, 'chart titles clickable');

    // Close button handler (only add once)
    if (!closeBtn.hasAttribute('data-zoom-handler')) {
      closeBtn.setAttribute('data-zoom-handler', 'true');
      closeBtn.addEventListener('click', closeChartZoomModal);
    }

    // Print button handler (only add once)
    const printBtn = document.getElementById('btnPrintChartZoom');
    if (printBtn && !printBtn.hasAttribute('data-zoom-handler')) {
      printBtn.setAttribute('data-zoom-handler', 'true');
      printBtn.addEventListener('click', () => {
        printChartFromModal();
      });
    }

    // Click outside to close (only add once)
    if (!modal.hasAttribute('data-zoom-handler')) {
      modal.setAttribute('data-zoom-handler', 'true');
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          closeChartZoomModal();
        }
      });
    }
  } catch (e) {
    console.warn('[enableChartZoom] Error:', e);
  }
}

function openChartZoomModal(title, sourceCanvas) {
  console.log('[openChartZoomModal] === FUNCTION START ===');
  console.log('[openChartZoomModal] Title:', title);
  console.log('[openChartZoomModal] Source canvas:', sourceCanvas);
  console.log('[openChartZoomModal] Canvas ID:', sourceCanvas?.id);

  const modal = document.getElementById('chartZoomModal');
  const modalTitle = document.getElementById('chartZoomTitle');
  const modalCanvas = document.getElementById('chartZoomCanvas');

  console.log('[openChartZoomModal] Modal elements check:', {
    modal: !!modal,
    modalTitle: !!modalTitle,
    modalCanvas: !!modalCanvas,
    sourceCanvas: !!sourceCanvas,
    modalDisplay: modal?.style?.display,
    modalClasses: modal?.classList?.toString()
  });

  if (!modal || !modalCanvas || !modalTitle || !sourceCanvas) {
    const msg = 'Missing required elements for zoom modal';
    console.error('[openChartZoomModal]', msg);
    alert(msg);
    return;
  }

  // Get the Chart.js instance from the source canvas
  const sourceChart = window.Chart?.getChart(sourceCanvas);
  console.log('[openChartZoomModal] Chart.js available:', !!window.Chart);
  console.log('[openChartZoomModal] Source chart instance:', sourceChart);
  console.log('[openChartZoomModal] Source chart type:', sourceChart?.config?.type);

  if (!sourceChart) {
    const msg = 'No Chart.js instance found on canvas: ' + (sourceCanvas.id || 'unknown');
    console.error('[openChartZoomModal]', msg);
    alert(msg);
    return;
  }

  // Destroy previous zoomed chart if exists
  if (zoomedChartInstance) {
    zoomedChartInstance.destroy();
    zoomedChartInstance = null;
  }

  // Set modal title
  modalTitle.textContent = title;

  try {
    // Clone the chart configuration safely
    const isPieOrDoughnut = sourceChart.config.type === 'pie' || sourceChart.config.type === 'doughnut';

    const config = {
      type: sourceChart.config.type,
      data: {
        labels: [...(sourceChart.config.data.labels || [])],
        datasets: sourceChart.config.data.datasets.map(ds => ({
          label: ds.label,
          data: [...(ds.data || [])],
          backgroundColor: ds.backgroundColor,
          borderColor: ds.borderColor,
          borderWidth: ds.borderWidth,
          fill: ds.fill
        }))
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: isPieOrDoughnut ? 1.5 : 2,
        plugins: {
          legend: sourceChart.config.options?.plugins?.legend || {},
          title: {
            display: true,
            text: title
          }
        },
        scales: sourceChart.config.options?.scales || {}
      }
    };

    console.log('[openChartZoomModal] Creating chart with config:', config);

    // Create enlarged chart
    const ctx = modalCanvas.getContext('2d');
    zoomedChartInstance = new window.Chart(ctx, config);

    // Show modal using the same pattern as snapshotViewerModal
    modal.style.display = 'block';
    modal.classList.remove('hidden');

    console.log('[openChartZoomModal] Modal opened successfully');
  } catch (error) {
    console.error('[openChartZoomModal] Error creating zoomed chart:', error);
    console.error('[openChartZoomModal] Stack trace:', error.stack);
    alert('Unable to zoom chart: ' + error.message);
  }
}

function closeChartZoomModal() {
  const modal = document.getElementById('chartZoomModal');
  if (modal) {
    modal.style.display = 'none';
    modal.classList.add('hidden');
  }

  // Destroy the zoomed chart
  if (zoomedChartInstance) {
    zoomedChartInstance.destroy();
    zoomedChartInstance = null;
  }
}

// Listen for global close event from ESC key handler
document.addEventListener('closeChartZoom', closeChartZoomModal);

function printChartFromModal() {
  console.log('[printChartFromModal] Starting chart print...');

  if (!zoomedChartInstance) {
    console.error('[printChartFromModal] No chart instance available');
    alert('No chart available to print');
    return;
  }

  console.log('[printChartFromModal] Chart instance found:', zoomedChartInstance);

  try {
    // Get chart title
    const titleElement = document.getElementById('chartZoomTitle');
    const chartTitle = titleElement ? titleElement.textContent : 'Chart';
    console.log('[printChartFromModal] Chart title:', chartTitle);

    // Export chart as base64 image
    console.log('[printChartFromModal] Exporting chart to image...');
    const chartImage = zoomedChartInstance.toBase64Image('image/png', 1);
    console.log('[printChartFromModal] Chart image length:', chartImage?.length);

    if (!chartImage || chartImage.length < 100) {
      throw new Error('Failed to generate chart image');
    }

    // Open new window with just the chart image
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      alert('Please allow popups to print charts');
      return;
    }

    console.log('[printChartFromModal] New window opened, writing content...');

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${chartTitle}</title>
        <style>
          @page {
            size: landscape;
            margin: 0.5in;
          }
          body {
            margin: 0;
            padding: 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
          }
          h1 {
            font-family: Arial, sans-serif;
            font-size: 18px;
            margin-bottom: 20px;
            text-align: center;
          }
          img {
            max-width: 100%;
            height: auto;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          }
          @media print {
            body {
              padding: 0;
            }
            h1 {
              margin-top: 10px;
            }
          }
        </style>
      </head>
      <body>
        <h1>${chartTitle}</h1>
        <img src="${chartImage}" alt="${chartTitle}" onload="console.log('Image loaded'); window.imageLoaded = true;" onerror="console.error('Image failed to load');" />
        <script>
          console.log('Print window loaded');
          console.log('Image data URI length:', '${chartImage}'.length);

          // Wait for image to load before printing
          window.addEventListener('load', function() {
            console.log('Window load event fired');
            setTimeout(function() {
              console.log('Triggering print dialog...');
              window.print();
            }, 500);
          });
        </script>
      </body>
      </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();

    console.log('[printChartFromModal] Content written to new window');

  } catch (error) {
    console.error('[printChartFromModal] Error:', error);
    console.error('[printChartFromModal] Stack:', error.stack);
    alert('Unable to print chart: ' + error.message);
  }
}
function formatCurrency(n) {
  const num = Number(n ?? 0);
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: guessCurrency(), minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
}
function guessCurrency() { try { return (Intl.NumberFormat().resolvedOptions().currency) || 'USD'; } catch { return 'USD'; } }
function formatCell(col, val) {
  if (/revenue|price|total|cost|profit/i.test(col)) return formatCurrency(val);
  if (/margin/i.test(col)) return formatPercent(val);
  // Format orders and items as integers, quantities with 2 decimals to preserve fractional amounts
  if (/orders|items/i.test(col)) return escapeHtml((Number(val) || 0).toFixed(0));
  if (/quantity/i.test(col)) return escapeHtml(formatNumberTwo(val));
  // For any other numeric values, show exactly two decimals
  if (isNumeric(val)) return escapeHtml(formatNumberTwo(val));
  return escapeHtml(String(val ?? ''));
}
function formatPercent(n) {
  return `${new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(n) || 0)}%`;
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])); }
function csvEscape(v) {
  const s = String(v ?? '');
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g,'""') + '"';
  return s;
}
function isNumeric(v){ return v !== null && v !== '' && !Array.isArray(v) && !isNaN(v); }
function formatNumberTwo(v){
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(Number(v) || 0);
}
function formatCsvValue(v){ if (isNumeric(v)) return formatNumberTwo(v); const s=String(v??''); return s; }

