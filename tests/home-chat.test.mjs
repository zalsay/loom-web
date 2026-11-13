import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeChat } from '../server/home-chat.mjs';
import { createApp } from '../server/app.mjs';
import { createMemoryStore } from '../server/storage.mjs';
import { loadConfig } from '../server/config.mjs';

const origin = 'http://localhost:5173';
const config = loadConfig({
  LOOM_ORIGIN: origin,
  LOOM_COOKIE_SECRET: 'local-test-secret-at-least-thirty-two-bytes',
  LOOM_CHAT_ENABLED: 'true',
  AI_GATEWAY_API_KEY: 'test-only-key',
});
const conversationId = 'eeea943a-3dd6-41c3-9863-2ab12b202803';
const request = (body = { message: '我想逛农场' }, headers = {}, signal) =>
  new Request(`${origin}/guide`, {
    method: 'POST',
    headers: {
      origin,
      'sec-fetch-site': 'same-origin',
      'x-loom-request': '1',
      'content-type': 'application/json',
      'makers-conversation-id': conversationId,
      ...headers,
    },
    body: JSON.stringify(body),
    signal,
  });
function makers() {
  const messages = new Map();
  return {
    conversation_id: conversationId,
    store: {
      async getMessages({ conversationId: key, limit }) {
        return [...(messages.get(key) || [])].reverse().slice(0, limit);
      },
      async appendMessage(message) {
        const rows = messages.get(message.conversationId) || [];
        rows.push(message);
        messages.set(message.conversationId, rows);
        return `msg_${rows.length}`;
      },
    },
    messages,
  };
}
const gateway = (parts = ['欢迎', '来织界！']) =>
  new Response(
    parts
      .map((content) => `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\r\n\r\n`)
      .join('') + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
    { headers: { 'content-type': 'text/event-stream' } },
  );
const invoke = (chat, context, ownerId = 'visitor-a', signal) =>
  chat({
    request: request(undefined, {}, signal),
    body: { message: '我想逛农场' },
    ownerId,
    makers: context,
  });

test('Makers gateway streams text, persists history, and scopes it to the signed visitor', async () => {
  const calls = [];
  const chat = createHomeChat({
    config,
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      return gateway();
    },
  });
  const context = makers();
  const first = await invoke(chat, context);
  const text = await first.text();
  assert.equal(first.status, 200);
  assert.match(text, /event: delta/);
  assert.match(text, /欢迎/);
  assert.match(text, /event: done/);
  assert.equal(calls[0].url, 'https://ai-gateway.edgeone.link/v1/chat/completions');
  assert.equal(calls[0].body.model, '@makers/deepseek-v4-flash');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-only-key');
  assert.equal(calls[0].body.messages[0].role, 'system');
  assert.equal(calls[0].body.messages.at(-1).content, '我想逛农场');
  assert.equal(context.messages.size, 1);
  assert.notEqual([...context.messages.keys()][0], conversationId);
  assert.equal([...context.messages.values()][0].at(-1).content, '欢迎来织界！');
  await (await invoke(chat, context)).text();
  assert.equal(calls[1].body.messages.length, 4);
  await (await invoke(chat, context, 'visitor-b')).text();
  assert.equal(calls[2].body.messages.length, 2);
  assert.equal(context.messages.size, 2);
});

test('gateway errors and truncated streams are not retried or marked complete', async () => {
  for (const upstream of [
    new Response('private provider details', { status: 401 }),
    new Response('data: {"choices":[{"delta":{"content":"部分"}}]}\n\n', {
      headers: { 'content-type': 'text/event-stream' },
    }),
  ]) {
    let count = 0;
    const context = makers();
    const chat = createHomeChat({
      config,
      fetchImpl: async () => {
        count++;
        return upstream;
      },
    });
    const text = await (await invoke(chat, context)).text();
    assert.equal(count, 1);
    assert.match(text, /event: error/);
    assert.doesNotMatch(text, /event: done|private provider details|test-only-key/);
    assert.equal(context.messages.size, 0);
  }
});

