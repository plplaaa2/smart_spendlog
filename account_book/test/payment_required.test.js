// Automatic parsing must fail without a supported payment type.
// Related: parser/text_parser.js, routes/rules.js, routes/webhook.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseNotification } = require('../parser/text_parser');
const rule = {id:1, pattern:'(?<amount>[0-9,]+)원 (?<merchant>[^\\s]+)', pay_method:'_AUTO_MAPPING_'};
const parse = (text, extra={}) => parseNotification(text,[{...rule,...extra}],'2026-09-21 12:00:00');
test('unknown, absent and invalid payment types fail instead of defaulting to credit',()=>{
  for(const pay_type of [undefined,'UNKNOWN','INVALID']) assert.equal(parse('1,000원 테스트점',{pay_type}),null);
});
test('explicit text payment signals and configured rule types remain usable',()=>{
  assert.equal(parse('신용 1,000원 테스트점').payment_type,'CREDIT');
  assert.equal(parse('체크 1,000원 테스트점').payment_type,'CHECK');
  assert.equal(parse('출금 1,000원 테스트점',{pay_method:'하나은행'}).payment_type,'TRANSFER');
  assert.equal(parse('1,000원 테스트점',{pay_type:'TRANSFER'}).payment_type,'TRANSFER');
  assert.equal(parse('1,000원 테스트점',{pay_type:'CASH'}).payment_type,'CASH');
});
test('a failed notification can parse after the rule is corrected',()=>{
  assert.equal(parse('1,000원 테스트점'),null);
  assert.equal(parse('1,000원 테스트점',{pay_type:'CHECK'}).payment_type,'CHECK');
});

// Cover bank cash evidence separately from ordinary transfers and card cash advances.
// Related: payment_resolver.js, NotificationPolicy.java.
test('ATM bank withdrawals override stale credit defaults while transfers and cards stay distinct',()=>{
  assert.equal(parse('출금 40,000원 알수없음',{pay_method:'하나은행',pay_type:'CREDIT'}).payment_type,'CASH');
  assert.equal(parse('ATM 출금 40,000원 테스트점',{pay_method:'하나은행',pay_type:'CREDIT'}).payment_type,'CASH');
  assert.equal(parse('출금 1,000원 테스트점',{pay_method:'하나은행',pay_type:'CREDIT'}).payment_type,'TRANSFER');
  assert.equal(parse('ATM 신용 출금 40,000원 테스트점',{pay_method:'하나카드',pay_type:'CREDIT'}).payment_type,'CREDIT');
  assert.equal(parse('입금 40,000원 알수없음',{pay_method:'하나은행',pay_type:'CREDIT',type:'INCOME'}).payment_type,'TRANSFER');
});
