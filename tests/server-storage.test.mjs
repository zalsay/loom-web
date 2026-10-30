import test from 'node:test';
import assert from 'node:assert/strict';
import { PreconditionFailedError } from '@edgeone/pages-blob';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createEdgeOneBlobStore,
  createFileStore,
  createMemoryStore,
  ImmutableKeyConflictError,
} from '../server/storage.mjs';

test('memory store has canonical immutable writes and sorted prefix listing', async () => {
  const store = createMemoryStore();
  await store.put('private/v1/a/item', { z: 2, a: { y: true, x: 1 } });
  await store.put('private/v1/a/item', { a: { x: 1, y: true }, z: 2 });
  assert.deepEqual(await store.get('private/v1/a/item'), { a: { x: 1, y: true }, z: 2 });
  await assert.rejects(store.put('private/v1/a/item', { a: 3 }), ImmutableKeyConflictError);
  await store.put('private/v1/a/other', { ok: true });
  await store.put('private/v1/b/other', { ok: true });
  assert.deepEqual(await store.list('private/v1/a/'), ['private/v1/a/item', 'private/v1/a/other']);
  await assert.rejects(store.put('../outside', { bad: true }), /Invalid storage key/);
});

test('file store survives recreation and rejects replacement bytes without leaving temp files', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'loom-store-'));
  try {
    const first = createFileStore(directory);
    await first.put('private/v1/owner/revisions/rev_a', { second: 2, first: 1 });
    await first.put('private/v1/owner/revisions/rev_a', { first: 1, second: 2 });
    const second = createFileStore(directory);
    assert.deepEqual(await second.get('private/v1/owner/revisions/rev_a'), { first: 1, second: 2 });
    await assert.rejects(
      second.put('private/v1/owner/revisions/rev_a', { first: 99 }),
      ImmutableKeyConflictError,
    );
    assert.deepEqual(await second.list('private/v1/owner/'), ['private/v1/owner/revisions/rev_a']);
    assert.equal((await second.list('private/v1/other/')).length, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('EdgeOne Blob adapter uses strong reads and consumes every list cursor', async () => {
  const objects = new Map();
  const listCalls = [];
  const blob = {
    async get(key, options) {
      assert.deepEqual(options, { type: 'text', consistency: 'strong' });
      return objects.get(key) ?? null;
    },
    async set(key, value, options) {
      assert.deepEqual(options, { onlyIfNew: true });
      objects.set(key, value);
    },
    async list(options) {
      listCalls.push(options);
      const all = [...objects.keys()].filter((key) => key.startsWith(options.prefix)).sort();
      if (!options.cursor)
        return { blobs: all.slice(0, 1).map((key) => ({ key })), cursor: 'page-2' };
      return { blobs: all.slice(1).map((key) => ({ key })) };
    },
  };
  const store = createEdgeOneBlobStore({ store: blob });
  await store.put('private/v1/a/rev', { z: 2, a: 1 });
  await store.put('private/v1/a/rev', { a: 1, z: 2 });
  await assert.rejects(store.put('private/v1/a/rev', { a: 9 }), ImmutableKeyConflictError);
  await store.put('private/v1/b/rev', { b: true });
  assert.deepEqual(await store.get('private/v1/a/rev'), { a: 1, z: 2 });
  assert.deepEqual(await store.list('private/v1/'), ['private/v1/a/rev', 'private/v1/b/rev']);
  assert.equal(listCalls.length, 2);
  assert.ok(
    listCalls.every((options) => options.consistency === 'strong' && options.paginate === false),
  );
});

test('EdgeOne conditional immutable writes resolve cross-instance same-key races by strong read', async () => {
  const objects = new Map();
  let initialReads = 0;
  let releaseInitialReads;
  const bothInitialReads = new Promise((resolve) => {
    releaseInitialReads = resolve;
  });
  const blob = {
    async get(key, options) {
      assert.deepEqual(options, { type: 'text', consistency: 'strong' });
      if (key === 'private/v1/a/rev' && initialReads < 2) {
        initialReads++;
        if (initialReads === 2) releaseInitialReads();
        await bothInitialReads;
        return null;
      }
      return objects.get(key) ?? null;
    },
    async set(key, value, options) {
      assert.deepEqual(options, { onlyIfNew: true });
      if (options.onlyIfNew && objects.has(key)) throw new PreconditionFailedError();
      objects.set(key, value);
    },
    async list() {
      return { blobs: [] };
    },
  };
  const firstInstance = createEdgeOneBlobStore({ store: blob });
  const secondInstance = createEdgeOneBlobStore({ store: blob });
  const outcomes = await Promise.allSettled([
    firstInstance.put('private/v1/a/rev', { content: 'first' }),
    secondInstance.put('private/v1/a/rev', { content: 'second' }),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
  const rejected = outcomes.find((outcome) => outcome.status === 'rejected');
  assert.ok(rejected.reason instanceof ImmutableKeyConflictError);
  const stored = JSON.parse(objects.get('private/v1/a/rev'));
  assert.ok(['first', 'second'].includes(stored.content));
  const retry = createEdgeOneBlobStore({ store: blob });
  await retry.put('private/v1/a/rev', stored);
});

test('EdgeOne conditional immutable writes treat concurrent identical bytes as idempotent', async () => {
  const objects = new Map();
  let initialReads = 0;
  let releaseInitialReads;
  const bothInitialReads = new Promise((resolve) => {
    releaseInitialReads = resolve;
  });
  const blob = {
    async get(key, options) {
      assert.deepEqual(options, { type: 'text', consistency: 'strong' });
      if (initialReads < 2) {
        initialReads++;
        if (initialReads === 2) releaseInitialReads();
        await bothInitialReads;
        return null;
      }
      return objects.get(key) ?? null;
    },
    async set(key, value, options) {
      assert.deepEqual(options, { onlyIfNew: true });
      if (objects.has(key)) {
        const error = new Error('already exists');
        error.name = 'PreconditionFailedError';
        error.code = 'PRECONDITION_FAILED';
        throw error;
      }
      objects.set(key, value);
    },
    async list() {
      return { blobs: [] };
    },
  };
  const payload = { content: 'same bytes' };
  const outcomes = await Promise.allSettled([
    createEdgeOneBlobStore({ store: blob }).put('private/v1/a/rev', payload),
    createEdgeOneBlobStore({ store: blob }).put('private/v1/a/rev', payload),
  ]);
  assert.ok(outcomes.every((outcome) => outcome.status === 'fulfilled'));
  assert.equal(objects.get('private/v1/a/rev'), JSON.stringify(payload));
});

test('EdgeOne conditional put also verifies a raw HTTP 412 before resolving an identical retry', async () => {
  const objects = new Map();
  let readCount = 0;
  const payload = { content: 'same bytes' };
  const bytes = JSON.stringify(payload);
  const blob = {
    async get(key, options) {
      assert.deepEqual(options, { type: 'text', consistency: 'strong' });
      readCount++;
      return objects.get(key) ?? null;
    },
    async set(key, value, options) {
      assert.deepEqual(options, { onlyIfNew: true });
      objects.set(key, value);
      const error = new Error('precondition failed');
      error.status = 412;
      throw error;
    },
    async list() {
      return { blobs: [] };
    },
  };
  await createEdgeOneBlobStore({ store: blob }).put('private/v1/a/rev', payload);
  assert.equal(readCount, 2);
  assert.equal(objects.get('private/v1/a/rev'), bytes);
});

test('EdgeOne conditional put propagates non-precondition SDK errors without readback', async () => {
  let readCount = 0;
  const blob = {
    async get() {
      readCount++;
      return null;
    },
    async set(key, value, options) {
      assert.deepEqual(options, { onlyIfNew: true });
      throw new Error('transport unavailable');
    },
    async list() {
      return { blobs: [] };
    },
  };
  const store = createEdgeOneBlobStore({ store: blob });
  await assert.rejects(store.put('private/v1/a/rev', { value: true }), /transport unavailable/);
  assert.equal(readCount, 1);
});
