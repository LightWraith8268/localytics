function toNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v !== 'string') return 0;
  const cleaned = v.replace(/[$,\s]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function toDateKey(v) {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const dd = String(d.getDate()).padStart(2,'0');
  return `${yyyy}-${mm}-${dd}`;
}

export function computeReport(rows, mapping) {
  const dateCol = mapping.date; const itemCol = mapping.item;
  const qtyCol = mapping.qty; const priceCol = mapping.price; const revCol = mapping.revenue; const costCol = mapping.cost;
  const byItem = new Map();
  const byDate = new Map();
  let totalQty = 0; let totalRev = 0; let totalCost = 0; let items = new Set();

  for (const r of rows) {
    const item = (r[itemCol] ?? '').toString().trim();
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
  const byDateArr = [...byDate.values()].sort((a,b)=> a.date.localeCompare(b.date));

  return {
    totals: {
      totalQuantity: totalQty,
      totalRevenue: Number(totalRev.toFixed(2)),
      totalCost: Number(totalCost.toFixed(2)),
      totalProfit: Number((totalRev - totalCost).toFixed(2)),
      marginPct: totalRev > 0 ? Number((((totalRev - totalCost) / totalRev) * 100).toFixed(2)) : 0,
      distinctItems: items.size,
    },
    byItem: byItemArr.map(x => ({ item:x.item, quantity:x.quantity, revenue: Number(x.revenue.toFixed(2)), cost: Number(x.cost.toFixed(2)), profit: Number((x.revenue - x.cost).toFixed(2)), margin: x.revenue>0 ? Number((((x.revenue-x.cost)/x.revenue)*100).toFixed(2)) : 0 })),
    byDate: byDateArr.map(x => ({ date:x.date, quantity:x.quantity, revenue: Number(x.revenue.toFixed(2)), cost: Number(x.cost.toFixed(2)), profit: Number((x.revenue - x.cost).toFixed(2)), margin: x.revenue>0 ? Number((((x.revenue-x.cost)/x.revenue)*100).toFixed(2)) : 0 })),
  };
}

function weekKey(d) {
  // ISO week number
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7; // 1..7, Mon..Sun
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(),0,1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1)/7);
  const yyyy = date.getUTCFullYear();
  return `${yyyy}-W${String(weekNo).padStart(2,'0')}`;
}

function quarterKey(d) {
  const q = Math.floor(d.getMonth()/3)+1; return `${d.getFullYear()}-Q${q}`;
}

export function bucketDateKey(dateStr, granularity) {
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '';
  switch ((granularity||'day')) {
    case 'week': return weekKey(d);
    case 'month': return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    case 'quarter': return quarterKey(d);
    case 'year': return String(d.getFullYear());
    case 'day':
    default: return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
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
    arr.sort((a,b) => a.label.localeCompare(b.label));
  } else {
    arr.sort((a,b) => (b[metric]-a[metric]));
  }
  if (topN && groupBy === 'item') arr = arr.slice(0, topN);
  // Round revenue
  arr = arr.map(x => ({ ...x, revenue: Number(x.revenue.toFixed(2)) }));
  return arr;
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
  return Array.from(map.values()).sort((a,b)=> a.period.localeCompare(b.period)).map(x => ({ ...x, revenue: Number(x.revenue.toFixed(2)) }));
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
  // Determine labels
  const labelSet = new Set();
  for (const m of cats.values()) for (const p of m.keys()) labelSet.add(p);
  const labels = Array.from(labelSet).sort();
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
    data: labels.map(p => Number(((m.get(p) || 0)).toFixed ? (m.get(p) || 0).toFixed(2) : (m.get(p) || 0))),
    backgroundColor: colors[i % colors.length]
  }));
  return { labels, datasets };
}

function palette(n) {
  const base = ['#1f77b4','#ff7f0e','#2ca02c','#d62728','#9467bd','#8c564b','#e377c2','#7f7f7f','#bcbd22','#17becf'];
  const out = [];
  for (let i=0;i<n;i++) out.push(base[i%base.length]);
  return out;
}

export function aggregateByField(rows, field) {
  const map = new Map();
  for (const r of rows) {
    const key = String(field(r) ?? '').trim() || '—';
    const q = Number(r.__quantity || 0);
    const rev = Number(r.__revenue || 0);
    const cost = Number(r.__cost || 0);
    const order = r.__order || '';
    const cur = map.get(key) || { label: key, quantity: 0, revenue: 0, cost: 0, orders: new Set() };
    cur.quantity += q; cur.revenue += rev; cur.cost += cost; if (order) cur.orders.add(order); map.set(key, cur);
  }
  return Array.from(map.values())
    .map(x => ({
      label: x.label,
      orders: x.orders.size,
      quantity: x.quantity,
      revenue: Number(x.revenue.toFixed(2)),
      cost: Number(x.cost.toFixed(2)),
      profit: Number((x.revenue - x.cost).toFixed(2)),
      margin: x.revenue > 0 ? Number((((x.revenue - x.cost)/x.revenue)*100).toFixed(2)) : 0
    }))
    .sort((a,b)=> b.revenue - a.revenue);
}

export function aggregateByOrder(rows) {
  const map = new Map();
  for (const r of rows) {
    const order = r.__order || String(r.order || '').trim() || '—';
    const q = Number(r.__quantity || 0);
    const rev = Number(r.__revenue || 0);
    const cost = Number(r.__cost || 0);
    const date = r.__dateIso || '';
    const client = r.__client || r.client || '';
    const staff = r.__staff || r.staff || '';
    const cur = map.get(order) || { order, date, client, staff, quantity: 0, revenue: 0, cost: 0 };
    cur.quantity += q; cur.revenue += rev; cur.cost += cost;
    if (!cur.date || (date && date < cur.date)) cur.date = date; // earliest
    if (!cur.client && client) cur.client = client;
    if (!cur.staff && staff) cur.staff = staff;
    map.set(order, cur);
  }
  return Array.from(map.values()).map(x => ({
    order: x.order,
    date: x.date,
    client: x.client,
    staff: x.staff,
    quantity: x.quantity,
    revenue: Number(x.revenue.toFixed(2)),
    cost: Number(x.cost.toFixed(2)),
    profit: Number((x.revenue - x.cost).toFixed(2)),
    margin: x.revenue > 0 ? Number((((x.revenue - x.cost)/x.revenue)*100).toFixed(2)) : 0
  })).sort((a,b)=> b.revenue - a.revenue);
}
