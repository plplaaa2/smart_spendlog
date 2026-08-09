// SQLite integration tests for rules scheduling migration and query ordering.
// Related file: database/rule_metadata.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const { migrateRuleMetadata, getActiveRules } = require('../database/rule_metadata');

async function openLegacyRulesDatabase() {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE,
      pattern TEXT,
      category TEXT,
      pay_method TEXT,
      pay_type TEXT DEFAULT 'CREDIT',
      merchant_template TEXT,
      type TEXT DEFAULT 'EXPENSE'
    )
  `);
  return db;
}

test('migrates a legacy rules table with behavior-preserving defaults', async () => {
  const db = await openLegacyRulesDatabase();
  try {
    await db.run("INSERT INTO rules (name, pattern) VALUES ('기존 규칙', '^test$')");
    await migrateRuleMetadata(db, 'test');

    const columns = await db.all('PRAGMA table_info(rules)');
    assert.deepEqual(
      columns.filter(column => ['priority', 'enabled', 'source'].includes(column.name)).map(column => column.name),
      ['priority', 'enabled', 'source']
    );

    const row = await db.get("SELECT priority, enabled, source FROM rules WHERE name = '기존 규칙'");
    assert.deepEqual(row, { priority: 100, enabled: 1, source: 'USER' });
  } finally {
    await db.close();
  }
});

test('returns only enabled rules ordered by priority and id', async () => {
  const db = await openLegacyRulesDatabase();
  try {
    await migrateRuleMetadata(db, 'test');
    await db.run("INSERT INTO rules (name, priority, enabled, source) VALUES ('후순위', 200, 1, 'AUTO')");
    await db.run("INSERT INTO rules (name, priority, enabled, source) VALUES ('우선 A', 50, 1, 'USER')");
    await db.run("INSERT INTO rules (name, priority, enabled, source) VALUES ('비활성', 1, 0, 'USER')");
    await db.run("INSERT INTO rules (name, priority, enabled, source) VALUES ('우선 B', 50, 1, 'DEFAULT')");

    const rows = await getActiveRules(db);
    assert.deepEqual(rows.map(row => row.name), ['우선 A', '우선 B', '후순위']);
  } finally {
    await db.close();
  }
});
