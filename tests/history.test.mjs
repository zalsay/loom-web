import assert from 'node:assert/strict';
import test from 'node:test';

import { createDefaultScene } from '../web/js/editor/document.js';
import { createHistory } from '../web/js/editor/history.js';
import { createDraftStore } from '../web/js/editor/persistence.js';

const setDoor = (doorState) => [{ op: 'set_environment', patch: { doorState } }];

class FakeTransaction {
  constructor(database, mode) {
    this.database = database;
    this.mode = mode;
    this.pending = 0;
    this.aborted = false;
    this.completeQueued = false;
    this.error = null;
  }

  objectStore(name) {
    if (name !== 'drafts') throw new Error('unknown object store');
    const records = this.database.records;
    const enqueue = (operation) => {
      this.pending++;
      queueMicrotask(() => {
        if (this.aborted) {
          this.pending--;
          return;
        }
        try {
          operation();
        } catch (error) {
          this.error = error;
          this.onerror?.();
          this.abort(error);
          return;
        }
        this.pending--;
        this.maybeComplete();
      });
    };
    return {
      get: (key) => {
        const request = {};
        enqueue(() => {
          request.result = records.get(key);
          request.onsuccess?.();
        });
        return request;
      },
      put: (entry) => {
        if (this.database.failPuts) throw new Error('QuotaExceededError: fake quota');
        const request = {};
        enqueue(() => {
          records.set(entry.key, entry);
          request.result = entry.key;
          request.onsuccess?.();
        });
        return request;
      },
      delete: (key) => {
        const request = {};
        enqueue(() => {
          records.delete(key);
          request.onsuccess?.();
        });
        return request;
      },
      openCursor: () => {
        const request = {};
        const entries = [...records.values()].sort((left, right) =>
          left.key.localeCompare(right.key),
        );
        let index = 0;
        const next = () =>
          enqueue(() => {
            if (index >= entries.length) {
              request.result = null;
            } else {
              const entry = entries[index];
              request.result = {
                value: entry,
                continue() {
                  index++;
                  next();
                },
              };
            }
            request.onsuccess?.();
          });
        next();
        return request;
      },
    };
  }

  abort(error) {
    if (this.aborted) return;
    this.aborted = true;
    this.error = error ?? this.error;
    queueMicrotask(() => this.onabort?.());
  }

  maybeComplete() {
    if (this.pending !== 0 || this.completeQueued || this.aborted) return;
    this.completeQueued = true;
    queueMicrotask(() => {
      this.completeQueued = false;
      if (this.pending === 0 && !this.aborted) this.oncomplete?.();
    });
  }
}

class FakeDatabase {
  constructor() {
    this.records = new Map();
    this.failPuts = false;
    const stores = new Set();
    this.objectStoreNames = { contains: (name) => stores.has(name) };
    this.createObjectStore = (name) => {
      stores.add(name);
      return {};
    };
  }

  transaction(_name, mode) {
    return new FakeTransaction(this, mode);
  }

  close() {}
}

class FakeIndexedDB {
  constructor() {
    this.database = new FakeDatabase();
  }

  open() {
    const request = {};
    queueMicrotask(() => {
      request.result = this.database;
      request.onupgradeneeded?.({ oldVersion: 0, newVersion: 1 });
      request.onsuccess?.();
    });
    return request;
  }
}

async function withIndexedDB(indexedDB, action) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  try {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: indexedDB,
    });
    return await action();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'indexedDB', descriptor);
    else delete globalThis.indexedDB;
  }
}

test('history records one atomic batch, supports undo/redo, and increments every successful transition', () => {
  const initial = createDefaultScene();
  const history = createHistory(initial);
  assert.equal(history.version, 0);
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, false);

  history.apply([
    { op: 'set_environment', patch: { doorState: 'open' } },
    { op: 'set_environment', patch: { skyPreset: 'dusk' } },
  ]);
  assert.equal(history.version, 1);
  assert.equal(history.scene.environment.doorState, 'open');
  assert.equal(history.scene.environment.skyPreset, 'dusk');
  assert.equal(history.canUndo, true);
  assert.equal(history.canRedo, false);

  history.undo();
  assert.equal(history.version, 2);
  assert.equal(history.scene.environment.doorState, 'closed');
  assert.equal(history.scene.environment.skyPreset, 'soft-afternoon');
  assert.equal(history.canRedo, true);

  history.redo();
  assert.equal(history.version, 3);
  assert.equal(history.scene.environment.doorState, 'open');
  assert.equal(history.scene.environment.skyPreset, 'dusk');
  assert.equal(history.canUndo, true);
});

test('failed apply/replace are atomic and do not advance version or history', () => {
  const history = createHistory(createDefaultScene());
  const before = history.scene;
  assert.throws(
    () =>
      history.apply([
        { op: 'set_environment', patch: { doorState: 'open' } },
        { op: 'remove_object', objectId: 'missing' },
      ]),
    /does not reference a personal object/,
  );
  assert.equal(history.version, 0);
  assert.equal(history.canUndo, false);
  assert.deepEqual(history.scene, before);

  assert.throws(() => history.replace({ schemaVersion: 1 }), /unknown field|is required/);
  assert.equal(history.version, 0);
  assert.deepEqual(history.scene, before);
});

