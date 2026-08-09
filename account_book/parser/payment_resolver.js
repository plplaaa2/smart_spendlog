const { CARD_TO_BANK_MAP, BANK_HINTS } = require('./constants');

function parsePaymentType(text, payMethod) {
  const normalizedText = String(text || '');
  const normalizedPayMethod = String(payMethod || '');

  if (/체크/.test(normalizedText) || /체크/.test(normalizedPayMethod)) return 'CHECK';
  if (/신용|일시불|할부|신용카드/.test(normalizedText) || /신용/.test(normalizedPayMethod)) return 'CREDIT';
  if (/(출금|입금|이체|송금)/.test(normalizedText) && /(은행|뱅크|계좌|우체국|새마을금고|신협|수협)/.test(normalizedPayMethod)) return 'BANK_TRANSFER';
  if (/현금/.test(normalizedText) || /현금/.test(normalizedPayMethod)) return 'CASH';
  return 'UNKNOWN';
}

function resolveCheckCardToBank(text, payMethod) {
  const sourceText = String(text || '');
  const sourceMethod = String(payMethod || '');
  let targetBank = CARD_TO_BANK_MAP[sourceMethod];

  for (const [hint, bankName] of Object.entries(BANK_HINTS)) {
    if (sourceText.includes(hint)) {
      targetBank = bankName;
      break;
    }
  }

  return targetBank || sourceMethod;
}

module.exports = { parsePaymentType, resolveCheckCardToBank };
