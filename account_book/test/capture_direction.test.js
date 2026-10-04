// Verify generated and legacy captures preserve direction and points without production data.
// Related: parser/text_parser.js, parser/transaction_classifier.js, parser/pattern_generator.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseNotification } = require('../parser/text_parser');
const { determineTransactionType } = require('../parser/transaction_classifier');
const { generatePatternFromText } = require('../parser/pattern_generator');
const parse = (text, pattern) => parseNotification(text, [{
  id: 1, pattern, type: 'EXPENSE', pay_type: 'TRANSFER', pay_method: '하나은행'
}], '2026-10-04 12:00:00');

test('legacy and camelCase direction captures override merchant keywords', () => {
  for (const name of ['type_text', 'typeText', 'status']) {
    assert.equal(parse('입금 108원 하나체크환급', `(?<${name}>입금) (?<amount>\\d+)원 (?<merchant>.+)`).type, 'INCOME');
    assert.equal(parse('출금 108원 입금서비스', `(?<${name}>출금) (?<amount>\\d+)원 (?<merchant>.+)`).type, 'EXPENSE');
  }
});

test('cancellation direction remains correct', () => {
  assert.equal(determineTransactionType('입금취소 108원', {status: '입금취소'}).transactionType, 'EXPENSE');
  assert.equal(determineTransactionType('승인취소 108원', {status: '승인취소'}).transactionType, 'INCOME');
});

test('legacy and camelCase point captures are read even without a point label', () => {
  for (const name of ['used_point', 'usedPoint']) {
    assert.equal(parse('결제 108원 테스트 50점', `결제 (?<amount>\\d+)원 (?<merchant>\\S+) (?<${name}>\\d+)점`).used_point, 50);
  }
});

test('generated deposit rules capture direction and round trip through the parser', () => {
  const text = '입금 108원 하나체크환급 잔액 1,000원\n10/04 12:00 123-***-456';
  const pattern = generatePatternFromText(text);
  assert.ok(pattern);
  assert.equal(new RegExp(pattern, 's').exec(text).groups.status, '입금');
  assert.equal(parse(text, pattern).type, 'INCOME');
});

test('amountless notification text cannot generate a transaction rule', () => {
  assert.equal(generatePatternFromText('서비스 공지 안내'), null);
});

test('24-hour noon is preserved and explicit AM midnight remains midnight', () => {
  const {parseFlexibleDatetime} = require('../parser/datetime_parser');
  assert.equal(parseFlexibleDatetime('10/04 12:30', 2026), '2026-10-04 12:30:00');
  assert.equal(parseFlexibleDatetime('오전 10/04 12:30', 2026), '2026-10-04 00:30:00');
  assert.equal(parseFlexibleDatetime('오후 10/04 12:30', 2026), '2026-10-04 12:30:00');
});

test('generated won patterns accept currency whitespace and preserve numeric captures', () => {
  for (const gap of ['', ' ', '   ', '\t', '\n', '\r\n']) {
    const text = `하나은행 출금 1,000${gap}원 테스트점 잔액 100,000${gap}원 누적 200,000${gap}원`;
    const pattern = generatePatternFromText(text);
    assert.ok(pattern, JSON.stringify(gap));
    const groups = new RegExp(pattern, 's').exec(text).groups;
    assert.equal(groups.amount, '1,000');
    assert.equal(groups.balance, '100,000');
    assert.equal(groups.cumulative, '200,000');
    assert.equal(parse(text, pattern).amount, 1000);
    const balanceFirst = `하나은행 잔액 100,000${gap}원 출금 1,000${gap}원 테스트점`;
    assert.equal(parse(balanceFirst, generatePatternFromText(balanceFirst)).amount, 1000);
    assert.equal(generatePatternFromText(`하나은행 잔액 100,000${gap}원`), null);
  }
  const pattern = generatePatternFromText('하나은행 출금 1,000 원 테스트점');
  for (const gap of ['', ' ', '\t']) assert.equal(parse(`하나은행 출금 2,000${gap}원 다른점`, pattern).amount, 2000);
});

test('generated amounts exclude balances and cumulative totals in either order', () => {
  for (const summary of ['잔액 100,000원', '잔고: 100,000원', '누적 100,000원', '누적 이용금액 100,000원']) {
    for (const text of [`하나은행 ${summary} 출금 1,000원 테스트점`, `하나은행 출금 1,000원 테스트점 ${summary}`]) {
      const pattern = generatePatternFromText(text);
      assert.ok(pattern, text);
      assert.equal(new RegExp(pattern, 's').exec(text).groups.amount, '1,000', text);
    }
    assert.equal(generatePatternFromText(`하나은행 ${summary}`), null);
  }
  assert.equal(generatePatternFromText('하나은행 누적 100,000'), null);
  for (const text of ['하나은행 잔액 USD 100.00 출금 USD 10.00 테스트점']) {
    const pattern = generatePatternFromText(text);
    assert.ok(pattern, text);
    assert.equal(Number(new RegExp(pattern, 's').exec(text).groups.amount.replace(/,/g, '')), text.includes('USD') ? 10 : 1000);
  }
});

