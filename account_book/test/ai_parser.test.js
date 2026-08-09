// Network-free safety tests for AI notification parsing requests.
// Related file: parser/ai_parser.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { fetchWithTimeout, readJsonResponse, parseNotificationWithAI } = require('../parser/ai_parser');

test('aborts an AI request after the configured timeout', async () => {
  const originalFetch = global.fetch;
  global.fetch = (_url, options) => new Promise((_resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });

  try {
    await assert.rejects(fetchWithTimeout('https://example.invalid', {}, 10), /10ms/);
  } finally {
    global.fetch = originalFetch;
  }
});

test('rejects oversized and malformed AI response bodies', async () => {
  const oversized = new Response('x'.repeat((64 * 1024) + 1), { status: 200 });
  await assert.rejects(readJsonResponse(oversized), /크기/);

  const malformed = new Response('not-json', { status: 200 });
  await assert.rejects(readJsonResponse(malformed), /JSON/);
});

test('rejects an unsupported AI provider without making a request', async () => {
  const result = await parseNotificationWithAI(
    '10,000원 테스트상점',
    { provider: 'unsupported' },
    '2026-08-09 12:00:00'
  );

  assert.equal(result, null);
});
