// Exercise account anchors shared by add-on and Android; related: public/bank_balance.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { balanceAnchor } = require('../public/bank_balance');
const row = (id, account, balance, amount = 0) => ({ id, datetime: `2026-10-05 12:0${id}:00`, pay_method: '하나은행', type: 'EXPENSE', amount, memo: `${account ? '계좌: ' + account : ''}${balance === null ? '' : ' 잔액: ' + balance}` });
test('latest account anchors incorporate intervening cash flow once', () => {
  const rows = [row(1, 'A', 1000), row(2, 'A', null, 100), row(3, 'B', 2000), row(4, 'A', null, 50)];
  const result = balanceAnchor('하나은행', rows);
  assert.equal(result.anchor.balance, 2900);
  assert.equal(result.anchor.row.id, 3);
  assert.equal(result.estimated, false);
});
test('unattributed movements between account anchors retain estimated fallback', () => {
  const result = balanceAnchor('하나은행', [row(1, 'A', 1000), row(2, '', null, 100), row(3, 'B', 2000)]);
  assert.equal(result.anchor, null);
  assert.equal(result.estimated, true);
});
test('a known second account without a balance cannot be silently omitted', () => {
  assert.equal(balanceAnchor('하나은행', [row(1, 'A', 1000), row(2, 'B', null, 100)]).estimated, true);
});
test('single-account anchor selects newest and missing anchors are estimated', () => {
  assert.equal(balanceAnchor('하나은행', [row(1, 'A', 1000), row(2, 'A', 900)]).anchor.balance, 900);
  assert.equal(balanceAnchor('하나은행', [row(1, '', null, 100)]).estimated, true);
});
