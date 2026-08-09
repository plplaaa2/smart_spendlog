// HTTP and SQLite integration tests for the initial notification Webhook flow.
// Related files: routes/webhook.js, parser.js, and database/auto_rule_cleanup.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function openWebhookDatabase() {
  const db = await open({ filename: ':memory:', driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE pass_rules (id INTEGER PRIMARY KEY, name TEXT, pattern TEXT);
    CREATE TABLE rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE, pattern TEXT, category TEXT, pay_method TEXT,
      pay_type TEXT DEFAULT 'CREDIT', merchant_template TEXT, type TEXT,
      priority INTEGER DEFAULT 100, enabled INTEGER DEFAULT 1, source TEXT DEFAULT 'USER'
    );
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE package_pay_methods (package TEXT, pay_method TEXT);
    CREATE TABLE transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT, amount INTEGER, merchant TEXT, category TEXT, pay_method TEXT,
      pay_type TEXT, datetime TEXT, memo TEXT, raw_text TEXT, used_point INTEGER DEFAULT 0,
      original_amount REAL, currency TEXT, exchange_rate REAL
    );
    CREATE TABLE notification_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sender TEXT, raw_text TEXT, title TEXT, text TEXT,
      parsed_status TEXT, matched_rule_id INTEGER
    );
  `);
  await db.run("INSERT INTO rules (id, name, pattern, priority) VALUES (3, 'webhook rule', '^sample$', 10)");
  return db;
}

function parsedTransaction() {
  return {
    rule_id: 3,
    type: 'EXPENSE',
    amount: 2500,
    merchant: 'Webhook Store',
    category: 'Dining',
    pay_method: 'Test Card',
    payment_type: 'CREDIT',
    datetime: '2026-08-09 12:00:00',
    memo: 'webhook test',
    used_point: 300
  };
}

async function startWebhookServer(db, options = {}) {
  const routeDb = options.routeDb || db;
  const databasePath = require.resolve('../database');
  const parserPath = require.resolve('../parser');
  const webhookPath = require.resolve('../routes/webhook');
  const previousDatabase = require.cache[databasePath];
  const previousParser = require.cache[parserPath];
  const parseNotification = options.parseNotification || (() => parsedTransaction());

  require.cache[databasePath] = {
    id: databasePath,
    filename: databasePath,
    loaded: true,
    exports: {
      getDB: async () => routeDb,
      findCategoryByMerchant: async () => 'Dining',
      updateHASensors: () => {},
      sendHANotification: () => {},
      createInAppNotification: async () => {}
    }
  };
  require.cache[parserPath] = {
    id: parserPath,
    filename: parserPath,
    loaded: true,
    exports: {
      parseNotification,
      parseNotificationWithAI: async () => null,
      generatePatternWithAI: async () => null,
      sanitizePattern: pattern => pattern,
      validateGeneratedPattern: pattern => ({ valid: true, pattern, errors: [] }),
      buildValidatedAutoRule: options.buildValidatedAutoRule || (() => ({ valid: false, errors: ['disabled in test'] }))
    }
  };

  let router;
  try {
    delete require.cache[webhookPath];
    router = require('../routes/webhook').router;
  } finally {
    if (previousDatabase) require.cache[databasePath] = previousDatabase;
    else delete require.cache[databasePath];
    if (previousParser) require.cache[parserPath] = previousParser;
    else delete require.cache[parserPath];
  }

  const app = express();
  app.locals.config = options.config || {};
  app.use('/api', router);
  const server = await new Promise((resolve, reject) => {
    const listeningServer = app.listen(0, '127.0.0.1', () => resolve(listeningServer));
    listeningServer.on('error', reject);
  });
  return server;
}

function closeServer(server) {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function postWebhook(server, body, headers = {}) {
  const { port } = server.address();
  return fetch(`http://127.0.0.1:${port}/api/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body)
  });
}

test('webhook stores a parsed transaction and success log', async () => {
  const db = await openWebhookDatabase();
  const server = await startWebhookServer(db);
  try {
    const response = await postWebhook(server, { title: 'Card', text: '2,500 won payment', package: 'test.package' });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.transaction.merchant, 'Webhook Store');
    assert.deepEqual(
      await db.get('SELECT amount, merchant, category, pay_method, pay_type, used_point FROM transactions'),
      { amount: 2500, merchant: 'Webhook Store', category: 'Dining', pay_method: 'Test Card', pay_type: 'CREDIT', used_point: 300 }
    );
    assert.deepEqual(
      await db.get('SELECT parsed_status, matched_rule_id FROM notification_logs'),
      { parsed_status: 'SUCCESS', matched_rule_id: 3 }
    );
  } finally {
    await closeServer(server);
    await db.close();
  }
});

