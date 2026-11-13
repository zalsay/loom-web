import test from 'node:test';
import assert from 'node:assert/strict';
import { toAgentWebRequest } from '../server/edge-runtime.mjs';
import { createApp } from '../server/app.mjs';
import { createMemoryStore } from '../server/storage.mjs';
import { loadConfig } from '../server/config.mjs';

const origin = 'https://loom.example';
const conversationId = '9d0fd731-d7a4-4387-aea9-296db4217b9a';
const headers = {
  origin,
  'sec-fetch-site': 'same-origin',
  'x-loom-request': '1',
  'content-type': 'application/json',
  'makers-conversation-id': conversationId,
};

test('Makers context reaches guide validation with the signed visitor identity intact', async () => {
  const config = loadConfig({
    NODE_ENV: 'production',
    LOOM_ORIGIN: origin,
    LOOM_COOKIE_SECRET: 'test-only-cookie-secret-at-least-thirty-two-bytes',
    LOOM_EDGE_RATE_LIMIT_CONFIRMED: 'true',
  });
  const app = createApp({ config, store: createMemoryStore() });
  const bootstrap = await app.handle(
    new Request(`${origin}/api/v1/session/bootstrap`, {
      method: 'POST',
      headers,
      body: '{}',
    }),
  );
  assert.equal(bootstrap.status, 200);
  const cookie = bootstrap.headers.get('set-cookie').split(';')[0];
  const contextRequest = {
    url: `${origin}/guide`,
    path: '/guide',
    method: 'POST',
    headers: { ...headers, cookie },
    body: { message: '你好' },
    signal: new AbortController().signal,
  };
  const response = await app.handle(toAgentWebRequest(contextRequest));
  // Chat is deliberately disabled: reaching this response proves policy, cookie and body passed.
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'chat_unavailable');
  const foreign = await app.handle(
    toAgentWebRequest({
      ...contextRequest,
      headers: { ...contextRequest.headers, origin: 'https://evil.example' },
    }),
  );
  assert.equal(foreign.status, 403);
  const forged = await app.handle(
    toAgentWebRequest({ ...contextRequest, body: { message: '你好', ownerId: 'forged' } }),
  );
  assert.equal(forged.status, 400);
  const oversized = await app.handle(
    toAgentWebRequest({ ...contextRequest, body: { message: 'x'.repeat(8200) } }),
  );
  assert.equal(oversized.status, 413);
});

test('Makers request conversion preserves cancellation and JSON string values', async () => {
  const controller = new AbortController();
  const request = toAgentWebRequest({
    url: `${origin}/guide`,
    method: 'POST',
    headers,
    body: 'a JSON string is still a string',
    signal: controller.signal,
  });
  assert.equal(await request.json(), 'a JSON string is still a string');
  controller.abort();
  assert.equal(request.signal.aborted, true);
});

test('local adapters keep native Web Requests unchanged', () => {
  const request = new Request(`${origin}/guide`);
  assert.equal(toAgentWebRequest(request), request);
});
