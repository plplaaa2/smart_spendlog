// Exclude bank transfers repaying cards from consumption, while preserving bank cash flow.
// Related: routes/analytics.js, database/ha_sync.js, test/expense_filter.test.js.
function consumptionCondition(alias = '') {
  const column = name => `${alias}${name}`;
  const method = column('pay_method');
  const bank = ['은행', '뱅크', '농협', '우체국', '새마을금고', '신협', '수협']
    .map(name => `${method} LIKE '%${name}%'`).join(' OR ');
  return `${column('category')} != '이체/송금' AND NOT COALESCE((${column('category')} = '카드상환' AND ${column('pay_type')} = 'TRANSFER' AND ${method} NOT LIKE '%카드%' AND (${bank})), 0)`;
}

module.exports = { consumptionCondition };