test('webhook records a failed notification without creating a transaction', async () => {
  const db = await openWebhookDatabase();
  const server = await startWebhookServer(db, { parseNotification: () => null });
  try {
    const response = await postWebhook(server, { text: '10,000원 미분류 결제' });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, false);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM transactions')).count, 0);
    assert.deepEqual(await db.get('SELECT parsed_status, matched_rule_id FROM notification_logs'),
      { parsed_status: 'FAILED', matched_rule_id: null });
  } finally {
    await closeServer(server);
    await db.close();
  }
});

test('webhook marks a matching transaction as duplicate without inserting it again', async () => {
  const db = await openWebhookDatabase();
  await db.run(`
    INSERT INTO transactions
      (type, amount, merchant, category, pay_method, pay_type, datetime, raw_text)
    VALUES
      ('EXPENSE', 2500, 'Webhook Store', 'Dining', 'Test Card', 'CREDIT', '2026-08-09 12:00:00', 'previous')
  `);
  const server = await startWebhookServer(db);
  try {
    const response = await postWebhook(server, { text: '2,500원 Webhook Store' });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.match(body.message, /중복/);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM transactions')).count, 1);
    assert.deepEqual(await db.get('SELECT parsed_status, matched_rule_id FROM notification_logs'),
      { parsed_status: 'IGNORED_DUPLICATE', matched_rule_id: 3 });
  } finally {
    await closeServer(server);
    await db.close();
  }
});

test('webhook removes an AUTO rule when generated-rule reparse fails', async () => {
  const db = await openWebhookDatabase();
  await db.run("INSERT INTO settings (key, value) VALUES ('auto_rule_generation', 'true')");
  let parseCount = 0;
  const server = await startWebhookServer(db, {
    parseNotification: () => {
      parseCount += 1;
      return null;
    },
    buildValidatedAutoRule: () => ({
      valid: true,
      pattern: '^generated-but-unusable$',
      parsedResult: { merchant: 'Unusable Webhook Store' }
    })
  });
  try {
    const response = await postWebhook(server, { text: '10,000원 자동 규칙 실패' });

    assert.equal(response.status, 200);
    assert.equal(parseCount, 2);
    assert.equal(await db.get("SELECT id FROM rules WHERE source = 'AUTO'"), undefined);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM transactions')).count, 0);
    assert.deepEqual(await db.get('SELECT parsed_status, matched_rule_id FROM notification_logs'),
      { parsed_status: 'FAILED', matched_rule_id: null });
  } finally {
    await closeServer(server);
    await db.close();
  }
});

test('webhook keeps a validated AUTO rule when generated-rule reparse succeeds', async () => {
  const db = await openWebhookDatabase();
  await db.run("INSERT INTO settings (key, value) VALUES ('auto_rule_generation', 'true')");
  let parseCount = 0;
  const server = await startWebhookServer(db, {
    parseNotification: () => {
      parseCount += 1;
      return parseCount === 1 ? null : { ...parsedTransaction(), rule_id: null };
    },
    buildValidatedAutoRule: () => ({
      valid: true,
      pattern: '^generated-safe-webhook$',
      parsedResult: { merchant: 'Generated Webhook Store' }
    })
  });
  try {
    const response = await postWebhook(server, { text: '2,500원 자동 규칙 성공' });

    assert.equal(response.status, 200);
    assert.equal(parseCount, 2);
    const generatedRule = await db.get("SELECT id, pattern, priority, enabled, source FROM rules WHERE source = 'AUTO'");
    assert.deepEqual(
      { pattern: generatedRule.pattern, priority: generatedRule.priority, enabled: generatedRule.enabled, source: generatedRule.source },
      { pattern: '^generated-safe-webhook$', priority: 200, enabled: 1, source: 'AUTO' }
    );
    assert.deepEqual(await db.get('SELECT parsed_status, matched_rule_id FROM notification_logs'),
      { parsed_status: 'SUCCESS', matched_rule_id: generatedRule.id });
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM transactions')).count, 1);
  } finally {
    await closeServer(server);
    await db.close();
  }
});

