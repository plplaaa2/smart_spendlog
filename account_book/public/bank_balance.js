// Calculate account-aware balance anchors without rewriting stored transactions.
// Related: routes/analytics.js, Android standalone_api.js and both dashboards.
(function (root) {
  const accountOf = row => (String(row.memo || '').match(/계좌\s*[:：]\s*([^\s|]+)/u) || [])[1] || '';
  const after = (row, anchor) => String(row.datetime || '') > String(anchor.datetime || '') || row.datetime === anchor.datetime && Number(row.id || 0) > Number(anchor.id || 0);
  const delta = row => row.type === 'INCOME' ? Number(row.amount || 0) : row.type === 'EXPENSE' ? -Math.max(0, Number(row.amount || 0) - Number(row.used_point || 0)) : 0;
  function balanceAnchor(name, rows) {
    const anchors = rows.filter(row => row.pay_method === name).map(row => {
      const match = String(row.memo || '').match(/잔액\s*[:：]\s*([\d,]+)/u);
      return match ? { row, account: accountOf(row), balance: Number(match[1].replace(/,/g, '')) } : null;
    }).filter(Boolean).sort((a, b) => String(b.row.datetime || '').localeCompare(String(a.row.datetime || '')) || Number(b.row.id || 0) - Number(a.row.id || 0));
    if (!anchors.length) return { anchor: null, estimated: true };
    const accounts = new Set(rows.map(accountOf).filter(Boolean));
    if (accounts.size <= 1) return { anchor: anchors[0], estimated: false };
    const latest = new Map();
    anchors.forEach(anchor => { if (anchor.account && !latest.has(anchor.account)) latest.set(anchor.account, anchor); });
    // Keep the initial-balance fallback when account attribution is incomplete.
    if (latest.size !== accounts.size || anchors.some(anchor => !anchor.account)) return { anchor: null, estimated: true };
    const newest = anchors[0];
    const oldest = [...latest.values()].sort((a, b) => String(a.row.datetime || '').localeCompare(String(b.row.datetime || '')) || Number(a.row.id || 0) - Number(b.row.id || 0))[0];
    if (rows.some(row => !accountOf(row) && after(row, oldest.row) && !after(row, newest.row))) return { anchor: null, estimated: true };
    let balance = [...latest.values()].reduce((sum, anchor) => sum + anchor.balance, 0);
    rows.forEach(row => {
      const anchor = latest.get(accountOf(row));
      if (anchor && after(row, anchor.row) && !after(row, newest.row)) balance += delta(row);
    });
    return { anchor: { ...newest, balance }, estimated: false };
  }
  const api = { balanceAnchor };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SpendLogBankBalance = api;
})(typeof window === 'object' ? window : globalThis);
