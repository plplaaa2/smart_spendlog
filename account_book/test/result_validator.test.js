// Contract tests for parser results accepted by transaction storage.
// Related file: parser/result_validator.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateParsingResult } = require('../parser/result_validator');

function validResult(overrides = {}) {
  return {
    amount: 10000,
    merchant: '테스트상점',
    datetime: '2026-08-09 12:30:00',
    pay_method: '테스트카드',
    payment_type: 'CREDIT',
    type: 'EXPENSE',
    used_point: 0,
    original_amount: null,
    currency: null,
    ...overrides
  };
}

test('accepts and normalizes a valid parser result', () => {
  const validation = validateParsingResult(validResult({ merchant: ' 테스트상점 ', pay_method: ' 테스트카드 ' }));

  assert.equal(validation.valid, true);
  assert.equal(validation.value.merchant, '테스트상점');
  assert.equal(validation.value.pay_method, '테스트카드');
});

test('rejects invalid required transaction fields', () => {
  for (const overrides of [
    { amount: 0 },
    { merchant: '' },
    { datetime: '2026-02-30 12:30:00' },
    { payment_type: 'UNKNOWN' },
    { type: 'OTHER' },
    { used_point: -1 }
  ]) {
    assert.equal(validateParsingResult(validResult(overrides)).valid, false);
  }
});

test('requires consistent supported foreign currency fields', () => {
  assert.equal(validateParsingResult(validResult({ currency: 'USD', original_amount: 12.5 })).valid, true);
  assert.equal(validateParsingResult(validResult({ currency: 'USD', original_amount: null })).valid, false);
  assert.equal(validateParsingResult(validResult({ currency: 'KRW', original_amount: 10000 })).valid, false);
});
