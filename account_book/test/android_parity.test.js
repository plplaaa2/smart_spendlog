// Exercise the actual offline WebView API with memory storage and no native/network writes.
// Related: android_spendlog/assets/standalone_api.js, parser_policy.js, NotificationPolicy.java.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const assets = path.resolve(__dirname, '../../android_spendlog/app/src/main/assets');
// The add-on repository excludes Android sources; retain these tests for local cross-platform checks.
// Related: root .gitignore, android_spendlog assets; add-on preview tests still run independently.
const androidTest = (name, run) => test(name, { skip: !fs.existsSync(path.join(assets, 'auto_rule_policy.js')) }, run);
function app(seed = {}) {
  const storage = new Map(Object.entries(seed).map(([key, value]) => ['standalone_' + key, JSON.stringify(value)]));
  const context = { window: { fetch: async () => { throw Error('unexpected network'); } }, localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) }, Response, URL, console, location: { href: 'https://local.test/' } };
  vm.createContext(context);
  for (const file of ['parser_policy.js', 'auto_rule_policy.js', 'bank_balance.js', 'standalone_api.js']) vm.runInContext(fs.readFileSync(path.join(assets, file), 'utf8'), context);
  return { request: async (url, payload) => { const response = await context.window.fetch('api/' + url, payload ? { method: 'POST', body: JSON.stringify(payload) } : {}); return { status: response.status, data: await response.json() }; }, storage, parser: context.window.SpendLogParser, context };
}
// Exercise generated forms and automatic rule registration through their actual bundled scripts.
// Related: rules.js, auto_rule_policy.js, NotificationPolicy.java.
androidTest('Android generated rules and UI resolve ATM cash and clear unresolved credit defaults', async () => {
  const local = app();
  const generated = local.context.window.SpendLogAutoRules.create('하나은행 출금 40,000원 알수없음 10/07 15:03', [], '', [], '2026-10-07 15:03:00');
  assert.ok(generated); assert.equal(generated.pay_type, 'CASH');
  const elements = {};
  for (const id of ['test-text', 'test-pattern', 'rule-pattern', 'rule-name', 'rule-pay-type', 'rule-pay-method', 'rule-type', 'rule-form-card']) elements[id] = { value: '', style: { display: 'block' }, options: [{ value: '하나은행' }, { value: '하나카드' }, { value: '_AUTO_MAPPING_' }] };
  local.context.document = { getElementById: id => elements[id] || null };
  local.context.alert = () => {};
  local.context.updateCategorySelect = () => {};
  vm.runInContext(fs.readFileSync(path.join(assets, 'rules.js'), 'utf8'), local.context);
  for (const [raw, expected] of [['하나은행 출금 40,000원 알수없음 10/07 15:03', 'CASH'], ['하나은행 출금 1,000원 테스트점 10/07 15:03', 'TRANSFER'], ['하나카드 신용 승인 1,000원 테스트점 10/07 15:03', 'CREDIT'], ['1,000원 테스트점', '']]) {
    elements['test-text'].value = raw;
    elements['rule-pay-method'].value = '_AUTO_MAPPING_'; elements['rule-pay-type'].value = 'CREDIT';
    await vm.runInContext('autoGeneratePattern(true)', local.context);
    assert.equal(elements['rule-pay-type'].value, expected);
  }
  const preview = await local.request('parse-test', { text: '출금 40,000원 알수없음', pattern: '출금 (?<amount>[\\d,]+)원 (?<merchant>.+)', pay_method: '하나은행', pay_type: 'CREDIT', type: 'EXPENSE' });
  assert.equal(preview.data.result.payment_type, 'CASH');
});
// Exercise user settings through the offline preview API and its resulting aggregation.
// Related: standalone_api.js, services/transaction_enrichment.js.
androidTest('Android own-transfer preview matches add-on exact-name policy', async () => {
  const local = app({ settings: { user_real_name: ' 테스트본명 ' } });
  const preview = async (merchant, provider, status = '출금') => (await local.request('parse-test', {
    text: `${status} 1000원 ${merchant}`, pattern: '(?<status>입금|출금) (?<amount>[\\d,]+)원 (?<merchant>.+)',
    pay_method: provider, pay_type: 'TRANSFER', type: status === '입금' ? 'INCOME' : 'EXPENSE', category: '기타'
  })).data;
  const ownExpense = await preview('테스트본명', '하나은행');
  const ownIncome = await preview('테스트본명', '하나은행', '입금');
  assert.equal(ownExpense.result.category, '이체/송금');
  assert.equal(ownIncome.result.category, '이체/입금');
  const otherExpense = (await preview('다른사람', '하나은행')).result;
  const otherIncome = (await preview('다른사람', '하나은행', '입금')).result;
  const statsApp = app({ transactions: [ownExpense.result, ownIncome.result, otherExpense, otherIncome].map((row, index) => ({ ...row, id: index + 1, datetime: '2026-10-07 12:00:00' })) });
  const stats = (await statsApp.request('stats?month=2026-10')).data;
  assert.equal(stats.totalIncome, 1000);
  assert.equal(stats.totalExpense, 1000);
  assert.notEqual((await preview('다른사람', '하나은행')).result.category, '이체/송금');
  assert.notEqual((await preview('테스트본명님', '하나은행')).result.category, '이체/송금');
  assert.notEqual((await preview('테스트본명', '하나카드')).result.category, '이체/송금');
  local.storage.set('standalone_settings', JSON.stringify({ user_real_name: '' }));
  assert.notEqual((await preview('테스트본명', '하나은행')).result.category, '이체/송금');
});
androidTest('Android bank aliases share the latest account balance without rewriting storage', async () => {
  const transactions = [
    { id: 1, datetime: '2026-05-24 11:05:00', pay_method: 'KB국민은행', type: 'EXPENSE', amount: 100, memo: '계좌: TEST 잔액: 1000' },
    { id: 2, datetime: '2026-10-05 21:19:00', pay_method: '국민은행', type: 'INCOME', amount: 500, memo: '계좌: TEST 잔액: 1500' }
  ];
  const local = app({ transactions, pay_methods: [{ name: 'KB국민은행' }, { name: '국민은행' }], settings: { initial_balances: { 국민은행: 900 } } });
  const stats = (await local.request('stats?month=2026-10')).data;
  assert.equal(stats.assets.length, 1);
  assert.equal(stats.assets[0].currentBalance, 1500);
  assert.equal(stats.assets[0].monthIncome, 500);
  assert.deepEqual(JSON.parse(local.storage.get('standalone_transactions')), transactions);
});
androidTest('Android preview uses captures, app provider, direction and points', async () => {
  const local = app({ package_pay_methods: [{ package: 'bank.app', pay_method: '하나은행' }] });
  const result = await local.request('parse-test', { text: '입금 108원 하나체크환급 50점', pattern: '(?<type_text>입금) (?<amount>\\d+)원 (?<merchant>\\S+) (?<used_point>\\d+)점', pay_method: '_AUTO_MAPPING_', pay_type: 'TRANSFER', package: 'bank.app' });
  assert.equal(result.data.result.type, 'INCOME');
  assert.equal(result.data.result.amount, 108);
  assert.equal(result.data.result.merchant, '하나체크환급');
  assert.equal(result.data.result.pay_method, '하나은행');
  assert.equal(result.data.result.used_point, 50);
});
androidTest('Android retry follows a matching rule and refuses duplicate transactions', async () => {
  const local = app({ rules: [{ id: 2, pattern: '출금 (?<amount>[\\d,]+)원 (?<merchant>.+)', pay_method: '하나은행', pay_type: 'TRANSFER', category: '기타' }], notification_logs: [{ id: 10, raw_text: '출금 1,000원 알수없음', sender: 'bank.app', created_at: '2026-10-04 12:00:00' }] });
  const first = await local.request('notification_logs/10/retry', {});
  assert.equal(first.data.transaction.amount, 1000);
  assert.equal(first.data.transaction.category, 'ATM/출금');
  assert.equal(first.data.transaction.merchant, '알수없음');
  assert.equal((await local.request('notification_logs/10/retry', {})).status, 409);
});
androidTest('Android consumption excludes only transfer repayments from banks', async () => {
  const rows = [
    ['카드상환', 'TRANSFER', '하나은행'], ['카드상환', 'CHECK', '하나은행'],
    ['카드상환', 'TRANSFER', 'NH농협카드'], ['생활/잡화', 'TRANSFER', '하나은행']
  ].map(([category, pay_type, pay_method], id) => ({ id, category, pay_type, pay_method, type: 'EXPENSE', amount: 1000, datetime: '2026-10-04 12:00:00' }));
  const local = app({ transactions: rows });
  const stats = await local.request('stats?month=2026-10');
  assert.equal(stats.data.totalExpense, 3000);
});
androidTest('Android wallets require a funding provider and preserve old transaction labels', async () => {
  const local = app();
  const payment = { merchant: '테스트', pay_method: '토스페이머니', amount: 1000, type: 'EXPENSE' };
  assert.equal((await local.request('transactions', payment)).status, 400);
  const updated = await local.request('transactions', { ...payment, id: 5 });
  assert.equal(updated.data.transaction.pay_method, '토스페이머니');
  assert.equal((await local.request('rules', { pattern: '(' })).status, 400);
});
androidTest('Android generated patterns share balance exclusion and currency spacing', () => {
  const { parser } = app();
  const raw = '하나은행 잔액 100,000원 출금 1,000 원 테스트점';
  const pattern = parser.generatePatternFromText(raw);
  assert.equal(new RegExp(pattern, 's').exec(raw).groups.amount, '1,000');
});

