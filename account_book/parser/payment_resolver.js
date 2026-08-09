const { CARD_TO_BANK_MAP, BANK_HINTS } = require('./constants');

function parsePaymentType(text, payMethod) {
  const normalizedText = text || '';
  const normalizedPayMethod = payMethod || '';

  if (normalizedText.includes('체크') || normalizedPayMethod.includes('체크')) {
    return 'CHECK';
  }
  if (normalizedText.includes('신용') || normalizedPayMethod.includes('신용') || normalizedText.includes('일시불') || /할부/.test(normalizedText)) {
    return 'CREDIT';
  }
  if (/출금|입금|이체|송금/.test(normalizedText) && (normalizedPayMethod.includes('은행') || normalizedPayMethod.includes('뱅크') || ['우체국', '새마을금고', '신협', '수협', '계좌이체'].includes(normalizedPayMethod))) {
    return 'BANK_TRANSFER';
  }
  return 'UNKNOWN';
}

function resolveCheckCardToBank(text, payMethod) {
  let targetBank = CARD_TO_BANK_MAP[payMethod];

  for (const [hint, bankName] of Object.entries(BANK_HINTS)) {
    if (text.includes(hint)) {
      targetBank = bankName;
      break;
    }
  }

  if (!targetBank && payMethod.includes('카드')) {
    targetBank = '계좌이체';
  }

  return targetBank || payMethod;
}

module.exports = {
  parsePaymentType,
  resolveCheckCardToBank
};
