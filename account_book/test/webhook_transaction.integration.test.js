// SQLite integration tests for atomic Webhook transaction and log storage.
// Related files: database/webhook_transaction.js and routes/webhook.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { storeWebhookTransaction } = require('../database/webhook_transaction');

async function openStorageDatabase() {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT, amount INTEGER, merchant TEXT, category TEXT, pay_method TEXT,
      pay_type TEXT, datetime TEXT, memo TEXT, raw_text TEXT, used_point INTEGER,
      original_amount REAL, currency TEXT, exchange_rate REAL
    );
    CREATE TABLE notification_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender TEXT, raw_text TEXT, title TEXT, text TEXT,
      parsed_status TEXT CHECK (parsed_status = 'SUCCESS'), matched_rule_id INTEGER
    );
  `);
  return db;
}

function storageInput(parsedStatus = 'SUCCESS') {
  return {
    transaction: {
      type: 'EXPENSE', amount: 2500, merchant: 'Atomic Store', category: 'Dining',
      payMethod: 'Test Card', payType: 'CREDIT', datetime: '2026-08-09 12:00:00',
      memo: 'atomic', rawText: 'atomic raw text', usedPoint: 300,
      originalAmount: null, currency: null, exchangeRate: null
    },
    notification: {
      sender: 'test.package', title: 'Card', text: 'payment', parsedStatus, matchedRuleId: 3
    }
  };
}

test('stores a Webhook transaction and success log in one commit', async () => {
  const db = await openStorageDatabase();
  try {
    await storeWebhookTransaction(db, storageInput());
    assert.deepEqual(await db.get('SELECT merchant, amount, used_point FROM transactions'),
      { merchant: 'Atomic Store', amount: 2500, used_point: 300 });
    assert.deepEqual(await db.get('SELECT parsed_status, matched_rule_id FROM notification_logs'),
      { parsed_status: 'SUCCESS', matched_rule_id: 3 });
  } finally {
    await db.close();
  }
});

test('rolls back the transaction when success log insertion fails', async () => {
  const db = await openStorageDatabase();
  try {
    await assert.rejects(storeWebhookTransaction(db, storageInput('INVALID')), /CHECK constraint failed/);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM transactions')).count, 0);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM notification_logs')).count, 0);
  } finally {
    await db.close();
  }
});
