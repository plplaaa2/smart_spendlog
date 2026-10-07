// Deterministically rank notification rules by classification specificity.
// Related files: routes/webhook.js, routes/rules.js, parser/text_parser.js.
const GENERIC_METHODS = new Set(['', '카드', '신용카드', '체크카드', '계좌이체', '현금', '_AUTO_MAPPING_']);
const PAYMENT_SIGNAL = /신용|체크|이체|송금|현금|일시불|할부/u;
const BROAD_TRANSFER = /출금|입금|잔액|잔고|자동이체/u;
function ruleSpecificity(rule) {
  const method = String(rule.pay_method || '').trim();
  const payType = String(rule.pay_type || '').trim();
  const pattern = String(rule.pattern || '');
  const name = String(rule.name || '');
  const hasPaymentMethod = ['CHECK', 'TRANSFER', 'CASH'].includes(payType.toUpperCase()) || PAYMENT_SIGNAL.test(pattern) || PAYMENT_SIGNAL.test(name);
  const hasProvider = !GENERIC_METHODS.has(method);
  const hasMerchantCapture = /\(\?<merchant>|\(\?<usage>/u.test(pattern) || /merchant|usage|사용처|가맹점/u.test(name);
  if (BROAD_TRANSFER.test(pattern) && !hasPaymentMethod && !hasMerchantCapture) return 40;
  if (hasPaymentMethod) return 10;
  if (hasProvider) return 20;
  if (hasMerchantCapture) return 30;
  return 50;
}
function orderRules(rules) { return [...rules].sort((a,b) => ruleSpecificity(a)-ruleSpecificity(b) || (Number(a.priority)||100)-(Number(b.priority)||100) || (Number(a.id)||0)-(Number(b.id)||0)); }
module.exports = { orderRules, ruleSpecificity };
