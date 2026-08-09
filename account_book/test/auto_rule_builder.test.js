// Integration tests for safe local automatic rule generation.
// Related file: parser/auto_rule_builder.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildValidatedAutoRule } = require('../parser/auto_rule_builder');

test('builds a safe rule that reparses its source notification', () => {
  const result = buildValidatedAutoRule('10,000원 테스트상점', 'EXPENSE', '2026-08-09 12:00:00');

  assert.equal(result.valid, true);
  assert.match(result.pattern, /^\^/);
  assert.match(result.pattern, /\$$/);
  assert.equal(result.parsedResult.amount, 10000);
  assert.equal(result.parsedResult.merchant, '테스트상점');
});

test('rejects text that cannot produce a complete transaction rule', () => {
  const result = buildValidatedAutoRule('거래 정보가 없는 일반 알림', 'EXPENSE', '2026-08-09 12:00:00');

  assert.equal(result.valid, false);
  assert.equal(result.parsedResult, null);
});