androidTest('Android unmatched retry generates and persists a reusable rule only when enabled', async () => {
  const raw = '[하나카드] 체크 승인 1,000원 테스트점 10/04 12:00';
  const seed = { rules: [], settings: { auto_rule_generation: true }, notification_logs: [{ id: 11, sender: 'card.app', raw_text: raw, created_at: '2026-10-04 12:00:00' }] };
  const local = app(seed);
  const response = await local.request('notification_logs/11/retry', {});
  assert.equal(response.status, 200);
  assert.equal(response.data.transaction.amount, 1000);
  const rules = JSON.parse(local.storage.get('standalone_rules'));
  assert.equal(rules.length, 1);
  assert.equal(rules[0].source, 'AUTO');
  assert.equal(local.parser.parseNotification(raw.replace('1,000원', '2,000원'), rules).amount, 2000);
  assert.equal((await local.request('notification_logs/11/retry', {})).status, 409);
  assert.equal(JSON.parse(local.storage.get('standalone_rules')).length, 1);
  const disabled = app({ ...seed, settings: { auto_rule_generation: false } });
  assert.equal((await disabled.request('notification_logs/11/retry', {})).status, 422);
});

androidTest('Android automatic rule generation rejects balance notices and unresolved providers', () => {
  const local = app();
  const generate = raw => local.context.window.SpendLogAutoRules.create(raw, [], 'bank.app', [], '2026-10-04 12:00:00');
  assert.equal(generate('하나은행 잔액 100,000원'), null);
  assert.equal(generate('체크 승인 1,000원 테스트점'), null);
  assert.equal(generate('[토스페이머니] 체크 승인 1,000원 테스트점'), null);
  const rule = generate('[하나카드] 잔액 100,000원 체크 승인 1,000 원 테스트점 10/04 12:00');
  assert.ok(rule);
  assert.equal(local.parser.parseNotification('[하나카드] 잔액 100,000원 체크 승인 1,000 원 테스트점 10/04 12:00', [rule]).amount, 1000);
});

