// Regression tests for named capture group compatibility in notification rules.
// Related files: parser/text_parser.js and parser/utils.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseNotification } = require('../parser/text_parser');

function createRule(pattern) {
  return {
    id: 1,
    name: '포인트 캡처 테스트',
    pattern,
    type: 'EXPENSE',
    category: '기타',
    pay_method: '카드'
  };
}

test('reads a generated usedPoint capture group', () => {
  const rule = createRule('^(?<amount>[\\d,]+)원 (?<merchant>.+?) 지원차감=(?<usedPoint>[\\d,]+)$');
  const result = parseNotification('10,000원 테스트상점 지원차감=500', [rule], '2026-08-09 12:00:00');

  assert.ok(result);
  assert.equal(result.used_point, 500);
});

test('reads a legacy used_point capture group after sanitization', () => {
  const rule = createRule('^(?<amount>[\\d,]+)원 (?<merchant>.+?) 지원차감=(?<used_point>[\\d,]+)$');
  const result = parseNotification('10,000원 테스트상점 지원차감=1,500', [rule], '2026-08-09 12:00:00');

  assert.ok(result);
  assert.equal(result.used_point, 1500);
});

test('returns the first valid rule when multiple rules match', () => {
  const firstRule = {
    ...createRule('^(?<amount>[\\d,]+)원 (?<merchant>.+)$'),
    id: 10,
    name: '먼저 생성된 규칙',
    category: '우선 카테고리'
  };
  const secondRule = {
    ...firstRule,
    id: 20,
    name: '나중에 생성된 규칙',
    category: '후순위 카테고리'
  };

  const result = parseNotification('10,000원 테스트상점', [firstRule, secondRule], '2026-08-09 12:00:00');

  assert.ok(result);
  assert.equal(result.rule_id, 10);
  assert.equal(result.category, '우선 카테고리');
});
