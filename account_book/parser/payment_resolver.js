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
  if (/현금/.test(text || '') || payMethod === '현금') return 'CASH';
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

// Resolve ATM cash and bank cash flow consistently after the concrete provider is known.
// Related: text_parser.js, transaction_enrichment.js, Android rules.js and standalone_api.js.
function resolvePaymentType(text, payMethod, merchant, transactionType, configured = '') {
  const bank = !/카드/.test(payMethod || '') && /은행|뱅크|농협|우체국|새마을금고|신협|수협/.test(payMethod || '');
  if (bank && resolveAutomaticAtmCategory('', text, transactionType, merchant, payMethod) === 'ATM/출금') return 'CASH';
  if (bank && /입금|출금|인출|이체|송금/.test(text || '') && !isCheckPayment(text, '') && !isCreditPayment(text, '')
      && !['CHECK', 'CASH'].includes(configured)) return 'TRANSFER';
  if (['CREDIT', 'CHECK', 'TRANSFER', 'CASH'].includes(configured)) return configured;
  if (configured && configured !== 'UNKNOWN') return 'UNKNOWN';
  const inferred = parsePaymentType(text, payMethod);
  return inferred === 'BANK_TRANSFER' ? 'TRANSFER' : inferred;
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

// Card bill settlement is bank cash flow, excluded from consumption through transfer classification.
// Related: routes/webhook.js, routes/rules.js, routes/analytics.js, database/ha_sync.js.
function isBankCardSettlement(payMethod, merchant, text, transactionType) {
  if (transactionType !== 'EXPENSE' || !/출금/.test(text || '')) return false;
  if (!/은행|뱅크|계좌이체|농협|우체국|새마을금고|신협|수협/.test(payMethod || '')) return false;
  const compactMerchant = String(merchant || '').replace(/\s/g, '');
  return /^(?:(?:KB)?국민|신한|하나|우리|(?:NH)?농협|삼성|현대|롯데|BC|비씨)카드(?:결제|결제대금|대금|대금결제|출금)$|^카드(?:대금결제|선결제)$/.test(compactMerchant);
}

// Keep concrete transaction providers in the registry while honoring wallet exclusion.
// Related: database/connection.js, routes/webhook.js, routes/rules.js, routes/transactions.js.
async function ensureRegisteredPayMethod(db, name) {
  if (typeof name !== 'string' || !name.trim() || /페이|머니/.test(name) ||
      ['_AUTO_MAPPING_', '카드', '신용', '체크', '이체', '송금', 'UNKNOWN'].includes(name.trim())) return;
  await db.run('INSERT OR IGNORE INTO pay_methods (name) VALUES (?)', [name]);
}

// Reconcile exact historical labels without merging balances or changing existing transaction names.
// Related: database/connection.js, database/backup.js, routes/analytics.js.
async function reconcilePayMethods(db) {
  const providers = await db.all('SELECT DISTINCT pay_method FROM transactions');
  for (const row of providers) await ensureRegisteredPayMethod(db, row.pay_method);
}

// Wallet labels describe merchants, never funding accounts; unknown providers require review.
// Related: routes/webhook.js, routes/transactions.js; historical transactions are not migrated.
function normalizeNewWalletPayment(merchant, provider, originalProvider = provider) {
  const isWallet = value => /페이|머니|^(?:Npay|네이버페이)$/i.test(String(value || ''));
  const wallet = isWallet(originalProvider) ? originalProvider : isWallet(provider) ? provider : null;
  return {
    merchant: wallet && !String(merchant || '').includes(wallet) ? `${wallet} / ${merchant}` : merchant,
    pay_method: isWallet(provider) ? null : provider,
    wallet
  };
}

// Per user preference, unknown-merchant bank withdrawals are ATM; known merchants need cash evidence.
// Related: routes/webhook.js, routes/rules.js; existing transactions and mappings remain unchanged.
function resolveAutomaticAtmCategory(category, rawText, transactionType, merchant = '', payMethod = '') {
  const unknownMerchant = String(merchant || '').replace(/\s/g, '') === '알수없음';
  const bank = !/카드/.test(payMethod) && /은행|뱅크|농협|우체국|새마을금고|신협|수협/.test(payMethod);
  if (transactionType === 'EXPENSE' && unknownMerchant && bank && /출금/.test(rawText || '')) return 'ATM/출금';
  const explicitCash = /\bATM\b|현금\s*(?:인출|출금)|자동화기기|현금지급기|CD기/i.test(rawText || '');
  if (transactionType === 'EXPENSE' && explicitCash && /출금|인출/.test(rawText || '')) return 'ATM/출금';
  return category === 'ATM/출금' ? (transactionType === 'INCOME' ? '기타수입' : '기타') : category;
}

module.exports = {
  resolvePaymentType,
  normalizeNewWalletPayment,
  resolveAutomaticAtmCategory,
  ensureRegisteredPayMethod,
  reconcilePayMethods,
  isBankCardSettlement,
  parsePaymentType,
  isCheckPayment,
  isCreditPayment,
  isTransferPayment,
  resolveCheckCardToBank
};