test('webhook returns 500 when transaction storage fails', async () => {
  const db = await openWebhookDatabase();
  const routeDb = {
    get: db.get.bind(db),
    all: db.all.bind(db),
    run: async (sql, params) => {
      if (/^INSERT INTO transactions/.test(sql)) {
        throw new Error('forced webhook transaction failure');
      }
      return db.run(sql, params);
    }
  };
  const server = await startWebhookServer(db, { routeDb });
  try {
    const response = await postWebhook(server, { text: '2,500원 DB 저장 실패' });
    const body = await response.json();

    assert.equal(response.status, 500);
    assert.match(body.error, /forced webhook transaction failure/);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM transactions')).count, 0);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM notification_logs')).count, 0);
  } finally {
    await closeServer(server);
    await db.close();
  }
});

test('webhook queue serializes concurrent duplicate notifications', async () => {
  const db = await openWebhookDatabase();
  const routeDb = {
    get: db.get.bind(db),
    all: db.all.bind(db),
    run: async (sql, params) => {
      if (/^INSERT INTO transactions/.test(sql)) {
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      return db.run(sql, params);
    }
  };
  const server = await startWebhookServer(db, { routeDb });
  try {
    const requestBody = { text: '2,500원 Webhook Store 동시 알림' };
    const responses = await Promise.all([
      postWebhook(server, requestBody),
      postWebhook(server, requestBody)
    ]);
    const bodies = await Promise.all(responses.map(response => response.json()));

    assert.deepEqual(responses.map(response => response.status), [200, 200]);
    assert.equal(bodies.filter(body => body.transaction).length, 1);
    assert.equal(bodies.filter(body => body.message && body.message.includes('중복')).length, 1);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM transactions')).count, 1);
    assert.deepEqual(
      await db.all('SELECT parsed_status FROM notification_logs ORDER BY id ASC'),
      [{ parsed_status: 'SUCCESS' }, { parsed_status: 'IGNORED_DUPLICATE' }]
    );
  } finally {
    await closeServer(server);
    await db.close();
  }
});

test('webhook enforces the configured token', async () => {
  const db = await openWebhookDatabase();
  const server = await startWebhookServer(db, { config: { webhook_token: 'test-webhook-secret' } });
  try {
    const missing = await postWebhook(server, { text: '2,500원 토큰 없음' });
    const invalid = await postWebhook(server, { text: '2,500원 토큰 오류' }, { authorization: 'wrong-test-token' });
    const valid = await postWebhook(server, { text: '2,500원 토큰 정상' }, { authorization: 'test-webhook-secret' });

    assert.equal(missing.status, 403);
    assert.equal(invalid.status, 403);
    assert.equal(valid.status, 200);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM transactions')).count, 1);
  } finally {
    await closeServer(server);
    await db.close();
  }
});

test('webhook rejects a replayed event ID without processing it twice', async () => {
  const db = await openWebhookDatabase();
  const server = await startWebhookServer(db);
  try {
    const headers = { 'x-webhook-event-id': 'test-event-20260809-001' };
    const first = await postWebhook(server, { text: '2,500원 Webhook Store 반복 알림' }, headers);
    const replay = await postWebhook(server, { text: '2,500원 Webhook Store 반복 알림' }, headers);

    assert.equal(first.status, 200);
    assert.equal(replay.status, 409);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM transactions')).count, 1);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM notification_logs')).count, 1);
  } finally {
    await closeServer(server);
    await db.close();
  }
});

test('webhook releases an event ID after a 500 response so it can be retried', async () => {
  const db = await openWebhookDatabase();
  let failOnce = true;
  const routeDb = {
    get: db.get.bind(db),
    all: db.all.bind(db),
    run: async (sql, params) => {
      if (failOnce && /^INSERT INTO transactions/.test(sql)) {
        failOnce = false;
        throw new Error('transient webhook failure');
      }
      return db.run(sql, params);
    }
  };
  const server = await startWebhookServer(db, { routeDb });
  try {
    const headers = { 'x-webhook-event-id': 'test-event-retry-001' };
    const failed = await postWebhook(server, { text: '2,500원 재시도 가능' }, headers);
    const retried = await postWebhook(server, { text: '2,500원 재시도 가능' }, headers);

    assert.equal(failed.status, 500);
    assert.equal(retried.status, 200);
    assert.equal((await db.get('SELECT COUNT(*) AS count FROM transactions')).count, 1);
  } finally {
    await closeServer(server);
    await db.close();
  }
});
