export async function parseCsv(fileOrText, options = {}) {
  const cfg = {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    preview: options.preview || 0,
    worker: true,
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
  // Drop last row if present (often a 'Totals' row not needed for analysis)
  if (rows.length) rows = rows.slice(0, -1);
  const headers = res.meta?.fields || Object.keys(rows[0] || {});
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
    qty: find('qty', 'quantity', 'units'),
    price: find('price', 'unit price', 'amount'),
    revenue: find('revenue', 'total', 'gross', 'net', 'sales'),
    category: '',
    order: '',
    client: '',
    staff: '',
    cost: ''
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
    await new Promise((resolve, reject) => {
      let fileCursor = 0;
      let fileHeaders = null;
      window.Papa.parse(f, {
        header: true,
        skipEmptyLines: true,
        dynamicTyping: false,
        worker: true,
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

