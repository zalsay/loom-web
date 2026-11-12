import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentWaker } from '../src/agent-waker.js';

test('AgentWaker coalesces queued requests until the agent becomes idle', async () => {
  let sends = 0;
  const waker = new AgentWaker({ send: () => (sends += 1) });

  assert.equal(waker.request(), true);
  assert.equal(waker.request(), false);
  assert.equal(waker.request(), false);
  assert.equal(waker.snapshot().pending, true);
  await Promise.resolve();
  assert.equal(sends, 1);

  waker.setRunning(false);
  await Promise.resolve();
  assert.equal(sends, 2);
  assert.deepEqual(waker.snapshot(), { running: true, pending: false, sentCount: 2 });
});
