import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatCompletionsProvider } from '../server/provider.mjs';

test('provider defaults to JSON object mode, caps output, uses allowlisted context and never retries', async () => {
  let calls = 0;
  let sent;
  const provider = createChatCompletionsProvider(
    {
      providerBaseUrl: 'https://provider.example/v1',
      providerApiKey: 'server-only-test-key',
      providerModel: 'configured-model',
      providerStructuredMode: 'json_object',
      providerTimeoutMs: 1000,
    },
    async (url, options) => {
      calls++;
      sent = { url: String(url), options };
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  operations: [{ op: 'remove_object', objectId: 'obj_1' }],
                }),
              },
            },
          ],
        }),
        {
          headers: { 'content-type': 'application/json' },
        },
      );
    },
  );
  const result = await provider.generate({
    draftScene: { objects: [] },
    prompt: 'remove it',
    signal: new AbortController().signal,
  });
  assert.deepEqual(result, { operations: [{ op: 'remove_object', objectId: 'obj_1' }] });
  assert.equal(calls, 1);
  assert.equal(sent.url, 'https://provider.example/v1/chat/completions');
  assert.equal(sent.options.headers.authorization, 'Bearer server-only-test-key');
  const requestBody = JSON.parse(sent.options.body);
  assert.deepEqual(requestBody.response_format, { type: 'json_object' });
  assert.equal(requestBody.max_tokens, 2048);
  assert.match(requestBody.messages[0].content, /garden\.bamboo-cluster/);
  assert.equal(requestBody.messages[1].content.includes('remove it'), true);
  assert.equal(requestBody.messages[1].content.includes('server-only-test-key'), false);
});

test('provider input limit and invalid URL fail before network call', async () => {
  let calls = 0;
  const provider = createChatCompletionsProvider(
    {
      providerBaseUrl: 'https://provider.example/v1',
      providerApiKey: 'server-only-test-key',
      providerModel: 'configured-model',
      providerMaxInputBytes: 10,
    },
    async () => {
      calls++;
      return new Response('{}');
    },
  );
  await assert.rejects(
    provider.generate({
      draftScene: { objects: [] },
      prompt: 'long prompt',
      signal: new AbortController().signal,
    }),
    /input exceeded/,
  );
  assert.equal(calls, 0);
  assert.throws(
    () =>
      createChatCompletionsProvider({
        providerBaseUrl: 'http://provider.example/v1',
        providerApiKey: 'key',
        providerModel: 'model',
        production: true,
      }),
    /HTTPS/,
  );
});

test('invalid provider response is not automatically retried', async () => {
  let calls = 0;
  const provider = createChatCompletionsProvider(
    {
      providerBaseUrl: 'https://provider.example/v1',
      providerApiKey: 'server-only-test-key',
      providerModel: 'configured-model',
    },
    async () => {
      calls++;
      return new Response(JSON.stringify({ choices: [{ message: { content: 'not-json' } }] }), {
        status: 200,
      });
    },
  );
  await assert.rejects(
    provider.generate({ draftScene: {}, prompt: 'prompt', signal: new AbortController().signal }),
  );
  assert.equal(calls, 1);
});
