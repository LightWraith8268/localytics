function toNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return 0;
  const cleaned = v.replace(/[$,\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}
function round2(value) { const num = Number(value || 0); return Number.isFinite(num) ? Number(num.toFixed(2)) : 0; }



function toDateKey(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  // Use UTC methods to prevent timezone shifts (e.g., Oct 2 becoming Oct 1 in Mountain Time)
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth()+1).padStart(2,'0');
  const dd = String(d.getUTCDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

export function computeReport(rows, mapping) {
  const dateCol = mapping.date; const itemCol = mapping.item;
  const qtyCol = mapping.qty; const priceCol = mapping.price; const revCol = mapping.revenue; const costCol = mapping.cost;
  const orderCol = mapping.order;
  const byItem = new Map();
  const byDate = new Map();
  let totalQty = 0; let totalRev = 0; let totalCost = 0; let items = new Set(); let orders = new Set();

  for (const r of rows) {
    const item = (r[itemCol] ?? '').toString().trim();
    const order = (r[orderCol] ?? '').toString().trim();
    const q = (r.__quantity != null) ? Number(r.__quantity) : toNumber(r[qtyCol]);
    const price = toNumber(r[priceCol]);
    const unitCost = toNumber(r[costCol]);
    const rev = (r.__revenue != null) ? Number(r.__revenue) : (q * price);
    const cst = (r.__cost != null) ? Number(r.__cost) : (q * unitCost);
    const dateKey = toDateKey(r[dateCol]);
    if (!item && !q && !rev) continue;

    // Totals
    totalQty += q;
    totalRev += rev;
    totalCost += cst;
    if (item) items.add(item);
    if (order) orders.add(order);

    // Item agg
    const it = byItem.get(item) || { item, quantity: 0, revenue: 0, cost: 0, profit: 0 };
    it.quantity += q; it.revenue += rev; it.cost += cst; it.profit = it.revenue - it.cost; byItem.set(item, it);

    // Date agg
    if (dateKey) {
      const dt = byDate.get(dateKey) || { date: dateKey, quantity: 0, revenue: 0, cost: 0, profit: 0 };
      dt.quantity += q; dt.revenue += rev; dt.cost += cst; dt.profit = dt.revenue - dt.cost; byDate.set(dateKey, dt);
    }
  }

  const byItemArr = [...byItem.values()].sort((a,b)=> b.revenue - a.revenue);
  // Sort dates chronologically using ISO format comparison (not alphabetically by display format)
  const byDateArr = [...byDate.values()].sort((a,b)=> {
    // Date keys are already in ISO format (YYYY-MM-DD), which sorts correctly
    return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
  });

  return {
    totals: {
      totalQuantity: round2(totalQty),
      totalRevenue: round2(totalRev),
      totalCost: round2(totalCost),
      totalProfit: round2(totalRev - totalCost),
      marginPct: totalRev > 0 ? round2(((totalRev - totalCost) / totalRev) * 100) : 0,
      distinctItems: items.size,
      totalOrders: orders.size,
    },
    byItem: byItemArr.map(x => ({ item:x.item, quantity: round2(x.quantity), revenue: round2(x.revenue), cost: round2(x.cost), profit: round2(x.revenue - x.cost), margin: x.revenue>0 ? round2(((x.revenue - x.cost) / x.revenue) * 100) : 0 })),
    byDate: byDateArr.map(x => ({ date:x.date, quantity: round2(x.quantity), revenue: round2(x.revenue), cost: round2(x.cost), profit: round2(x.revenue - x.cost), margin: x.revenue>0 ? round2(((x.revenue - x.cost) / x.revenue) * 100) : 0 })),
  };
}

function weekKey(d) {
  // ISO week number - use UTC to prevent timezone shifts
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7; // 1..7, Mon..Sun
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(),0,1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1)/7);
  const yyyy = date.getUTCFullYear();
  return `${yyyy}-W${String(weekNo).padStart(2,'0')}`;
}

function quarterKey(d) {
  // Use UTC to prevent timezone shifts
  const q = Math.floor(d.getUTCMonth()/3)+1; return `${d.getUTCFullYear()}-Q${q}`;
}

export function bucketDateKey(dateStr, granularity) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  // Use UTC methods throughout to prevent timezone shifts
  switch ((granularity||'day')) {
    case 'week': return weekKey(d);
    case 'month': return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}`;
    case 'quarter': return quarterKey(d);
    case 'year': return String(d.getUTCFullYear());
    case 'day':
    default: return `${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
  }
}

