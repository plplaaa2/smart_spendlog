// Resolves automatic notification payment types from explicit text evidence only.
// Related files: parser/text_parser.js, parser/ai_parser.js, and test/fixtures/payment_type_regression_cases.json.
const { CARD_TO_BANK_MAP, BANK_HINTS } = require('./constants');

const CHECK_PATTERN = /\uCCB4\uD06C(?:\s*\uCE74\uB4DC)?/u;
const CREDIT_PATTERN = /\uC2E0\uC6A9|\uC77C\uC2DC\uBD88|\uD560\uBD80/u;
const TRANSFER_PATTERN = /\uACC4\uC88C\s*\uC774\uCCB4|\uC774\uCCB4|\uC1A1\uAE08/u;

function includesPaymentSignal(pattern, text, payMethod) {
  return pattern.test(String(text || '')) || pattern.test(String(payMethod || ''));
}

function isCheckPayment(text, payMethod) {
  return includesPaymentSignal(CHECK_PATTERN, text, payMethod);
}

function isCreditPayment(text, payMethod) {
  return includesPaymentSignal(CREDIT_PATTERN, text, payMethod);
}

function isTransferPayment(text, payMethod) {
  return includesPaymentSignal(TRANSFER_PATTERN, text, payMethod);
}

function parsePaymentType(text, payMethod) {
  if (isCheckPayment(text, payMethod)) {
    return 'CHECK';
  }
  if (isTransferPayment(text, payMethod)) {
    return 'BANK_TRANSFER';
  }
  if (isCreditPayment(text, payMethod)) {
    return 'CREDIT';
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
  isCheckPayment,
  isCreditPayment,
  isTransferPayment,
  resolveCheckCardToBank
};
