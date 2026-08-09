// HTTP integration tests for the notification retry endpoint.
// Related files: routes/rules.js, database/retry_transaction.js, and parser.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function openEndpointDatabase() {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE rules (
      id INTEGER PRIMARY KEY,
      name TEXT,
      pattern TEXT,
      category TEXT,
      pay_method TEXT,
      merchant_template TEXT,
      type TEXT,
      priority INTEGER DEFAULT 100,
      enabled INTEGER DEFAULT 1,
      source TEXT DEFAULT 'USER'
    );
    CREATE TABLE notification_logs (
      id INTEGER PRIMARY KEY,
      sender TEXT,
      raw_text TEXT,
      title TEXT,
      text TEXT,
      parsed_status TEXT,
      matched_rule_id INTEGER,
      created_at TEXT
    );
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT,
      amount INTEGER,
      merchant TEXT,
      category TEXT,
      pay_method TEXT,
      datetime TEXT,
      memo TEXT,
      raw_text TEXT,
      used_point INTEGER DEFAULT 0
    );
    CREATE TABLE package_pay_methods (package TEXT, pay_method TEXT);
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
  `);
  await db.run("INSERT INTO rules (id, name, pattern, priority) VALUES (3, 'endpoint rule', '^sample$', 10)");
  await db.run(`
    INSERT INTO notification_logs
      (id, sender, raw_text, title, text, parsed_status, created_at)
    VALUES
      (7, 'test.package', 'sample notification', 'sample', 'notification', 'FAILED', '2026-08-09 03:00:00')
  `);
  await db.run("INSERT INTO transactions (amount, merchant, raw_text) VALUES (1000, 'before', 'sample notification')");
  return db;
}

function successfulParseResult() {
  return {
    rule_id: 3,
    type: 'EXPENSE',
    amount: 2500,
    merchant: 'After Store',
    category: 'Ignored',
    pay_method: 'Test Card',
    datetime: '2026-08-09 12:00:00',
    memo: 'retried',
    used_point: 300
  };
}

async function startRetryServer(db, options = {}) {
  const routeDb = options.routeDb || db;
  const parseResult = Object.prototype.hasOwnProperty.call(options, 'parseResult')
    ? options.parseResult
    : successfulParseResult();
  const parseNotification = options.parseNotification || (() => parseResult);
  const buildValidatedAutoRule = options.buildValidatedAutoRule || (() => ({
    valid: false,
    errors: ['automatic rule generation is not configured for this test']
  }));
  const databasePath = require.resolve('../database');
  const parserPath = require.resolve('../parser');
  const rulesPath = require.resolve('../routes/rules');
  const previousDatabase = require.cache[databasePath];
  const previousParser = require.cache[parserPath];

  require.cache[databasePath] = {
    id: databasePath,
    filename: databasePath,
    loaded: true,
    exports: {
      getDB: async () => routeDb,
      findCategoryByMerchant: async () => 'Dining',
      updateHASensors: () => {}
    }
  };
  require.cache[parserPath] = {
    id: parserPath,
    filename: parserPath,
    loaded: true,
    exports: {
      parseNotification,
      buildValidatedAutoRule
    }
  };

  let router;
  try {
    delete require.cache[rulesPath];
    router = require('../routes/rules');
  } finally {
    if (previousDatabase) require.cache[databasePath] = previousDatabase;
    else delete require.cache[databasePath];
    if (previousParser) require.cache[parserPath] = previousParser;
    else delete require.cache[parserPath];
  }
  const app = express();
  app.use(express.json());
  app.use('/api', (req, res, next) => {
    req.username = 'integration-user';
    next();
  }, router);

  const server = await new Promise((resolve, reject) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
    listeningServer.on('error', reject);
  });
  return server;
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

test('retry endpoint reparses and atomically replaces an existing transaction', async () => {
  const db = await openEndpointDatabase();
  const server = await startRetryServer(db);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/notification_logs/7/retry`, { method: 'POST' });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.deepEqual(body.transaction, { merchant: 'After Store', amount: 2500 });
    assert.deepEqual(
      await db.get('SELECT merchant, amount, category, pay_method, used_point FROM transactions WHERE raw_text = ?', ['sample notification']),
      { merchant: 'After Store', amount: 2500, category: 'Dining', pay_method: 'Test Card', used_point: 300 }
    );
    assert.deepEqual(
      await db.get('SELECT parsed_status, matched_rule_id FROM notification_logs WHERE id = 7'),
      { parsed_status: 'SUCCESS', matched_rule_id: 3 }
    );
  } finally {
    await closeServer(server);
    await db.close();
  }
});