export function aggregateCustom(rows, mapping, opts) {
  const groupBy = opts.groupBy || 'date';
  const metric = opts.metric || 'revenue'; // 'revenue' | 'quantity'
  const gran = opts.granularity || 'month';
  const topN = Number(opts.topN || 0);
  const map = new Map();
  for (const r of rows) {
    const key = groupBy === 'item' ? String(r[mapping.item] || '').trim() : bucketDateKey(r[mapping.date], gran);
    if (!key) continue;
    const q = Number(r[mapping.qty] || 0) || 0;
    const price = mapping.revenue ? 0 : Number((r[mapping.price] || '').toString().replace(/[$,\s]/g,'')) || 0;
    const rev = mapping.revenue ? (Number((r[mapping.revenue] || '').toString().replace(/[$,\s]/g,'')) || 0) : (price * q);
    const cur = map.get(key) || { label: key, quantity: 0, revenue: 0 };
    cur.quantity += q; cur.revenue += rev; map.set(key, cur);
  }
  let arr = Array.from(map.values());
  if (groupBy === 'date') {
    // Sort dates chronologically (labels are in ISO format YYYY-MM-DD)
    arr.sort((a,b) => a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
  } else {
    arr.sort((
      (a,b) => b.revenue - a.revenue
    ));
  }
  if (topN > 0) arr = arr.slice(0, topN);
  if (metric === 'quantity') return arr.map(x => ({ label: x.label, value: round2(x.quantity) }));
  return arr.map(x => ({ label: x.label, value: round2(x.revenue) }));
}

export function aggregateByGranularity(rows, mapping, granularity = 'month') {
  const map = new Map();
  for (const r of rows) {
    const key = bucketDateKey(r[mapping.date], granularity);
    if (!key) continue;
    const q = Number(r[mapping.qty] || 0) || 0;
    const price = mapping.revenue ? 0 : Number((r[mapping.price] || '').toString().replace(/[$,\s]/g,'')) || 0;
    const rev = mapping.revenue ? (Number((r[mapping.revenue] || '').toString().replace(/[$,\s]/g,'')) || 0) : (price * q);
    const cur = map.get(key) || { period: key, quantity: 0, revenue: 0 };
    cur.quantity += q; cur.revenue += rev; map.set(key, cur);
  }
  // Sort periods chronologically (periods are in ISO-like format YYYY-MM, YYYY-Wxx, etc.)
  return Array.from(map.values()).sort((a,b)=> a.period < b.period ? -1 : a.period > b.period ? 1 : 0).map(x => ({ period: x.period, quantity: round2(x.quantity), revenue: round2(x.revenue) }));
}

export function aggregateByCategoryOverTime(rows, mapping, granularity = 'month', metric = 'revenue', topN = 0) {
  const cats = new Map(); // cat -> Map(period -> value)
  const totals = new Map(); // cat -> total metric
  for (const r of rows) {
    const period = bucketDateKey(r[mapping.date], granularity);
    if (!period) continue;
    const cat = (r[mapping.category] || 'Uncategorized').toString().trim() || 'Uncategorized';
    const q = Number(r[mapping.qty] || 0) || 0;
    const price = mapping.revenue ? 0 : Number((r[mapping.price] || '').toString().replace(/[$,\s]/g,'')) || 0;
    const rev = mapping.revenue ? (Number((r[mapping.revenue] || '').toString().replace(/[$,\s]/g,'')) || 0) : (price * q);
    const val = (metric === 'quantity') ? q : rev;
    const m = cats.get(cat) || new Map();
    m.set(period, (m.get(period) || 0) + val);
    cats.set(cat, m);
    totals.set(cat, (totals.get(cat) || 0) + val);
  }
  // Determine labels (time periods in chronological order)
  const labelSet = new Set();
  for (const m of cats.values()) for (const p of m.keys()) labelSet.add(p);
  // Sort chronologically (labels are in ISO-like format: YYYY-MM, YYYY-Wxx, etc.)
  const labels = Array.from(labelSet).sort((a,b) => a < b ? -1 : a > b ? 1 : 0);
  // Optionally limit to top N categories
  let entries = Array.from(cats.entries());
  if (topN && topN > 0) {
    entries.sort((a,b)=> (totals.get(b[0]) - totals.get(a[0])));
    entries = entries.slice(0, topN);
  }
  // Build datasets
  const colors = palette(entries.length);
  const datasets = entries.map(([cat, m], i) => ({
    label: cat,
    data: labels.map(p => round2(m.get(p) || 0)),
    backgroundColor: colors[i % colors.length]
  }));
  return { labels, datasets };
}

function palette(n) {
  // Enhanced color palette with better distinction and accessibility
  const base = [
    '#2563eb', // Blue
    '#dc2626', // Red
    '#16a34a', // Green
    '#ea580c', // Orange
    '#9333ea', // Purple
    '#0891b2', // Cyan
    '#e11d48', // Rose
    '#65a30d', // Lime
    '#7c3aed', // Violet
    '#0d9488', // Teal
    '#c2410c', // Orange-red
    '#be123c', // Deep pink
    '#059669', // Emerald
    '#7c2d12', // Brown
    '#1e40af', // Deep blue
    '#991b1b', // Dark red
    '#15803d', // Dark green
    '#9f1239', // Dark rose
    '#6d28d9', // Dark purple
    '#0f766e'  // Dark teal
  ];
  const out = [];
  for (let i=0;i<n;i++) out.push(base[i%base.length]);
  return out;
}

export function aggregateByField(rows, field) {
  const map = new Map();
  let debuggedFirstRow = false;
  for (const r of rows) {
    const key = String(field(r) ?? '').trim() || '-';
    const q = Number(r.__quantity || 0);
    const rev = Number(r.__revenue || 0);
    const cost = Number(r.__cost || 0);
    const order = (r.__order || '').toString().trim();
    const cur = map.get(key) || { label: key, quantity: 0, revenue: 0, cost: 0, orders: new Set() };
    cur.quantity += q; cur.revenue += rev; cur.cost += cost;

    // Debug first row to see what order values look like
    if (!debuggedFirstRow && order) {
      console.log('[aggregateByField] First row order value:', {
        raw: r.__order,
        trimmed: order,
        willCount: order && order !== 'undefined' && order !== '-'
      });
      debuggedFirstRow = true;
    }

    if (order && order !== 'undefined' && order !== '-' && order !== '') {
      cur.orders.add(order);
    }
    map.set(key, cur);
  }
  return Array.from(map.values())
    .map(x => ({
      label: x.label,
      orders: x.orders.size,
      quantity: round2(x.quantity),
      revenue: round2(x.revenue),
      cost: round2(x.cost),
      profit: round2(x.revenue - x.cost),
      margin: x.revenue > 0 ? round2(((x.revenue - x.cost) / x.revenue) * 100) : 0
    }))
    .sort((a,b)=> b.revenue - a.revenue);
}

export function aggregateByOrder(rows, mapping) {
  const map = new Map();
  const itemCol = mapping?.item;
  let undefinedCount = 0;
  for (const r of rows) {
    const order = r.__order || String(r.order || '').trim() || '-';
    if (order === 'undefined') undefinedCount++;
    const q = Number(r.__quantity || 0);
    const rev = Number(r.__revenue || 0);
    const cost = Number(r.__cost || 0);
    const date = r.__dateIso || '';
    const client = r.__client || r.client || '';
    const staff = r.__staff || r.staff || '';
    const item = itemCol ? String(r[itemCol] || '').trim() : '';
    const cur = map.get(order) || { order, date, client, staff, quantity: 0, revenue: 0, cost: 0, items: new Set() };
    cur.quantity += q; cur.revenue += rev; cur.cost += cost;
    if (item && item !== 'undefined' && item !== '') cur.items.add(item);
    if (!cur.date || (date && date < cur.date)) cur.date = date; // earliest
    if (!cur.client && client) cur.client = client;
    if (!cur.staff && staff) cur.staff = staff;
    map.set(order, cur);
  }
  console.log('[aggregateByOrder] Total rows processed:', rows.length);
  console.log('[aggregateByOrder] Rows with order="undefined":', undefinedCount);
  console.log('[aggregateByOrder] Distinct order numbers:', map.size);
  return Array.from(map.values()).map(x => ({
    order: x.order,
    date: x.date,
    client: x.client,
    staff: x.staff,
    items: x.items.size,
    quantity: round2(x.quantity),
    revenue: round2(x.revenue),
    cost: round2(x.cost),
    profit: round2(x.revenue - x.cost),
    margin: x.revenue > 0 ? round2(((x.revenue - x.cost) / x.revenue) * 100) : 0
  })).sort((a,b)=> b.revenue - a.revenue);
}

