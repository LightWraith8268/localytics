export async function parseCsv(fileOrText, options = {}) {
  // Ensure Papa Parse is loaded
  if (!window.Papa) {
    throw new Error('Papa Parse library not loaded. Please refresh the page.');
  }

  const cfg = {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    preview: options.preview || 0,
    worker: false, // Disable worker mode to avoid "p1 is not defined" error
  };
  const input = fileOrText;
  const res = await new Promise((resolve, reject) => {
    window.Papa.parse(input, {
      ...cfg,
      complete: (res) => resolve(res),
      error: reject,
    });
  });
  let rows = res.data.filter(r => r && typeof r === 'object');

  // Filter out rows that don't have data in the name/item column
  // First, get headers to identify the name column
  const headers = res.meta?.fields || Object.keys(rows[0] || {});
  console.log('[csv] Parsed headers:', headers);
  console.log('[csv] Total rows before filtering:', rows.length);

  const nameColumn = headers.find(h =>
    h.toLowerCase().includes('name') ||
    h.toLowerCase().includes('item') ||
    h.toLowerCase().includes('product') ||
    h.toLowerCase().includes('title')
  ) || headers[0]; // fallback to first column

  console.log('[csv] Detected name column:', nameColumn);

  // Filter out rows without data in the name column
  const originalRowCount = rows.length;
  rows = rows.filter(row => {
    const nameValue = row[nameColumn];
    const hasValue = nameValue && nameValue.toString().trim() !== '';
    if (!hasValue) {
      console.log('[csv] Filtering out row with empty name column:', row);
    }
    return hasValue;
  });

  console.log('[csv] Rows after name column filtering:', rows.length, 'of', originalRowCount);

  // Remove final empty row if it exists (common in exports)
  if (rows.length > 0) {
    const lastRow = rows[rows.length - 1];
    const hasData = Object.values(lastRow).some(val => val && val.toString().trim() !== '');
    if (!hasData) {
      console.log('[csv] Removing empty last row:', lastRow);
      rows = rows.slice(0, -1);
    }
  }

  console.log('[csv] Final result - rows:', rows.length, 'headers:', headers.length);
  if (rows.length > 0) {
    console.log('[csv] Sample first row:', rows[0]);
  }

  return { rows, headers };
}

export function detectColumns(headers = []) {
  const h = headers.map(x => x.toLowerCase());
  const find = (...candidates) => {
    for (const c of candidates) {
      const i = h.findIndex(v => v.includes(c));
      if (i >= 0) return headers[i];
    }
    return '';
  };
  return {
    date: find('date', 'time', 'timestamp'),
    item: find('name', 'title', 'product', 'item', 'sku'),
    qty: find('quantity', 'qty', 'units'),
    price: find('price', 'unit price', 'amount'),
    order: find('order number', 'order', 'order no', 'orderno'),
    client: find('client', 'customer', 'company'),
    staff: find('staff', 'employee', 'salesperson', 'rep'),
    cost: find('cost', 'unit cost', 'cost per unit'),
    revenue: '',  // Unmapped by default
    category: ''  // Unmapped by default
  };
}

export async function parseCsvFiles(fileList, options = {}) {
  const files = Array.from(fileList || []);
  if (!files.length) return { rows: [], headers: [] };
  const preview = options.preview || 0;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  // Fast path for preview: simple parse per file (no progress reporting needed)
  if (preview > 0) {
    let allRows = []; const headerSet = new Set();
    for (const f of files) {
      const { rows, headers } = await parseCsv(f, { preview });
      rows.forEach(r => allRows.push(r));
      headers.forEach(h => headerSet.add(h));
    }
    return { rows: allRows, headers: Array.from(headerSet) };
  }

  // Full parse with progress across all files
  const totalBytes = files.reduce((acc, f) => acc + (f.size || 0), 0) || 0;
  let processedBytesBefore = 0;
  let allRows = []; const headerSet = new Set();

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    // Ensure Papa Parse is loaded
    if (!window.Papa) {
      throw new Error('Papa Parse library not loaded. Please refresh the page.');
    }
    await new Promise((resolve, reject) => {
      let fileCursor = 0;
      let fileHeaders = null;
      window.Papa.parse(f, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
        worker: false, // Disable worker mode to avoid "p1 is not defined" error
        chunkSize: 1024 * 1024, // 1MB chunks
        chunk: (results) => {
          const rows = results.data.filter(r => r && typeof r === 'object');
          allRows.push(...rows);
          if (!fileHeaders) fileHeaders = results.meta?.fields || Object.keys(rows[0] || {});
          if (results.meta && typeof results.meta.cursor === 'number') {
            fileCursor = results.meta.cursor;
          }
          if (onProgress) {
            const fileSize = f.size || 0;
            const loaded = processedBytesBefore + Math.min(fileCursor, fileSize);
            const percent = totalBytes > 0 ? Math.min(99, Math.floor((loaded / totalBytes) * 100)) : 0;
            onProgress({
              fileIndex: i,
              filesCount: files.length,
              fileName: f.name,
              loadedBytes: loaded,
              totalBytes,
              percent,
              rowsParsed: allRows.length,
            });
          }
        },
        complete: () => {
          if (Array.isArray(fileHeaders)) fileHeaders.forEach(h => headerSet.add(h));
          processedBytesBefore += (f.size || 0);
          if (onProgress) {
            const loaded = Math.min(processedBytesBefore, totalBytes);
            const percent = totalBytes > 0 ? Math.floor((loaded / totalBytes) * 100) : 100;
            onProgress({
              fileIndex: i,
              filesCount: files.length,
              fileName: f.name,
              loadedBytes: loaded,
              totalBytes,
              percent,
              rowsParsed: allRows.length,
            });
          }
          resolve();
        },
        error: reject,
      });
    });
  }
  // Remove last row globally (common CSVs have a trailing totals row)
  if (allRows.length) allRows = allRows.slice(0, -1);
  return { rows: allRows, headers: Array.from(headerSet) };
}