androidTest('Android backup separates product metadata and restores legacy data envelopes', () => {
  const local = app();
  const backup = local.context.window.StandaloneApi.exportBackup();
  assert.equal(backup.version, '1.0');
  assert.equal(backup.backup_schema_version, 1);
  assert.equal(backup.platform, 'android');
  const legacy = JSON.parse(JSON.stringify(backup));
  legacy.version = '1.9.19'; delete legacy.backup_schema_version; delete legacy.platform;
  assert.equal(local.context.window.StandaloneApi.importBackup(legacy), true);
});

androidTest('Android local reports select exact single-digit months and the full year', async () => {
  const transactions = ['2026-01-04', '2026-10-04', '2026-11-04', '2025-01-04'].map((day, index) => ({ id: index, datetime: day + ' 12:00:00', type: 'EXPENSE', amount: 1000, category: '기타' }));
  const local = app({ transactions });
  const january = await local.request('analytics/ai-report?year=2026&month=1');
  assert.match(january.data.report.summary, /지출 1,000원/);
  assert.ok(january.data.report.content.includes('\n\n'));
  const annual = await local.request('analytics/ai-report/generate', { year: 2026, month: 'all' });
  assert.match(annual.data.report.summary, /2026년 연간 지출 3,000원/);
});

androidTest('Android fetch routing retains offline data APIs and forwards permission requests only', async () => {
  const local = app();
  const forwarded = [];
  local.context.window.AndroidBridge = { callApi: async url => { forwarded.push(url); return JSON.stringify({ status: 200, body: { granted: true } }); } };
  vm.runInContext(fs.readFileSync(path.join(assets, 'auth.js'), 'utf8'), local.context);
  assert.equal((await local.request('stats?month=2026-10')).status, 200);
  assert.equal(forwarded.length, 0);
  assert.equal((await local.request('permissions/notification')).data.granted, true);
  assert.deepEqual(forwarded, ['api/permissions/notification']);
});

test('add-on preview applies app mapping before check-card bank conversion', async () => {
  const file = path.resolve(__dirname, '../routes/rules.js');
  const realRequire = createRequire(file);
  const routes = new Map();
  const router = { get() {}, delete() {}, put() {}, post: (path, callback) => routes.set(path, callback) };
  const db = { get: async () => ({ pay_method: '하나카드' }) };
  const context = { module: { exports: {} }, console, require: name => name === 'express' ? { Router: () => router } : name === '../database' ? { getDB: async () => db, findCategoryByMerchant: async () => '생활/잡화' } : name === '../crypto_helper' ? {} : realRequire(name) };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), context);
  let response;
  await routes.get('/parse-test')({ username: 'admin', body: { text: '결제 1,000원 테스트점', pattern: '결제 (?<amount>[\\d,]+)원 (?<merchant>.+)', pay_method: '신한카드', pay_type: 'CHECK', category: '기타', package: 'card.app' } }, { json: result => { response = result; }, status() { return this; } });
  assert.equal(response.result.pay_method, '하나은행');
  assert.equal(response.result.category, '생활/잡화');
});
