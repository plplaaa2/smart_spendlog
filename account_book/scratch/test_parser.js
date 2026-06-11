const textParser = require('../parser/text_parser');

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

// 1. parseFlexibleDatetime Tests
test('parseFlexibleDatetime - YYYYMMDD parsing', () => {
  const result = textParser.parseFlexibleDatetime('20260611', 2026);
  const expected = '2026-06-11 00:00:00';
  if (result !== expected) {
    throw new Error(`Expected "${expected}", but got "${result}"`);
  }
});

test('parseFlexibleDatetime - MMDDHHmm parsing', () => {
  const result = textParser.parseFlexibleDatetime('06111423', 2026);
  const expected = '2026-06-11 14:23:00';
  if (result !== expected) {
    throw new Error(`Expected "${expected}", but got "${result}"`);
  }
});

test('parseFlexibleDatetime - 14-digit YYYYMMDDHHmmss parsing', () => {
  const result = textParser.parseFlexibleDatetime('20260611142345', 2026);
  const expected = '2026-06-11 14:23:45';
  if (result !== expected) {
    throw new Error(`Expected "${expected}", but got "${result}"`);
  }
});

// 2. generatePatternFromText (Merchant matching) Tests
test('generatePatternFromText - basic merchant next to amount', () => {
  const text = '[Web발신] 우리체크 승인 10,000원 스타벅스 06/11 14:23';
  const pattern = textParser.generatePatternFromText(text);
  
  // Let's parse with this generated pattern
  const rules = [{ name: 'Test Rule', pattern, category: '기타' }];
  const parsed = textParser.parseNotification(text, rules);
  if (!parsed || parsed.merchant !== '스타벅스') {
    throw new Error(`Expected merchant "스타벅스", but got "${parsed ? parsed.merchant : null}"\nPattern: ${pattern}`);
  }
});

test('generatePatternFromText - avoid matching long notices as merchant', () => {
  const text = '[Web발신] 우리체크 승인 고객명 김태식 10,000원 이용해주셔서대단히감사합니다 06/11 14:23 스타벅스';
  const pattern = textParser.generatePatternFromText(text);
  
  const rules = [{ name: 'Test Rule', pattern, category: '기타' }];
  const parsed = textParser.parseNotification(text, rules);
  // '스타벅스' should be selected over '이용해주셔서대단히감사합니다' or '김태식'
  if (!parsed || parsed.merchant !== '스타벅스') {
    throw new Error(`Expected merchant "스타벅스", but got "${parsed ? parsed.merchant : null}"\nPattern: ${pattern}`);
  }
});

test('generatePatternFromText - system keyword penalty test', () => {
  const text = '[Web발신] 신한카드 타행이체안내 50,000원 스타벅스 06/11 14:23';
  const pattern = textParser.generatePatternFromText(text);
  
  const rules = [{ name: 'Test Rule', pattern, category: '기타' }];
  const parsed = textParser.parseNotification(text, rules);
  // '스타벅스' should be selected over '타행이체안내'
  if (!parsed || parsed.merchant !== '스타벅스') {
    throw new Error(`Expected merchant "스타벅스", but got "${parsed ? parsed.merchant : null}"\nPattern: ${pattern}`);
  }
});

test('generatePatternFromText - franchise preset prioritization test', () => {
  // '김태식' is next to amount and status, but '스타벅스' is a franchise preset keyword
  const text = '[Web발신] 우리체크 승인 김태식 10,000원 06/11 14:23 스타벅스';
  const pattern = textParser.generatePatternFromText(text);
  
  const rules = [{ name: 'Test Rule', pattern, category: '기타' }];
  const parsed = textParser.parseNotification(text, rules);
  if (!parsed || parsed.merchant !== '스타벅스') {
    throw new Error(`Expected merchant "스타벅스", but got "${parsed ? parsed.merchant : null}"\nPattern: ${pattern}`);
  }
});

