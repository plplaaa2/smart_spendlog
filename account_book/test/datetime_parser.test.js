// Regression tests for compact numeric notification timestamps.
// Related file: parser/datetime_parser.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFlexibleDatetime } = require('../parser/datetime_parser');

test('parses valid compact numeric timestamps', () => {
  assert.equal(parseFlexibleDatetime('20260809', 2026), '2026-08-09 00:00:00');
  assert.equal(parseFlexibleDatetime('08091230', 2026), '2026-08-09 12:30:00');
  assert.equal(parseFlexibleDatetime('260809123045', 2026), '2026-08-09 12:30:45');
  assert.equal(parseFlexibleDatetime('20260809123045', 2026), '2026-08-09 12:30:45');
});

test('rejects invalid compact dates and times', () => {
  assert.equal(parseFlexibleDatetime('20260230', 2026), '');
  assert.equal(parseFlexibleDatetime('02291230', 2025), '');
  assert.equal(parseFlexibleDatetime('261332123045', 2026), '');
  assert.equal(parseFlexibleDatetime('20260809126000', 2026), '');
});

test('rejects compact timestamps with trailing text', () => {
  assert.equal(parseFlexibleDatetime('20260809junk', 2026), '');
});
