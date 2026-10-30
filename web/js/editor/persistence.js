const DB_NAME = 'loom-space-drafts';
const DB_VERSION = 1;
const STORE_NAME = 'drafts';
const MAX_KEY_LENGTH = 256;
const MAX_DATA_DEPTH = 80;
const FORBIDDEN_KEY =
  /cookie|token|secret|authorization|credential|visitor.*id|owner.*id|api.?key/i;

function failure(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.name = 'DraftStoreError';
  return error;
}

function validateKey(key, { allowEmpty = false } = {}) {
  if (typeof key !== 'string' || (!allowEmpty && key.length === 0) || key.length > MAX_KEY_LENGTH) {
    throw new TypeError(
      `draft key must be a ${allowEmpty ? 'string' : 'non-empty string'} of at most ${MAX_KEY_LENGTH} characters`,
    );
  }
  if (/[\u0000-\u001f\u007f]/u.test(key))
    throw new TypeError('draft key must not contain control characters');
  if (FORBIDDEN_KEY.test(key))
    throw new TypeError('draft key must not identify a credential or owner');
  return key;
}

function validateJsonValue(value, path = 'record', ancestors = new Set(), depth = 0) {
  if (depth > MAX_DATA_DEPTH) throw new TypeError(`${path} exceeds the maximum data depth`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`${path} must contain only finite numbers`);
    return;
  }
  if (typeof value !== 'object')
    throw new TypeError(`${path} must contain JSON-compatible data only`);
  if (ancestors.has(value)) throw new TypeError(`${path} must not contain cycles`);
  ancestors.add(value);

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      throw new TypeError(`${path} must contain standard arrays only`);
    }
    for (const key of Reflect.ownKeys(value)) {
      if (key === 'length') continue;
      if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
        throw new TypeError(`${path} must not contain extra or symbol array properties`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw new TypeError(`${path}[${key}] must be an enumerable data item`);
      }
    }
    for (let index = 0; index < value.length; index++) {
      if (!Object.prototype.hasOwnProperty.call(value, index))
        throw new TypeError(`${path}[${index}] must not be missing`);
      validateJsonValue(value[index], `${path}[${index}]`, ancestors, depth + 1);
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${path} must contain plain objects only`);
    }
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') throw new TypeError(`${path} must not contain symbol keys`);
      if (
        key === '__proto__' ||
        key === 'prototype' ||
        key === 'constructor' ||
        FORBIDDEN_KEY.test(key)
      ) {
        throw new TypeError(`${path}.${key} is not allowed in a local draft record`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        throw new TypeError(`${path}.${key} must be an enumerable data property`);
      }
      validateJsonValue(descriptor.value, `${path}.${key}`, ancestors, depth + 1);
    }
  }
  ancestors.delete(value);
}

function encodeRecord(record) {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) {
    throw new TypeError('draft record must be a plain object');
  }
  validateJsonValue(record);
  try {
    const json = JSON.stringify(record);
    if (typeof json !== 'string') throw new TypeError('draft record did not serialize');
    return json;
  } catch (error) {
    throw failure('draft record could not be serialized', error);
  }
}

function decodeEntry(entry, key) {
  if (entry === undefined) return null;
  if (!entry || entry.key !== key || typeof entry.json !== 'string') {
    throw failure('stored draft record is malformed');
  }
  let value;
  try {
    value = JSON.parse(entry.json);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new TypeError('stored draft record must be an object');
    }
    validateJsonValue(value);
  } catch (error) {
    throw failure('stored draft record is invalid', error);
  }
  return value;
}

function openDatabase(indexedDB) {
  return new Promise((resolve, reject) => {
    let request;
    let settled = false;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (error) {
      reject(failure('IndexedDB could not be opened', error));
      return;
    }

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onerror = () => {
      if (settled) return;
      settled = true;
      reject(failure('IndexedDB could not be opened', request.error));
    };
    request.onblocked = () => {
      if (settled) return;
      settled = true;
      reject(failure('IndexedDB upgrade is blocked by another open tab'));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (settled) {
        database.close();
        return;
      }
      settled = true;
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

function transact(database, mode, run) {
  return new Promise((resolve, reject) => {
    let transaction;
    let result;
    let operationError;
    let settled = false;
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    try {
      transaction = database.transaction(STORE_NAME, mode);
    } catch (error) {
      reject(failure('IndexedDB transaction could not be started', error));
      return;
    }
    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    transaction.onerror = () => {
      rejectOnce(failure('IndexedDB transaction failed', operationError ?? transaction.error));
    };
    transaction.onabort = () => {
      rejectOnce(failure('IndexedDB transaction was aborted', operationError ?? transaction.error));
    };
    try {
      run(
        transaction.objectStore(STORE_NAME),
        (value) => {
          result = value;
        },
        (error) => {
          operationError = error;
          try {
            transaction.abort();
          } catch {
            // The transaction may already be aborting; preserve the original error.
          }
          rejectOnce(error);
        },
      );
    } catch (error) {
      operationError = error;
      try {
        transaction.abort();
      } catch {
        // Preserve the synchronous request/setup failure below.
      }
      rejectOnce(error);
    }
  });
}

export async function createDraftStore() {
  let indexedDB;
  try {
    indexedDB = globalThis.indexedDB;
  } catch (error) {
    throw failure('IndexedDB is unavailable; local drafts cannot be persisted', error);
  }
  if (!indexedDB?.open) throw failure('IndexedDB is unavailable; local drafts cannot be persisted');

  const database = await openDatabase(indexedDB);
  let closed = false;
  const ensureOpen = () => {
    if (closed) throw failure('draft store is closed');
  };

  return {
    async load(key) {
      ensureOpen();
      validateKey(key);
      return transact(database, 'readonly', (store, setResult, abort) => {
        const request = store.get(key);
        request.onsuccess = () => {
          try {
            setResult(decodeEntry(request.result, key));
          } catch (error) {
            abort(error);
          }
        };
      });
    },
    async save(key, record) {
      ensureOpen();
      validateKey(key);
      const json = encodeRecord(record);
      return transact(database, 'readwrite', (store) => {
        store.put({ key, json });
      });
    },
    async remove(key) {
      ensureOpen();
      validateKey(key);
      return transact(database, 'readwrite', (store) => {
        store.delete(key);
      });
    },
    async list(prefix = '') {
      ensureOpen();
      validateKey(prefix, { allowEmpty: true });
      return transact(database, 'readonly', (store, setResult, abort) => {
        const matches = [];
        const request = store.openCursor();
        request.onsuccess = () => {
          try {
            const cursor = request.result;
            if (!cursor) {
              matches.sort((left, right) =>
                left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
              );
              setResult(matches);
              return;
            }
            const entry = cursor.value;
            if (typeof entry?.key !== 'string' || typeof entry?.json !== 'string') {
              throw failure('stored draft entry is malformed');
            }
            validateKey(entry.key);
            if (entry.key.startsWith(prefix)) {
              matches.push({ key: entry.key, value: decodeEntry(entry, entry.key) });
            }
            cursor.continue();
          } catch (error) {
            abort(error);
          }
        };
      });
    },
    close() {
      if (closed) return;
      closed = true;
      database.close();
    },
  };
}
