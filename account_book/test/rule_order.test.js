// Rule ordering contract for payment-method-first parsing.
const test = require('node:test');
const assert = require('node:assert/strict');
const { orderRules, ruleSpecificity } = require('../database/rule_order');
test('orders payment method before provider and broad rules', () => {
  const rules = [
    { id: 5, name: '자동 출금', pattern: '출금 (?<amount>[0-9]+)원 (?<merchant>.+)', pay_method: '하나은행', pay_type: 'CREDIT' },
    { id: 4, name: '가맹점 카드', pattern: '(?<amount>[0-9]+)원 (?<merchant>스타벅스)', pay_method: '카드', pay_type: 'CREDIT' },
    { id: 3, name: '체크 승인', pattern: '(?<amount>[0-9]+)원 체크 (?<merchant>.+)', pay_method: '카드', pay_type: 'CHECK' },
    { id: 2, name: '자동 생성', pattern: '(?<amount>[0-9]+)원 (?<merchant>.+)', pay_method: '_AUTO_MAPPING_', pay_type: 'CREDIT' },
    { id: 1, name: '은행 출금', pattern: '출금 (?<amount>[0-9]+)원 (?<merchant>.+)', pay_method: '계좌이체', pay_type: 'CREDIT' }
  ];
  assert.deepEqual(orderRules(rules).map(rule => rule.id), [3, 5, 1, 2, 4]);
  assert.ok(ruleSpecificity(rules[2]) < ruleSpecificity(rules[0]));
});
