// Verifies endpoint-specific JSON limits for restore, general API, and Webhook requests.
// Related files: request_body_parser.js, index.js, routes/settings.js, and routes/webhook.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createRequestBodyParser } = require('../request_body_parser');

async function postJson(path, payload) {
  const app = express();
  app.use(createRequestBodyParser());
  app.post(path, (req, res) => res.json({ length: req.body.data.length }));
  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'payload too large' });
    }
    return next(err);
  });

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const body = JSON.stringify({ data: payload });

  try {
    return await new Promise((resolve, reject) => {
      const request = http.request({
        hostname: '127.0.0.1',
        port: address.port,
        path,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body)
        }
      }, response => {
        let responseBody = '';
        response.setEncoding('utf8');
        response.on('data', chunk => { responseBody += chunk; });
        response.on('end', () => resolve({ status: response.statusCode, body: responseBody }));
      });
      request.on('error', reject);
      request.end(body);
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('accepts a restore payload larger than the default JSON limit', async () => {
  const response = await postJson('/api/settings/restore', 'x'.repeat(150 * 1024));
  assert.equal(response.status, 200);
});

test('keeps the default JSON limit for general API requests', async () => {
  const response = await postJson('/api/example', 'x'.repeat(150 * 1024));
  assert.equal(response.status, 413);
});

test('keeps the strict JSON limit for Webhook requests', async () => {
  const response = await postJson('/api/webhook', 'x'.repeat(12 * 1024));
  assert.equal(response.status, 413);
});
