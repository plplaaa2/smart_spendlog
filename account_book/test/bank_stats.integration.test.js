// Verify the real add-on statistics route against SQLite; related: analytics.js, bank_balance.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
test('add-on statistics merge aliases and preserve both sides of an internal transfer', async () => {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`CREATE TABLE settings (key TEXT, value TEXT);
    CREATE TABLE pay_methods (id INTEGER, name TEXT);
    CREATE TABLE transactions (id INTEGER, datetime TEXT, merchant TEXT, category TEXT, memo TEXT, pay_method TEXT, pay_type TEXT, type TEXT, amount INTEGER, used_point INTEGER, currency TEXT, original_amount INTEGER);
    INSERT INTO pay_methods VALUES (1, 'KB국민은행'), (2, '국민은행'), (3, '하나은행');
    INSERT INTO settings VALUES ('initial_balances', '{"국민은행":900,"하나은행":2000}');
    INSERT INTO transactions VALUES
    (1, '2026-05-24 11:05:00', 'test', '기타', '계좌: TEST 잔액: 1000', 'KB국민은행', 'TRANSFER', 'INCOME', 1000, 0, 'KRW', 0),
    (2, '2026-10-05 21:19:00', 'test', '이체/입금', '계좌: TEST 잔액: 1500', '국민은행', 'TRANSFER', 'INCOME', 500, 0, 'KRW', 0),
    (3, '2026-10-05 21:19:00', 'test', '이체/송금', '계좌: H 잔액: 1500', '하나은행', 'TRANSFER', 'EXPENSE', 500, 0, 'KRW', 0);`);
  const dbPath = require.resolve('../database'), parserPath = require.resolve('../parser'), routePath = require.resolve('../routes/analytics');
  const oldDB = require.cache[dbPath], oldParser = require.cache[parserPath];
  let server;
  try {
    require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { getDB: async () => db } };
    require.cache[parserPath] = { id: parserPath, filename: parserPath, loaded: true, exports: {} };
    delete require.cache[routePath];
    const app = express(); app.use('/api', require('../routes/analytics'));
    server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/stats?month=2026-10`);
    assert.equal(response.status, 200);
    const stats = await response.json();
    assert.equal(stats.assets.length, 2);
    assert.equal(stats.assets.find(a => a.name === '국민은행').currentBalance, 1500);
    assert.equal(stats.assets.find(a => a.name === '하나은행').currentBalance, 1500);
    assert.equal(stats.assets.reduce((sum, a) => sum + a.currentBalance, 0), 3000);
    assert.equal(stats.totalExpense, 0);
    assert.equal(stats.totalIncome, 0);
    assert.equal((await db.get('SELECT pay_method FROM transactions WHERE id=1')).pay_method, 'KB국민은행');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    if (oldDB) require.cache[dbPath] = oldDB; else delete require.cache[dbPath];
    if (oldParser) require.cache[parserPath] = oldParser; else delete require.cache[parserPath];
    delete require.cache[routePath];
    await db.close();
  }
});
