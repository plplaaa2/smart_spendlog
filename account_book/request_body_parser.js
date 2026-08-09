// Applies endpoint-specific JSON limits so backup restores can accept exported data safely.
// Related files: index.js, routes/settings.js, routes/webhook.js, and test/request_body_parser.test.js.
const express = require('express');

const DEFAULT_JSON_LIMIT = '100kb';
const RESTORE_JSON_LIMIT = '5mb';
const WEBHOOK_JSON_LIMIT = '10kb';

function createRequestBodyParser() {
  const defaultParser = express.json({ limit: DEFAULT_JSON_LIMIT });
  const restoreParser = express.json({ limit: RESTORE_JSON_LIMIT });
  const webhookParser = express.json({ limit: WEBHOOK_JSON_LIMIT });

  return (req, res, next) => {
    if (req.path === '/api/settings/restore') {
      return restoreParser(req, res, next);
    }
    if (req.path === '/api/webhook') {
      return webhookParser(req, res, next);
    }
    return defaultParser(req, res, next);
  };
}

module.exports = {
  createRequestBodyParser,
  DEFAULT_JSON_LIMIT,
  RESTORE_JSON_LIMIT,
  WEBHOOK_JSON_LIMIT
};
