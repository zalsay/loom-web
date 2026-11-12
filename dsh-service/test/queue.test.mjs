import test from 'node:test';
import assert from 'node:assert/strict';
import { FarmQueue } from '../src/queue.js';

function sequence(prefix) {
  let value = 0;
  return () => `${prefix}-${++value}`;
}

test('FarmQueue enforces request idempotency and per-child open limits', () => {
  const queue = new FarmQueue({
    randomId: sequence('case'),
    now: () => 1_000,
    maxOpenPerChild: 2,
  });
  const first = queue.enqueue({
    childId: 'child-a',
    plotId: 'plot-a',
    requestId: 'request-1',
    text: '叶子为什么黄了？',
  });
  const duplicate = queue.enqueue({
    childId: 'child-a',
    plotId: 'plot-a',
    requestId: 'request-1',
    text: '叶子为什么黄了？',
  });
  assert.deepEqual(duplicate, first);

  queue.enqueue({
    childId: 'child-a',
    plotId: 'plot-a',
    requestId: 'request-2',
    text: '土是不是太湿？',
  });
  assert.throws(
    () =>
      queue.enqueue({
        childId: 'child-a',
        plotId: 'plot-a',
        requestId: 'request-3',
        text: '还有第三个问题',
      }),
    (error) => error.code === 'queue_limit',
  );
});

test('FarmQueue claims one question per child and releases expired leases', () => {
  let now = 1_000;
  const queue = new FarmQueue({
    randomId: sequence('lease'),
    now: () => now,
    leaseMs: 100,
  });
  for (const [childId, requestId] of [
    ['child-a', 'a-1'],
    ['child-a', 'a-2'],
    ['child-b', 'b-1'],
  ]) {
    queue.enqueue({
      childId,
      plotId: `plot-${childId}`,
      requestId,
      text: `question ${requestId}`,
    });
  }

  const firstBatch = queue.claim('agent-1', { limit: 2 });
  assert.equal(firstBatch.length, 2);
  assert.equal(new Set(firstBatch.map((record) => record.childId)).size, 2);

  now = 1_101;
  const released = queue.releaseExpired(now);
  assert.equal(released.length, 2);
  assert.ok(released.every((record) => record.status === 'waiting'));

  const secondBatch = queue.claim('agent-1', { limit: 2 });
  assert.equal(secondBatch.length, 2);
  assert.ok(secondBatch.every((record) => record.status === 'processing'));
});

test('FarmQueue does not claim a second case while a child already has one processing', () => {
  const queue = new FarmQueue({ randomId: sequence('busy'), now: () => 10 });
  for (const requestId of ['a-1', 'a-2']) {
    queue.enqueue({
      childId: 'child-a',
      plotId: 'plot-a',
      requestId,
      text: `question ${requestId}`,
    });
  }

  assert.equal(queue.claim('agent-1').length, 1);
  assert.equal(queue.claim('agent-2').length, 0);
});

test('FarmQueue rejects stale completions and keeps child ownership', () => {
  const queue = new FarmQueue({ randomId: sequence('id'), now: () => 10 });
  const record = queue.enqueue({
    childId: 'child-a',
    plotId: 'plot-a',
    requestId: 'request-a',
    text: '叶子为什么卷起来？',
  });
  const [claimed] = queue.claim('agent-1');
  assert.throws(
    () =>
      queue.complete(record.caseId, {
        leaseId: 'wrong',
        answer: { childFacingText: 'test' },
      }),
    (error) => error.code === 'stale_lease',
  );
  assert.throws(
    () => queue.replyFromChild(record.caseId, { childId: 'child-b', text: 'hello' }),
    (error) => error.code === 'not_owner',
  );
  const completed = queue.complete(record.caseId, {
    leaseId: claimed.leaseId,
    outcome: 'needs_child',
    answer: { childFacingText: '你看到的是上面还是下面的叶子？' },
  });
  assert.equal(completed.status, 'needs_child');
});
