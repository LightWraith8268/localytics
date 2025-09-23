export async function parseCsv(fileOrText, options = {}) {
  const cfg = {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    preview: options.preview || 0,
  };
  const input = typeof fileOrText === 'string' ? fileOrText : fileOrText;
  const parseAsync = (input) => new Promise((resolve, reject) => {
    window.Papa.parse(input, {
      ...cfg,
      complete: (res) => resolve(res),
      error: reject,
    });
  });
  const res = await parseAsync(input);
  const rows = res.data.filter(r => r && typeof r === 'object');
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
    item: find('item', 'sku', 'product', 'name', 'title'),
    qty: find('qty', 'quantity', 'units'),
    price: find('price', 'unit price', 'amount'),
    revenue: find('revenue', 'total', 'gross', 'net', 'sales'),
  };
}

