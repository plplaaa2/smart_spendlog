// Bound and validate optional Webhook event IDs to prevent short-window replays.
// Related file: routes/webhook.js. State is intentionally process-local and TTL-limited.
const EVENT_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function createWebhookReplayGuard({ ttlMs = 10 * 60 * 1000, maxEntries = 1000 } = {}) {
  const acceptedEvents = new Map();

  function cleanup(now) {
    for (const [eventId, expiresAt] of acceptedEvents) {
      if (expiresAt <= now) acceptedEvents.delete(eventId);
    }
    while (acceptedEvents.size >= maxEntries) {
      acceptedEvents.delete(acceptedEvents.keys().next().value);
    }
  }

  function claim(eventId, now = Date.now()) {
    if (eventId === undefined) return { accepted: true, tracked: false };
    if (typeof eventId !== 'string' || !EVENT_ID_PATTERN.test(eventId)) {
      return { accepted: false, reason: 'invalid' };
    }
    cleanup(now);
    if (acceptedEvents.has(eventId)) return { accepted: false, reason: 'replay' };
    acceptedEvents.set(eventId, now + ttlMs);
    return { accepted: true, tracked: true };
  }

  function release(eventId) {
    if (typeof eventId === 'string') acceptedEvents.delete(eventId);
  }

  return { claim, release };
}

module.exports = { createWebhookReplayGuard };
