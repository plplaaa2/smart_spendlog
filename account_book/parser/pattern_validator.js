// Validate AI-generated regular expressions before execution or persistent caching.
// Related files: parser/ai_parser.js, parser/text_parser.js, routes/webhook.js.
const { sanitizePattern } = require('./utils');

const MAX_GENERATED_PATTERN_LENGTH = 4096;
const NESTED_QUANTIFIER_PATTERN = /\((?:\?:|\?<[^>]+>)?(?:[^()\\]|\\.)*[*+](?:[^()\\]|\\.)*\)\s*(?:[*+]|\{\d*,?\d*\})/;

function validateGeneratedPattern(pattern) {
  const errors = [];
  if (typeof pattern !== 'string') {
    return { valid: false, pattern: null, errors: ['pattern must be a string'] };
  }

  const sanitized = sanitizePattern(pattern.trim());
  if (!sanitized) errors.push('pattern must not be empty');
  if (sanitized.length > MAX_GENERATED_PATTERN_LENGTH) errors.push('pattern is too long');
  if (!sanitized.startsWith('^') || !sanitized.endsWith('$')) errors.push('pattern must be anchored');
  if (!sanitized.includes('(?<amount>')) errors.push('amount group is required');
  if (!sanitized.includes('(?<merchant>') && !sanitized.includes('(?<usage>')) errors.push('merchant or usage group is required');
  if (NESTED_QUANTIFIER_PATTERN.test(sanitized)) errors.push('nested quantifiers are not allowed');

  if (errors.length === 0) {
    try {
      new RegExp(sanitized, 'ds');
    } catch (err) {
      errors.push(`pattern syntax is invalid: ${err.message}`);
    }
  }

  return {
    valid: errors.length === 0,
    pattern: errors.length === 0 ? sanitized : null,
    errors
  };
}

module.exports = { validateGeneratedPattern };
