// Contract tests for bounded Webhook replay protection.
// Related files: services/webhook_replay_guard.js and routes/webhook.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createWebhookReplayGuard } = require('../services/webhook_replay_guard');

test('rejects malformed Webhook event IDs', () => {
  const guard = createWebhookReplayGuard();
  assert.deepEqual(guard.claim('contains spaces'), { accepted: false, reason: 'invalid' });
  assert.deepEqual(guard.claim('x'.repeat(129)), { accepted: false, reason: 'invalid' });
});

test('rejects a replay until the event ID TTL expires', () => {
  const guard = createWebhookReplayGuard({ ttlMs: 1000 });
  assert.deepEqual(guard.claim('event-1', 1000), { accepted: true, tracked: true });
  assert.deepEqual(guard.claim('event-1', 1500), { accepted: false, reason: 'replay' });
  assert.deepEqual(guard.claim('event-1', 2000), { accepted: true, tracked: true });
});

test('allows an explicitly released event ID to be retried', () => {
  const guard = createWebhookReplayGuard();
  guard.claim('event-2', 1000);
  guard.release('event-2');
  assert.deepEqual(guard.claim('event-2', 1001), { accepted: true, tracked: true });
});
