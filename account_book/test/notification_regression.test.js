// Sanitized notification regression corpus for built-in parsing rules.
// Related files: default_rules.json, parser/text_parser.js, and test/fixtures/notification_regression_cases.json.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseNotification } = require('../parser/text_parser');
const defaultRules = require('../default_rules.json').rules.map((rule, index) => ({ ...rule, id: index + 1 }));
const cases = require('./fixtures/notification_regression_cases.json');

for (const regressionCase of cases) {
  test(`parses sanitized notification: ${regressionCase.name}`, () => {
    const result = parseNotification(regressionCase.text, defaultRules, '2026-08-09 12:00:00');
    assert.ok(result, `No rule matched: ${regressionCase.name}`);
    for (const [field, expectedValue] of Object.entries(regressionCase.expected)) {
      assert.equal(result[field], expectedValue, `${regressionCase.name}: ${field}`);
    }
  });
}
