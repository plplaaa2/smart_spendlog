// Resolve shared payment method and category fields after notification parsing.
// Related files: routes/webhook.js, routes/rules.js, and database.js.
const BANK_METHODS = ['우체국', '새마을금고', '신협', '수협', '계좌이체'];
const TRANSFER_MERCHANTS = ['입금', '이체', '송금', '출금', '대체'];
// Apply the same new-payment and category policy to webhook ingestion and retry.
// Related: parser/payment_resolver.js, routes/webhook.js, routes/rules.js.
const { normalizeNewWalletPayment, resolveAutomaticAtmCategory, isBankCardSettlement, ensureRegisteredPayMethod, resolvePaymentType } = require('../parser/payment_resolver');
const CARD_TO_BANK = {
  'KB국민카드': '국민은행', '신한카드': '신한은행', '하나카드': '하나은행',
  '우리카드': '우리은행', 'NH농협카드': '농협은행', 'BC카드': '계좌이체',
  '삼성카드': '계좌이체', '현대카드': '계좌이체', '롯데카드': '계좌이체'
};

function isBankMethod(payMethod) {
  return payMethod.includes('은행') || payMethod.includes('뱅크') ||
    payMethod.includes('농협') || BANK_METHODS.includes(payMethod);
}

function retryExpenseFallback(merchant, payMethod) {
  const lowerMerchant = merchant.toLowerCase();
  const isPayCharge = ['페이충전', '페이 충전', '페이머니', '네이버페이', '카카오페이', '토스페이', '토스머니']
    .some(keyword => lowerMerchant.includes(keyword));
  const isPayMethod = (payMethod.includes('페이') || payMethod.includes('머니')) && !payMethod.includes('삼성페이');
  return (isPayCharge || isPayMethod) ? '페이류' : '기타';
}

async function enrichParsedTransaction({ db, result, sender, rawText, mode, findCategoryByMerchant }) {
  let finalPayMethod = result.pay_method;
  if (sender && sender !== 'Unknown') {
    const mapping = await db.get('SELECT pay_method FROM package_pay_methods WHERE package = ?', [sender]);
    if (mapping && mapping.pay_method) finalPayMethod = mapping.pay_method;
  }
  const historical = mode === 'retry' ? await db.get('SELECT id FROM transactions WHERE raw_text = ? LIMIT 1', [rawText]) : null;
  if (!historical) {
    const payment = normalizeNewWalletPayment(result.merchant, finalPayMethod, result.pay_method);
    if (payment.wallet && (!payment.pay_method || ['카드', '_AUTO_MAPPING_'].includes(payment.pay_method))) return { error: '페이·머니 결제의 실제 은행 또는 카드사를 지정해 주세요.' };
    result.merchant = payment.merchant; finalPayMethod = payment.pay_method;
  }
  if (finalPayMethod === '_AUTO_MAPPING_') finalPayMethod = '카드';
  const sourceProvider = finalPayMethod;
  // Re-evaluate mapped bank providers before check-card bank conversion.
  // Related: parser/payment_resolver.js, routes/webhook.js, routes/rules.js.
  result.payment_type = resolvePaymentType(rawText, finalPayMethod, result.merchant, result.type, result.payment_type);

  if (result.payment_type === 'CHECK') {
    if (CARD_TO_BANK[finalPayMethod]) finalPayMethod = CARD_TO_BANK[finalPayMethod];
    else if (finalPayMethod.includes('카드') && !finalPayMethod.includes('체크')) finalPayMethod = '계좌이체';
  }

  let finalCategory = result.category;
  if (!finalCategory || finalCategory === '_AUTO_MAPPING_' || finalCategory === '기타') {
    finalCategory = await findCategoryByMerchant(db, result.merchant);
  }
  if (!finalCategory) {
    if (result.type === 'INCOME') finalCategory = '기타수입';
    else finalCategory = mode === 'retry' ? retryExpenseFallback(result.merchant, finalPayMethod) : '기타';
  }

  const realNameRow = await db.get("SELECT value FROM settings WHERE key = 'user_real_name'");
  const realName = realNameRow ? realNameRow.value.trim() : '';
  finalCategory = resolveAutomaticAtmCategory(finalCategory, rawText, result.type, result.merchant, finalPayMethod);
  const isTransferMerchant = Boolean(realName && result.merchant === realName);
  if (isTransferMerchant && isBankMethod(finalPayMethod)) {
    finalCategory = result.type === 'INCOME' ? '이체/입금' : '이체/송금';
  }

  if (isBankCardSettlement(finalPayMethod, result.merchant, rawText, result.type)) finalCategory = '이체/송금';
  await ensureRegisteredPayMethod(db, finalPayMethod);
  return { finalPayMethod, finalCategory, sourceProvider };
}

module.exports = { enrichParsedTransaction };