// 3. supportsDFlag / Fallback check
test('supportsDFlag - fallback amount check if no indices/no d flag', () => {
  // We mock a rule and text
  const text = '[Web발신] 우리체크 승인 10,000원 스타벅스 06/11 14:23';
  const rule = {
    name: 'Mock Rule',
    pattern: '\\[Web발신\\] (?<pay_method>[가-힣]+) 승인 (?<amount>[\\d,]+)원 (?<merchant>[가-힣]+)',
    category: '기타'
  };
  
  // Since rules use RegExp(rule.pattern, 'ds'), we want to test if isDateTime filtering works.
  // Wait, if amount is inside date/time, it is skipped.
  // Let's create a text where the amount pattern matches something inside a date pattern
  const textWithAmountInDate = '[Web발신] 우리체크 승인 2026/06/11 14:23 스타벅스';
  // Here, we have '2026' which could match an amount pattern (?<amount>\d{4})
  const ruleWithFakeAmount = {
    name: 'Fake Amount Rule',
    pattern: '승인 (?<amount>\\d{4})/\\d{2}/\\d{2}',
    category: '기타'
  };
  
  const parsed = textParser.parseNotification(textWithAmountInDate, [ruleWithFakeAmount]);
  // It should be rejected (returned null) because the amount (2026) is part of a date/time block
  if (parsed !== null) {
    throw new Error(`Expected parsed to be null (rejected due to isDateTime), but got: ${JSON.stringify(parsed)}`);
  }
});

// 4. addKoreanBrandName Tests
test('addKoreanBrandName - translate English brand to include Korean name', () => {
  const testCases = [
    { input: 'STARBUCKS COFFEE', expected: 'STARBUCKS(스타벅스) COFFEE' },
    { input: 'McDonalds', expected: 'McDonalds(맥도날드)' },
    { input: 'VIPS 신촌점', expected: 'VIPS(빕스) 신촌점' },
    { input: 'COUPANG 주식회사', expected: 'COUPANG(쿠팡) 주식회사' },
    { input: '스타벅스 강남점', expected: '스타벅스 강남점' } // No translation since it already has Korean brand name
  ];
  
  for (const { input, expected } of testCases) {
    const result = textParser.addKoreanBrandName(input);
    if (result !== expected) {
      throw new Error(`For input "${input}", expected "${expected}", but got "${result}"`);
    }
  }
});

// 5. determineTransactionType / parseNotification Status Tests
test('determineTransactionType - Unified transaction type detection', () => {
  const textIncome1 = '[Web발신] 우리은행 10,000원 입금 06/11 14:23';
  const textExpense1 = '[Web발신] 우리체크 승인 10,000원 스타벅스 06/11 14:23';
  const textCancel1 = '[Web발신] 우리체크 취소 10,000원 스타벅스 06/11 14:23';
  const textDepositCancel = '[Web발신] 우리은행 입금취소 10,000원 06/11 14:23';
  
  const rule = {
    name: 'Generic Rule',
    pattern: '(?<amount>[\\d,]+)원',
    category: '기타'
  };
  
  const parsedIncome = textParser.parseNotification(textIncome1, [rule]);
  if (!parsedIncome || parsedIncome.type !== 'INCOME') {
    throw new Error(`Expected INCOME, got ${parsedIncome ? parsedIncome.type : null}`);
  }
  
  const parsedExpense = textParser.parseNotification(textExpense1, [rule]);
  if (!parsedExpense || parsedExpense.type !== 'EXPENSE') {
    throw new Error(`Expected EXPENSE, got ${parsedExpense ? parsedExpense.type : null}`);
  }
  
  const parsedCancel = textParser.parseNotification(textCancel1, [rule]);
  if (!parsedCancel || parsedCancel.type !== 'INCOME' || !parsedCancel.memo.startsWith('[승인취소]')) {
    throw new Error(`Expected INCOME with [승인취소] memo, got ${JSON.stringify(parsedCancel)}`);
  }
  
  const parsedDepCancel = textParser.parseNotification(textDepositCancel, [rule]);
  if (!parsedDepCancel || parsedDepCancel.type !== 'EXPENSE' || !parsedDepCancel.memo.startsWith('[입금취소]')) {
    throw new Error(`Expected EXPENSE with [입금취소] memo, got ${JSON.stringify(parsedDepCancel)}`);
  }
});

// Run all tests
let passedCount = 0;
let failedCount = 0;

console.log('Running parser tests...');
for (const t of tests) {
  try {
    t.fn();
    console.log(`[PASS] ${t.name}`);
    passedCount++;
  } catch (err) {
    console.error(`[FAIL] ${t.name}`);
    console.error(err);
    failedCount++;
  }
}

console.log(`\nTest results: ${passedCount} passed, ${failedCount} failed.`);
if (failedCount > 0) {
  process.exit(1);
} else {
  process.exit(0);
}