// A check-card installment detail must not override the explicit check-card signal.
// Related: parser/text_parser.js, parser/pattern_generator.js, database/check_notification.js.
test('legacy provider capture containing check overrides installment and credit defaults', () => {
  const text = '(결제) 7,000원 테스트점 / 체크(일시불,3*9*) / 09.29 13:29';
  const pattern = '\\(결제\\) (?<amount>[\\d,]+)원 (?<merchant>.+?) / (?<pay_method>[^\\(]+)\\((?<pay_type>[^\\)]+)\\) / (?<time>\\d{2}\\.\\d{2} \\d{2}:\\d{2})';
  assert.equal(parseNotification(text,[{id:1,pattern,pay_method:'카드',pay_type:'CREDIT'}]).payment_type,'CHECK');
});

test('generated payment rules separate check type from installment details', () => {
  const text = '(결제) 7,000원 테스트점 / 체크(일시불,3*9*) / 09.29 13:29';
  const pattern = generatePatternFromText(text);
  assert.ok(pattern);
  const groups = new RegExp(pattern,'s').exec(text).groups;
  assert.ok(groups.payType.startsWith('체크'));
  assert.notEqual(groups.payMethod,'체크');
  assert.equal(parse(text,pattern).payment_type,'CHECK');
});

// Invalid restored rules must be rejected, while runtime skips preserve valid fallback parsing.
// Related: parser/utils.js, parser/text_parser.js, database/backup.js.
test('invalid rules warn once and do not prevent valid rules from parsing',()=>{
  const originalWarn=console.warn;
  let warnings=0;
  console.warn=()=>warnings++;
  try {
    const rules=[{id:40000,pattern:'(',enabled:1},{id:2,pattern:'(?<amount>\\d+)원 (?<merchant>.+)',pay_type:'TRANSFER'}];
    for(let i=0;i<2;i++) assert.equal(parseNotification('108원 테스트',rules).amount,108);
    assert.equal(warnings,1);
    rules[0]={id:40000,pattern:'(?<amount>\\d+)원 (?<merchant>.+)',pay_type:'TRANSFER'};
    assert.equal(parseNotification('108원 테스트',rules).rule_id,40000);
  } finally {console.warn=originalWarn;}
});
test('disabled rules cannot parse notifications',()=>{
  const rule={id:1,pattern:'(?<amount>\\d+)원 (?<merchant>.+)',pay_type:'TRANSFER'};
  for(const enabled of [0,false,'0']) assert.equal(parseNotification('108원 테스트',[{...rule,enabled}]),null);
});
test('restore validation rejects invalid transaction and pass patterns',()=>{
  const {validateBackupRulePatterns}=require('../parser/utils');
  assert.doesNotThrow(()=>validateBackupRulePatterns({rules:[{id:1,pattern:'(?<type_text>입금)'}],pass_rules:[]}));
  for(const table of ['rules','pass_rules']) assert.throws(()=>validateBackupRulePatterns({[table]:[{id:400,pattern:'('}]}),/ID 400/);
});

test('legacy settlement pattern captures the bill merchant instead of old account markers', () => {
  const { sanitizePattern } = require('../parser/utils');
  const pattern = String.raw`출금\s*(?<amount>[\d,]+)원\s*하나카드결제\s*(?:잔액|잔고)\s*:?\s*(?<balance>[\d,]+)원\s*(?<time>\d{2}\/\d{2}\s+\d{2}:\d{2}(?::\d{2})?)\s*(?<account>[\d*-]+)(?<merchant>.+?)(?:\s+[\d,]+)?(?:[\d*-]+)`;
  for (const suffix of ['', '(구)456****789', '(구)456-***-789']) {
    const text = `출금 536,693원 하나카드결제 잔액 6,000,000원\n10/03 21:08 123-***-456${suffix}`;
    const result = parse(text, pattern);
    assert.equal(result.merchant, '하나카드결제');
    assert.equal(result.amount, 536693);
    assert.equal(result.type, 'EXPENSE');
    assert.equal(result.datetime, '2026-10-03 21:08:00');
  }
  assert.equal(sanitizePattern(sanitizePattern(pattern)), sanitizePattern(pattern));
  const custom = pattern.replace('하나카드결제', '다른사용처');
  assert.equal(sanitizePattern(custom), custom);
});
