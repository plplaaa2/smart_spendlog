// Verify conditional consumption exclusions against SQLite without production writes.
// Related: database/expense_filter.js, routes/analytics.js, database/ha_sync.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { consumptionCondition } = require('../database/expense_filter');

test('card repayment exclusions require transfer and a bank, preserving cash debits', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE transactions (id INTEGER, type TEXT, category TEXT, pay_type TEXT, pay_method TEXT, amount REAL)');
  const insert = db.prepare('INSERT INTO transactions VALUES (?, ?, ?, ?, ?, ?)');
  const cases = [
    ['카드상환', 'TRANSFER', '하나은행', false],
    ['카드상환', 'TRANSFER', '토스뱅크', false],
    ['카드상환', 'TRANSFER', '신협', false],
    ['카드상환', 'CHECK', '하나은행', true],
    ['카드상환', 'CREDIT', '하나은행', true],
    ['카드상환', 'TRANSFER', '하나카드', true],
    ['카드상환', 'TRANSFER', 'NH농협카드', true],
    ['카드상환', 'TRANSFER', '계좌이체', true],
    ['카드상환', null, '하나은행', true],
    ['카드상환', 'TRANSFER', null, true],
    ['생활/잡화', 'TRANSFER', '하나은행', true],
    ['이체/송금', 'TRANSFER', '하나은행', false]
  ];
  cases.forEach(([category, type, method], index) => insert.run(index + 1, 'EXPENSE', category, type, method, 1000));
  const expected = cases.flatMap((row, index) => row[3] ? [index + 1] : []);
  assert.deepEqual(db.prepare(`SELECT id FROM transactions WHERE type = 'EXPENSE' AND ${consumptionCondition()}`).all().map(row => row.id), expected);
  assert.equal(db.prepare(`SELECT SUM(CASE WHEN type = 'EXPENSE' AND ${consumptionCondition()} THEN amount ELSE 0 END) AS expense FROM transactions`).get().expense, expected.length * 1000);
  assert.equal(db.prepare("SELECT -SUM(amount) AS cash FROM transactions WHERE pay_method = '하나은행' AND type = 'EXPENSE'").get().cash, -6000);
  db.exec("CREATE TABLE categories (name TEXT); INSERT INTO categories VALUES ('카드상환')");
  assert.equal(db.prepare(`SELECT SUM(t.amount) AS expense FROM categories c LEFT JOIN transactions t ON c.name = t.category AND t.type = 'EXPENSE' AND ${consumptionCondition('t.')}`).get().expense, 7000);
  db.close();
});