test('disconnected clients cancel the gateway and do not save an incomplete response', async () => {
  const context = makers();
  let upstreamSignal;
  const chat = createHomeChat({
    config,
    fetchImpl: async (_, { signal }) => {
      upstreamSignal = signal;
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(
              new TextEncoder().encode('data: {"choices":[{"delta":{"content":"部分"}}]}\n\n'),
            );
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  const response = await invoke(chat, context);
  const reader = response.body.getReader();
  await reader.read();
  await reader.cancel();
  assert.equal(upstreamSignal.aborted, true);
  assert.equal(context.messages.size, 0);
});

test('disabled or missing native Makers context fails without contacting the gateway', async () => {
  const fetchImpl = () => {
    throw new Error('must not call gateway');
  };
  const disabled = createHomeChat({ config: { ...config, chatEnabled: false }, fetchImpl });
  assert.equal((await invoke(disabled, makers())).status, 503);
  const enabled = createHomeChat({ config, fetchImpl });
  assert.equal((await invoke(enabled, null)).status, 503);
});

test('guide route reuses session, same-origin policy, bounded body and conversation validation', async () => {
  const app = createApp({ config, store: createMemoryStore() });
  const bootstrap = await app.handle(
    new Request(`${origin}/api/v1/session/bootstrap`, {
      method: 'POST',
      headers: request().headers,
      body: '{}',
    }),
  );
  const cookie = bootstrap.headers.get('set-cookie').split(';')[0];
  assert.equal((await app.handle(request(), { makers: makers() })).status, 401);
  assert.equal(
    (
      await app.handle(request(undefined, { cookie, origin: 'https://evil.example' }), {
        makers: makers(),
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await app.handle(request(undefined, { cookie, 'makers-conversation-id': 'bad' }), {
        makers: makers(),
      })
    ).status,
    400,
  );
  assert.equal(
    (await app.handle(request({ message: 'x'.repeat(8200) }, { cookie }), { makers: makers() }))
      .status,
    413,
  );
  assert.equal(
    (
      await app.handle(request({ message: 'hi', ownerId: 'forged' }, { cookie }), {
        makers: makers(),
      })
    ).status,
    400,
  );
  assert.equal(
    (await app.handle(request({ message: '' }, { cookie }), { makers: makers() })).status,
    400,
  );
});

test('a failed second history write cannot inject an orphan question into the next turn', async () => {
  const context = makers();
  const append = context.store.appendMessage;
  let failWrite = true;
  context.store.appendMessage = async (message) => {
    if (message.role === 'assistant' && failWrite) {
      failWrite = false;
      throw new Error('store_unavailable');
    }
    return append(message);
  };
  const prompts = [];
  const chat = createHomeChat({
    config,
    fetchImpl: async (_, options) => {
      prompts.push(JSON.parse(options.body).messages);
      return gateway();
    },
  });
  assert.match(await (await invoke(chat, context)).text(), /event: error/);
  assert.match(await (await invoke(chat, context)).text(), /event: done/);
  assert.equal(prompts[1].length, 2);
});

test('the same conversation rejects overlapping turns and releases its lock after cancellation', async () => {
  const context = makers();
  let finish;
  const chat = createHomeChat({
    config,
    fetchImpl: (_, { signal }) =>
      new Promise((resolve, reject) => {
        finish = () => resolve(gateway());
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
  });
  const first = await invoke(chat, context);
  assert.equal((await invoke(chat, context)).status, 409);
  await first.body.cancel();
  await new Promise((resolve) => setImmediate(resolve));
  const next = await invoke(chat, context);
  assert.equal(next.status, 200);
  await new Promise((resolve) => setImmediate(resolve));
  finish();
  assert.match(await next.text(), /event: done/);
});

test('split UTF-8 gateway frames preserve Chinese, while oversized answers fail closed', async () => {
  const bytes = new TextEncoder().encode(await gateway(['你好，', '织界 🐼']).text());
  const split = new Response(
    new ReadableStream({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += 7)
          controller.enqueue(bytes.slice(offset, offset + 7));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
  const chat = createHomeChat({ config, fetchImpl: async () => split });
  const context = makers();
  await (await invoke(chat, context)).text();
  assert.equal([...context.messages.values()][0].at(-1).content, '你好，织界 🐼');
  const huge = createHomeChat({ config, fetchImpl: async () => gateway(['x'.repeat(16_001)]) });
  const empty = makers();
  assert.match(await (await invoke(huge, empty)).text(), /event: error/);
  assert.equal(empty.messages.size, 0);
});
