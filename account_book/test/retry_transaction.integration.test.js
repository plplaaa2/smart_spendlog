// SQLite integration tests for atomic notification retry replacement.
// Related files: database/retry_transaction.js and routes/rules.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { replaceRetryTransaction } = require('../database/retry_transaction');

async function openRetryDatabase() {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT, amount INTEGER, merchant TEXT, category TEXT, pay_method TEXT,
      datetime TEXT, memo TEXT, raw_text TEXT, used_point INTEGER DEFAULT 0
    );
    CREATE TABLE notification_logs (
      id INTEGER PRIMARY KEY,
      parsed_status TEXT CHECK (parsed_status IN ('FAILED', 'SUCCESS')),
      matched_rule_id INTEGER
    );
  `);
  await db.run("INSERT INTO transactions (type, amount, merchant, raw_text) VALUES ('EXPENSE', 1000, 'before', 'same raw text')");
  await db.run("INSERT INTO notification_logs (id, parsed_status) VALUES (7, 'FAILED')");
  return db;
}

function replacement(overrides = {}) {
  return {
    rawText: 'same raw text',
    transaction: {
      type: 'EXPENSE', amount: 2500, merchant: 'after', category: 'food',
      payMethod: 'card', datetime: '2026-08-09 12:00:00', memo: 'retried', usedPoint: 300
    },
    parsedStatus: 'SUCCESS',
    matchedRuleId: 11,
    logId: 7,
    ...overrides
  };
}

test('replaces the transaction and retry log together on success', async () => {
  const db = await openRetryDatabase();
  try {
    await replaceRetryTransaction(db, replacement());
    const rows = await db.all('SELECT * FROM transactions WHERE raw_text = ?', ['same raw text']);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].merchant, 'after');
    assert.equal(rows[0].amount, 2500);
    assert.equal(rows[0].used_point, 300);
    assert.deepEqual(await db.get('SELECT parsed_status, matched_rule_id FROM notification_logs WHERE id = 7'),
      { parsed_status: 'SUCCESS', matched_rule_id: 11 });
  } finally {
    await db.close();
  }
});

test('restores the previous transaction when retry log update fails', async () => {
  const db = await openRetryDatabase();
  try {
    await assert.rejects(replaceRetryTransaction(db, replacement({ parsedStatus: 'INVALID' })),
      /CHECK constraint failed/);
    assert.deepEqual(
      await db.all('SELECT merchant, amount FROM transactions WHERE raw_text = ?', ['same raw text']),
      [{ merchant: 'before', amount: 1000 }]
    );
    assert.deepEqual(await db.get('SELECT parsed_status, matched_rule_id FROM notification_logs WHERE id = 7'),
      { parsed_status: 'FAILED', matched_rule_id: null });
  } finally {
    await db.close();
  }
});