test('scene getter and returned edit results cannot mutate internal state', () => {
  const history = createHistory(createDefaultScene());
  const returned = history.apply(setDoor('open'));
  returned.environment.doorState = 'closed';
  const read = history.scene;
  read.environment.doorState = 'closed';
  assert.equal(history.scene.environment.doorState, 'open');
  assert.equal(history.version, 1);
});

test('replace is an undoable edit; history limit bounds retained snapshots', () => {
  const first = createDefaultScene({ title: '第一版' });
  const second = createDefaultScene({ title: '第二版' });
  const third = createDefaultScene({ title: '第三版' });
  const history = createHistory(first, { limit: 1 });

  history.replace(second);
  history.replace(third);
  assert.equal(history.version, 2);
  history.undo();
  assert.equal(history.version, 3);
  assert.equal(history.scene.title, '第二版');
  assert.equal(history.canUndo, false);
  assert.equal(history.canRedo, true);
  history.redo();
  assert.equal(history.version, 4);
  assert.equal(history.scene.title, '第三版');
});

test('snapshot/restore persists undo state and advances beyond the restored version', () => {
  const source = createHistory(createDefaultScene());
  source.apply(setDoor('open'));
  source.apply([{ op: 'set_environment', patch: { skyPreset: 'dusk' } }]);
  const snapshot = source.snapshot();
  assert.equal(snapshot.historySchemaVersion, 1);
  assert.equal(snapshot.version, 2);
  assert.equal(snapshot.past.length, 2);

  const restored = createHistory(createDefaultScene());
  restored.restore(snapshot);
  assert.equal(restored.version, 3);
  assert.equal(restored.scene.environment.doorState, 'open');
  assert.equal(restored.scene.environment.skyPreset, 'dusk');
  assert.equal(restored.canUndo, true);
  restored.undo();
  assert.equal(restored.version, 4);
  assert.equal(restored.scene.environment.skyPreset, 'soft-afternoon');

  snapshot.scene.environment.doorState = 'closed';
  assert.equal(restored.scene.environment.doorState, 'open');
});

test('invalid restore is atomic and rejects stale version overflow and accessors', () => {
  const history = createHistory(createDefaultScene());
  history.apply(setDoor('open'));
  const before = history.snapshot();
  assert.throws(
    () => history.restore({ ...before, scene: { schemaVersion: 1 } }),
    /unknown field|is required/,
  );
  assert.equal(history.version, before.version);
  assert.deepEqual(history.scene, before.scene);

  assert.throws(
    () =>
      history.restore({
        ...before,
        version: Number.MAX_SAFE_INTEGER,
      }),
    /exhausted/,
  );
  assert.equal(history.version, before.version);
  assert.deepEqual(history.scene, before.scene);

  let called = false;
  const bad = { ...before };
  Object.defineProperty(bad, 'version', {
    enumerable: true,
    get() {
      called = true;
      return 50;
    },
  });
  assert.throws(() => history.restore(bad), /data property/);
  assert.equal(called, false);
  assert.equal(history.version, before.version);
});

test('history options are bounded', () => {
  assert.throws(() => createHistory(createDefaultScene(), { limit: 0 }), /between 1 and 1000/);
  assert.throws(() => createHistory(createDefaultScene(), { limit: 1001 }), /between 1 and 1000/);
});

test('draft store fails closed when IndexedDB is unavailable', async () => {
  await withIndexedDB(undefined, async () => {
    await assert.rejects(createDraftStore(), /IndexedDB is unavailable/);
  });
});

test('draft store separates editor-session keys, lists prefixes, and reports quota errors', async () => {
  const indexedDB = new FakeIndexedDB();
  await withIndexedDB(indexedDB, async () => {
    const store = await createDraftStore();
    const first = { schemaVersion: 1, title: 'Tab A', scene: { objects: [] } };
    const second = { schemaVersion: 1, title: 'Tab B', scene: { objects: [] } };
    await store.save('draft:editor-a', first);
    await store.save('draft:editor-b', second);

    assert.equal((await store.load('draft:editor-a')).title, 'Tab A');
    assert.equal(await store.load('draft:missing'), null);
    assert.deepEqual(await store.list('draft:editor-a'), [{ key: 'draft:editor-a', value: first }]);
    assert.deepEqual(
      (await store.list()).map(({ key }) => key),
      ['draft:editor-a', 'draft:editor-b'],
    );
    await assert.rejects(store.save('draft:ownerId', first), /must not identify/);
    await assert.rejects(store.save('draft:editor-c', { accessToken: 'nope' }), /not allowed/);

    indexedDB.database.failPuts = true;
    await assert.rejects(store.save('draft:quota', first), /quota/i);
    indexedDB.database.failPuts = false;
    await store.remove('draft:editor-a');
    assert.equal(await store.load('draft:editor-a'), null);
    store.close();
    await assert.rejects(store.list(), /closed/);
  });
});