test('retry endpoint returns 404 when the notification log does not exist', async () => {
  const db = await openEndpointDatabase();
  const server = await startRetryServer(db);
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/notification_logs/999/retry`, { method: 'POST' });
    assert.equal(response.status, 404);
  } finally {
    await closeServer(server);
    await db.close();
  }
});

test('retry endpoint returns 400 and preserves data when parsing fails', async () => {
  const db = await openEndpointDatabase();
  const server = await startRetryServer(db, { parseResult: null });
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/notification_logs/7/retry`, { method: 'POST' });
    assert.equal(response.status, 400);
    assert.deepEqual(
      await db.get('SELECT merchant, amount FROM transactions WHERE raw_text = ?', ['sample notification']),
      { merchant: 'before', amount: 1000 }
    );
    assert.deepEqual(
      await db.get('SELECT parsed_status, matched_rule_id FROM notification_logs WHERE id = 7'),
      { parsed_status: 'FAILED', matched_rule_id: null }
    );
  } finally {
    await closeServer(server);
    await db.close();
  }
});

test('retry endpoint returns 500 and rolls back when transaction insertion fails', async () => {
  const db = await openEndpointDatabase();
  const routeDb = {
    get: db.get.bind(db),
    all: db.all.bind(db),
    run: async (sql, params) => {
      if (/^INSERT INTO transactions/.test(sql)) {
        throw new Error('forced transaction insert failure');
      }
      return db.run(sql, params);
    }
  };
  const server = await startRetryServer(db, { routeDb });
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/notification_logs/7/retry`, { method: 'POST' });
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.match(body.error, /forced transaction insert failure/);
    assert.deepEqual(
      await db.get('SELECT merchant, amount FROM transactions WHERE raw_text = ?', ['sample notification']),
      { merchant: 'before', amount: 1000 }
    );
    assert.deepEqual(
      await db.get('SELECT parsed_status, matched_rule_id FROM notification_logs WHERE id = 7'),
      { parsed_status: 'FAILED', matched_rule_id: null }
    );
  } finally {
    await closeServer(server);
    await db.close();
  }
});

test('retry endpoint creates a validated automatic rule and reparses the notification', async () => {
  const db = await openEndpointDatabase();
  await db.run("INSERT INTO settings (key, value) VALUES ('auto_rule_generation', 'true')");
  let parseCount = 0;
  const server = await startRetryServer(db, {
    parseNotification: () => {
      parseCount += 1;
      return parseCount === 1 ? null : { ...successfulParseResult(), rule_id: null };
    },
    buildValidatedAutoRule: () => ({
      valid: true,
      pattern: '^generated-safe-pattern$',
      parsedResult: { merchant: 'Generated Store' }
    })
  });
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/notification_logs/7/retry`, { method: 'POST' });

    assert.equal(response.status, 200);
    assert.equal(parseCount, 2);
    const generatedRule = await db.get(
      "SELECT id, pattern, priority, enabled, source FROM rules WHERE source = 'AUTO'"
    );
    assert.deepEqual(
      { pattern: generatedRule.pattern, priority: generatedRule.priority, enabled: generatedRule.enabled, source: generatedRule.source },
      { pattern: '^generated-safe-pattern$', priority: 200, enabled: 1, source: 'AUTO' }
    );
    assert.deepEqual(
      await db.get('SELECT parsed_status, matched_rule_id FROM notification_logs WHERE id = 7'),
      { parsed_status: 'SUCCESS', matched_rule_id: generatedRule.id }
    );
    assert.deepEqual(
      await db.get('SELECT merchant, amount FROM transactions WHERE raw_text = ?', ['sample notification']),
      { merchant: 'After Store', amount: 2500 }
    );
  } finally {
    await closeServer(server);
    await db.close();
  }
});

test('retry endpoint removes an automatic rule that fails source reparse', async () => {
  const db = await openEndpointDatabase();
  await db.run("INSERT INTO settings (key, value) VALUES ('auto_rule_generation', 'true')");
  let parseCount = 0;
  const server = await startRetryServer(db, {
    parseNotification: () => {
      parseCount += 1;
      return null;
    },
    buildValidatedAutoRule: () => ({
      valid: true,
      pattern: '^generated-but-unusable$',
      parsedResult: { merchant: 'Unusable Store' }
    })
  });
  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/notification_logs/7/retry`, { method: 'POST' });

    assert.equal(response.status, 400);
    assert.equal(parseCount, 2);
    assert.equal(await db.get("SELECT id FROM rules WHERE source = 'AUTO'"), undefined);
    assert.deepEqual(
      await db.get('SELECT merchant, amount FROM transactions WHERE raw_text = ?', ['sample notification']),
      { merchant: 'before', amount: 1000 }
    );
    assert.deepEqual(
      await db.get('SELECT parsed_status, matched_rule_id FROM notification_logs WHERE id = 7'),
      { parsed_status: 'FAILED', matched_rule_id: null }
    );
  } finally {
    await closeServer(server);
    await db.close();
  }
});
