// Safety contract tests for AI-generated parsing regular expressions.
// Related file: parser/pattern_validator.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateGeneratedPattern } = require('../parser/pattern_validator');

test('accepts an anchored pattern with required groups', () => {
  const validation = validateGeneratedPattern('^(?<amount>[\\d,]+)원\\s+(?<merchant>.+?)$');

  assert.equal(validation.valid, true);
  assert.equal(validation.pattern, '^(?<amount>[\\d,]+)원\\s+(?<merchant>.+?)$');
});

test('normalizes legacy named groups before validation', () => {
  const validation = validateGeneratedPattern('^(?<amount>[\\d,]+)원\\s+(?<merchant_name>.+?)\\s+(?<merchant>.+?)$');

  assert.equal(validation.valid, true);
  assert.match(validation.pattern, /merchantName/);
});

test('rejects unanchored, incomplete, oversized, and risky patterns', () => {
  assert.equal(validateGeneratedPattern('(?<amount>[\\d,]+)원(?<merchant>.+)').valid, false);
  assert.equal(validateGeneratedPattern('^(?<amount>[\\d,]+)원$').valid, false);
  assert.equal(validateGeneratedPattern(`^(?<amount>[\\d,]+)원(?<merchant>${'a'.repeat(4097)})$`).valid, false);
  assert.equal(validateGeneratedPattern('^(?<amount>[\\d,]+)원(?<merchant>(a+)+)$').valid, false);
});
