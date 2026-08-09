// Contract tests for shared Webhook and retry transaction enrichment.
// Related files: services/transaction_enrichment.js, routes/webhook.js, and routes/rules.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { enrichParsedTransaction } = require('../services/transaction_enrichment');

function fakeDb({ mappedPayMethod = null, realName = '' } = {}) {
  return {
    get: async (sql) => {
      if (sql.includes('package_pay_methods')) return mappedPayMethod ? { pay_method: mappedPayMethod } : undefined;
      if (sql.includes('user_real_name')) return realName ? { value: realName } : undefined;
      return undefined;
    }
  };
}

const noCategory = async () => null;

test('applies package mapping and Webhook check-card conversion', async () => {
  const result = await enrichParsedTransaction({
    db: fakeDb({ mappedPayMethod: '신한카드' }),
    result: { type: 'EXPENSE', merchant: '상점', category: '식비', pay_method: '기존카드' },
    sender: 'card.package', rawText: '체크 승인', mode: 'webhook', findCategoryByMerchant: noCategory
  });
  assert.deepEqual(result, { finalPayMethod: '신한은행', finalCategory: '식비' });
});

test('preserves retry merchant mapping and pay-charge fallback policy', async () => {
  const mapped = await enrichParsedTransaction({
    db: fakeDb(),
    result: { type: 'EXPENSE', merchant: '매핑상점', category: '규칙카테고리', pay_method: '카드' },
    sender: 'Unknown', rawText: '', mode: 'retry', findCategoryByMerchant: async () => '학습카테고리'
  });
  const fallback = await enrichParsedTransaction({
    db: fakeDb(),
    result: { type: 'EXPENSE', merchant: '네이버페이 충전', category: null, pay_method: '카드' },
    sender: '', rawText: '', mode: 'retry', findCategoryByMerchant: noCategory
  });
  assert.equal(mapped.finalCategory, '학습카테고리');
  assert.equal(fallback.finalCategory, '페이류');
});

test('classifies a user-name bank transfer consistently', async () => {
  for (const mode of ['webhook', 'retry']) {
    const result = await enrichParsedTransaction({
      db: fakeDb({ realName: '홍길동' }),
      result: { type: 'EXPENSE', merchant: '홍길동', category: '기타', pay_method: '국민은행' },
      sender: '', rawText: '', mode, findCategoryByMerchant: noCategory
    });
    assert.equal(result.finalCategory, '이체/송금');
  }
});
