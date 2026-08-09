function escapeRegexChars(str) {
  return String(str).replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
}

function cleanMerchantName(merchant) {
  if (!merchant) return '사용처 없음';
  let cleaned = String(merchant).split(/\r?\n/)[0].trim();
  cleaned = cleaned.replace(/^\(?(?:주식회사|㈜)\)?\s*/g, '');
  cleaned = cleaned.replace(/\s*\(?(?:주식회사|㈜)\)?$/g, '');
  cleaned = cleaned.replace(/^[\s,\.\-_#@*&()[\]{}]+|[\s,\.\-_#@*&()[\]{}]+$/g, '');
  return cleaned.trim() || '사용처 없음';
}

let supportsDFlag = false;
try { new RegExp('a', 'd'); supportsDFlag = true; } catch (_) { /* older Node */ }

function sanitizePattern(pattern) {
  if (!pattern || typeof pattern !== 'string') return pattern;
  return pattern.replace(/\(\?<([a-zA-Z0-9_]+)>/g, (match, name) => {
    const camel = name.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    return `(?<${camel}>`;
  });
}

module.exports = { escapeRegexChars, cleanMerchantName, supportsDFlag, sanitizePattern };
