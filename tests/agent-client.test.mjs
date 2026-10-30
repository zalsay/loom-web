import test from 'node:test';
import assert from 'node:assert/strict';
import { readEventStream } from '../web/js/agent-client.js';

function sse(chunks) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

test('SSE parser handles split UTF-8 frames, CRLF, heartbeats and duplicate IDs', async () => {
  const events = [];
  await readEventStream(
    sse([
      ': heartbeat\r\n\r\nid: unique-1\r\nevent: propo',
      'sal\r\ndata: {"name":"竹丛"}\r\n\r\nid: unique-1\nevent: proposal\ndata: {"name":"重复"}\n\n',
    ]),
    (event) => events.push(event),
  );
  assert.deepEqual(events, [{ type: 'proposal', id: 'unique-1', data: { name: '竹丛' } }]);
});

test('partial or malformed SSE payloads do not become proposals', async () => {
  const events = [];
  await readEventStream(sse(['event: proposal_ready\ndata: {"turnId":"incomplete"}']), (event) =>
    events.push(event),
  );
  assert.equal(events.length, 0);
  await assert.rejects(
    readEventStream(sse(['data: broken\n\n']), () => {}),
    /无法识别/,
  );
  await assert.rejects(
    readEventStream(sse(['data: {"data":"oversized"}\n\n']), () => {}, { maxBuffer: 8 }),
    /上限/,
  );
});

test('non-SSE server errors are not treated as an applied scene', async () => {
  await assert.rejects(
    readEventStream(new Response('{"message":"disabled"}', { status: 503 }), () => {}),
    /disabled/,
  );
});

test('SSE HTTP errors retain status and accept string error bodies', async () => {
  const response = new Response(JSON.stringify({ error: 'session_required' }), {
    status: 401,
    headers: { 'content-type': 'application/json' },
  });
  await assert.rejects(
    readEventStream(response, () => {}),
    (error) => {
      assert.equal(error.status, 401);
      assert.equal(error.code, 'session_required');
      assert.equal(error.message, 'session_required');
      return true;
    },
  );
});
