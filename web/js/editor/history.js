import { applyOperations, validateSceneDocument } from './document.js';

const HISTORY_SCHEMA_VERSION = 1;
const cloneScene = (value) => validateSceneDocument(value);

function nextVersion(value) {
  if (value >= Number.MAX_SAFE_INTEGER) throw new RangeError('history version is exhausted');
  return value + 1;
}

function readSceneStack(value, path) {
  if (!Array.isArray(value) || value.length > 1000) {
    throw new TypeError(`${path} must be an array with at most 1000 entries`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
      throw new TypeError(`${path} must not have extra properties`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new TypeError(`${path}[${key}] must be an enumerable data item`);
    }
  }
  const result = [];
  for (let index = 0; index < value.length; index++) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) {
      throw new TypeError(`${path}[${index}] must not be missing`);
    }
    result.push(validateSceneDocument(value[index]));
  }
  return result;
}

function validateSnapshot(value, path = 'history snapshot') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object`);
  }
  const expected = ['historySchemaVersion', 'scene', 'version', 'past', 'future'];
  const keys = Reflect.ownKeys(value);
  if (
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    keys.some((key) => typeof key !== 'string' || !expected.includes(key)) ||
    expected.some((key) => !Object.prototype.hasOwnProperty.call(value, key))
  ) {
    throw new TypeError(`${path} has an invalid shape`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
      throw new TypeError(`${path}.${key} must be an enumerable data property`);
    }
  }
  const read = (key) => Object.getOwnPropertyDescriptor(value, key).value;
  if (read('historySchemaVersion') !== HISTORY_SCHEMA_VERSION) {
    throw new TypeError(`${path} has an unsupported schema version`);
  }
  if (!Number.isSafeInteger(read('version')) || read('version') < 0) {
    throw new TypeError(`${path}.version must be a non-negative safe integer`);
  }
  const past = readSceneStack(read('past'), `${path}.past`);
  const future = readSceneStack(read('future'), `${path}.future`);
  return {
    historySchemaVersion: HISTORY_SCHEMA_VERSION,
    scene: validateSceneDocument(read('scene')),
    version: read('version'),
    past,
    future,
  };
}

export function createHistory(sceneValue, { limit = 100 } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
    throw new RangeError('history limit must be an integer between 1 and 1000');
  }

  let scene = validateSceneDocument(sceneValue);
  let version = 0;
  let past = [];
  let future = [];

  function snapshot() {
    return {
      historySchemaVersion: HISTORY_SCHEMA_VERSION,
      scene: cloneScene(scene),
      version,
      past: past.map(cloneScene),
      future: future.map(cloneScene),
    };
  }

  function restore(value) {
    const restored = validateSnapshot(value);
    const restoredVersion = nextVersion(Math.max(version, restored.version));
    scene = restored.scene;
    past = restored.past.slice(-limit);
    future = restored.future.slice(-limit);
    // A restored history may come from an older tab. Never reuse its draft version.
    version = restoredVersion;
    return cloneScene(scene);
  }

  return {
    get scene() {
      return cloneScene(scene);
    },
    get version() {
      return version;
    },
    get canUndo() {
      return past.length > 0;
    },
    get canRedo() {
      return future.length > 0;
    },
    apply(operations) {
      const nextScene = applyOperations(scene, operations);
      const next = nextVersion(version);
      past.push(scene);
      if (past.length > limit) past.shift();
      scene = nextScene;
      future = [];
      version = next;
      return cloneScene(scene);
    },
    replace(nextSceneValue) {
      const nextScene = validateSceneDocument(nextSceneValue);
      const next = nextVersion(version);
      past.push(scene);
      if (past.length > limit) past.shift();
      scene = nextScene;
      future = [];
      version = next;
      return cloneScene(scene);
    },
    undo() {
      if (!past.length) return cloneScene(scene);
      const next = nextVersion(version);
      future.push(scene);
      if (future.length > limit) future.shift();
      scene = past.pop();
      version = next;
      return cloneScene(scene);
    },
    redo() {
      if (!future.length) return cloneScene(scene);
      const next = nextVersion(version);
      past.push(scene);
      if (past.length > limit) past.shift();
      scene = future.pop();
      version = next;
      return cloneScene(scene);
    },
    snapshot,
    restore,
  };
}
