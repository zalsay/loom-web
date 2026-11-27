import test from 'node:test';
import assert from 'node:assert/strict';
import { createDuckBridge, duckChat, intents } from '../flashduck/bridge.mjs';
import { startMockDuck } from '../flashduck/mock-peer.mjs';
const token = 'only-for-local-test';
async function setup(t, options) {
  const s = createDuckBridge({ token, cooldownMs: 0, ...options });
  await new Promise((r) => s.listen(0, '127.0.0.1', r));
  t.after(() => {
    s.closeAllConnections();
    s.close();
  });
  const origin = `http://127.0.0.1:${s.address().port}/v1/duck/commands`;
  return {
    post: (data, cred = token) =>
      fetch(origin, {
        method: 'POST',
        headers: { Authorization: `Bearer ${cred}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      }),
    get: (id) =>
      fetch(`${origin}/${id}`, { headers: { Authorization: `Bearer ${token}` } }).then((r) =>
        r.json(),
      ),
  };
}
const body = { requestId: 't1', duckId: 'duck-1', action: 'look_left' };
test('Pad HTTP goes over actual loopback WebSocket to a stock-shaped chat peer; response is not motion evidence', async (t) => {
  const peer = await startMockDuck();
  t.after(peer.close);
  const { post, get } = await setup(t, { send: duckChat(peer.url) });
  const res = await post(body);
  assert.equal(res.status, 202);
  assert.equal((await res.json()).status, 'accepted');
  let row;
  for (let i = 0; i < 40; i++) {
    row = await get('t1');
    if (row.status !== 'accepted') break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(row.status, 'replied');
  assert.equal(row.motionVerified, false);
  assert.equal(peer.frames.length, 1);
  assert.deepEqual(peer.frames[0], {
    type: 'message',
    chat_id: peer.frames[0].chat_id,
    content: intents.look_left,
  });
  assert.match(peer.frames[0].chat_id, /^loom_[0-9a-f]{20}$/);
  assert.equal((await post(body)).status, 200);
  assert.equal(peer.frames.length, 1);
});
test('rejects bad token, wrong duck, locomotion without opt-in, arbitrary text, ID collision and concurrent actions', async (t) => {
  let finish,
    n = 0;
  const { post } = await setup(t, {
    send: () => {
      n++;
      return new Promise((r) => {
        finish = r;
      });
    },
  });
  assert.equal((await post(body, 'bad')).status, 401);
  assert.equal((await post({ ...body, duckId: 'other' })).status, 403);
  assert.equal((await post({ ...body, action: 'walk_step' })).status, 403);
  assert.equal((await post({ ...body, content: 'free text' })).status, 400);
  assert.equal((await post({ ...body, action: 'servo_sequences' })).status, 400);
  assert.equal((await post(body)).status, 202);
  assert.equal((await post(body)).status, 200);
  assert.equal((await post({ ...body, action: 'look_right' })).status, 409);
  assert.equal((await post({ ...body, requestId: 'another' })).status, 409);
  finish('unknown');
  await new Promise((r) => setImmediate(r));
  assert.equal((await post({ ...body, requestId: 'after_loss' })).status, 409);
  assert.equal(n, 1);
});
test('only matching final response counts; token, wrong chat and disconnect after send never acknowledge motion', async () => {
  let count = 0;
  class MockSocket extends EventTarget {
    constructor() {
      super();
      queueMicrotask(() => this.dispatchEvent(new Event('open')));
    }
    send(frame) {
      count++;
      const { chat_id } = JSON.parse(frame);
      for (const m of [
        { type: 'response', chat_id: 'other' },
        { type: 'token', chat_id },
      ])
        this.dispatchEvent(
          new MessageEvent('message', { data: JSON.stringify({ ...m, content: 'hello' }) }),
        );
      this.dispatchEvent(new Event('close'));
    }
    close() {}
  }
  assert.equal(
    await duckChat('ws://127.0.0.1:18789/ws', { Socket: MockSocket })('stop'),
    'unknown',
  );
  assert.equal(count, 1);
});
