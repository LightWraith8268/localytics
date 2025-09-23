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
  const qtyCol = mapping.qty; const priceCol = mapping.price; const revCol = mapping.revenue;
  const byItem = new Map();
  const byDate = new Map();
  let totalQty = 0; let totalRev = 0; let items = new Set();

  for (const r of rows) {
    const item = (r[itemCol] ?? '').toString().trim();
    const q = toNumber(r[qtyCol]);
    const price = revCol ? 0 : toNumber(r[priceCol]);
    const rev = revCol ? toNumber(r[revCol]) : (price * q);
    const dateKey = toDateKey(r[dateCol]);
    if (!item && !q && !rev) continue;

    // Totals
    totalQty += q;
    totalRev += rev;
    if (item) items.add(item);

    // Item agg
    const it = byItem.get(item) || { item, quantity: 0, revenue: 0 };
    it.quantity += q; it.revenue += rev; byItem.set(item, it);

    // Date agg
    if (dateKey) {
      const dt = byDate.get(dateKey) || { date: dateKey, quantity: 0, revenue: 0 };
      dt.quantity += q; dt.revenue += rev; byDate.set(dateKey, dt);
    }
  }

  const byItemArr = [...byItem.values()].sort((a,b)=> b.revenue - a.revenue);
  const byDateArr = [...byDate.values()].sort((a,b)=> a.date.localeCompare(b.date));

  return {
    totals: {
      totalQuantity: totalQty,
      totalRevenue: Number(totalRev.toFixed(2)),
      distinctItems: items.size,
    },
    byItem: byItemArr.map(x => ({ item:x.item, quantity:x.quantity, revenue: Number(x.revenue.toFixed(2)) })),
    byDate: byDateArr.map(x => ({ date:x.date, quantity:x.quantity, revenue: Number(x.revenue.toFixed(2)) })),
  };
}

