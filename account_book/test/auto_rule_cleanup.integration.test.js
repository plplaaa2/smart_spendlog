// SQLite integration tests for generated automatic rule cleanup.
// Related files: database/auto_rule_cleanup.js, routes/webhook.js, and routes/rules.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { removeUnusableAutoRule } = require('../database/auto_rule_cleanup');

async function openRulesDatabase() {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE rules (
      id INTEGER PRIMARY KEY,
      name TEXT,
      source TEXT
    );
    INSERT INTO rules (id, name, source) VALUES (1, 'generated', 'AUTO');
    INSERT INTO rules (id, name, source) VALUES (2, 'user rule', 'USER');
  `);
  return db;
}

test('removes an AUTO rule when source reparse fails', async () => {
  const db = await openRulesDatabase();
  try {
    assert.equal(await removeUnusableAutoRule(db, 1, null), true);
    assert.equal(await db.get('SELECT id FROM rules WHERE id = 1'), undefined);
  } finally {
    await db.close();
  }
});

test('keeps an AUTO rule when source reparse succeeds', async () => {
  const db = await openRulesDatabase();
  try {
    assert.equal(await removeUnusableAutoRule(db, 1, { amount: 1000 }), false);
    assert.deepEqual(await db.get('SELECT id FROM rules WHERE id = 1'), { id: 1 });
  } finally {
    await db.close();
  }
});

test('never removes a non-AUTO rule', async () => {
  const db = await openRulesDatabase();
  try {
    assert.equal(await removeUnusableAutoRule(db, 2, null), false);
    assert.deepEqual(await db.get('SELECT id FROM rules WHERE id = 2'), { id: 2 });
  } finally {
    await db.close();
  }
});
