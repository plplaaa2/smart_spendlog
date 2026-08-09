// Resolve shared payment method and category fields after notification parsing.
// Related files: routes/webhook.js, routes/rules.js, and database.js.
const BANK_METHODS = ['우체국', '새마을금고', '신협', '수협', '계좌이체'];
const TRANSFER_MERCHANTS = ['입금', '이체', '송금', '출금', '대체'];
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
  if (finalPayMethod === '_AUTO_MAPPING_') finalPayMethod = '카드';

  if (mode === 'webhook' && (rawText.includes('체크') || finalPayMethod.includes('체크'))) {
    if (CARD_TO_BANK[finalPayMethod]) finalPayMethod = CARD_TO_BANK[finalPayMethod];
    else if (finalPayMethod.includes('카드') && !finalPayMethod.includes('체크')) finalPayMethod = '계좌이체';
  }

  let finalCategory = mode === 'webhook' ? result.category : null;
  if (!finalCategory || finalCategory === '_AUTO_MAPPING_') {
    finalCategory = await findCategoryByMerchant(db, result.merchant);
  }
  if (!finalCategory) {
    if (result.type === 'INCOME') finalCategory = '기타수입';
    else finalCategory = mode === 'retry' ? retryExpenseFallback(result.merchant, finalPayMethod) : '기타';
  }

  const realNameRow = await db.get("SELECT value FROM settings WHERE key = 'user_real_name'");
  const realName = realNameRow ? realNameRow.value.trim() : '';
  const isCardCompany = mode === 'webhook' &&
    (result.merchant.endsWith('카드') || /카드대금|카드결제|카드출금/.test(result.merchant));
  const isTransferMerchant = (realName && result.merchant === realName) ||
    TRANSFER_MERCHANTS.includes(result.merchant) || isCardCompany;
  if (isTransferMerchant && isBankMethod(finalPayMethod)) {
    finalCategory = result.type === 'INCOME' ? '이체/입금' : '이체/송금';
  }

  return { finalPayMethod, finalCategory };
}

module.exports = { enrichParsedTransaction };
