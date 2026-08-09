// Validate and normalize parser output before it reaches transaction storage.
// Related files: parser/text_parser.js, parser/ai_parser.js, routes/webhook.js, routes/rules.js.
const TRANSACTION_TYPES = new Set(['INCOME', 'EXPENSE']);
const PAYMENT_TYPES = new Set(['CREDIT', 'CHECK', 'TRANSFER', 'CASH']);
const FOREIGN_CURRENCIES = new Set(['USD', 'JPY', 'EUR', 'CNY']);

function isValidDatabaseDatetime(value) {
  if (typeof value !== 'string') return false;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return false;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);

  if (year < 1900 || year > 2100 || month < 1 || month > 12) return false;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return false;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= lastDay;
}

function validateParsingResult(result) {
  const errors = [];
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    return { valid: false, value: null, errors: ['result must be an object'] };
  }

  const value = { ...result };
  value.merchant = typeof value.merchant === 'string' ? value.merchant.trim() : '';
  value.pay_method = typeof value.pay_method === 'string' ? value.pay_method.trim() : '';
  value.datetime = typeof value.datetime === 'string' ? value.datetime.trim() : '';
  value.currency = value.currency ? String(value.currency).trim().toUpperCase() : null;
  value.original_amount = value.original_amount == null ? null : Number(value.original_amount);
  value.used_point = value.used_point == null ? 0 : Number(value.used_point);

  if (!Number.isSafeInteger(value.amount) || value.amount <= 0) errors.push('amount must be a positive safe integer');
  if (!value.merchant || value.merchant.length > 200) errors.push('merchant must contain 1-200 characters');
  if (!value.pay_method || value.pay_method.length > 100) errors.push('pay_method must contain 1-100 characters');
  if (!isValidDatabaseDatetime(value.datetime)) errors.push('datetime must be a valid YYYY-MM-DD HH:mm:ss value');
  if (!TRANSACTION_TYPES.has(value.type)) errors.push('type is not supported');
  if (!PAYMENT_TYPES.has(value.payment_type)) errors.push('payment_type is not supported');
  if (!Number.isSafeInteger(value.used_point) || value.used_point < 0) errors.push('used_point must be a non-negative safe integer');

  if (value.currency !== null && !FOREIGN_CURRENCIES.has(value.currency)) {
    errors.push('currency is not supported');
  }
  if (value.original_amount !== null && (!Number.isFinite(value.original_amount) || value.original_amount <= 0)) {
    errors.push('original_amount must be a positive number');
  }
  if ((value.currency === null) !== (value.original_amount === null)) {
    errors.push('currency and original_amount must be provided together');
  }

  return {
    valid: errors.length === 0,
    value: errors.length === 0 ? value : null,
    errors
  };
}

module.exports = {
  isValidDatabaseDatetime,
  validateParsingResult
};
