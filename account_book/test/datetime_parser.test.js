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

test('parses valid separated and Korean timestamps', () => {
  assert.equal(parseFlexibleDatetime('2026-08-09 12:30', 2026), '2026-08-09 12:30:00');
  assert.equal(parseFlexibleDatetime('오전 2026-08-09 12:30', 2026), '2026-08-09 00:30:00');
  assert.equal(parseFlexibleDatetime('오후 2026년 8월 9일 1시 5분', 2026), '2026-08-09 13:05:00');
  assert.equal(parseFlexibleDatetime('2024-02-29 23:59:59', 2026), '2024-02-29 23:59:59');
});

test('rejects invalid separated and Korean timestamps', () => {
  assert.equal(parseFlexibleDatetime('2026-02-29 10:30', 2026), '');
  assert.equal(parseFlexibleDatetime('2026-04-31 10:30', 2026), '');
  assert.equal(parseFlexibleDatetime('2026-08-09 24:00', 2026), '');
  assert.equal(parseFlexibleDatetime('2026년 8월 9일 10시 60분', 2026), '');
});
