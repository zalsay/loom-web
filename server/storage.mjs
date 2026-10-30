import { constants, mkdirSync, lstatSync, realpathSync } from 'node:fs';
import { mkdir, readdir, link, open, lstat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export class ImmutableKeyConflictError extends Error {
  constructor(key) {
    super(`Immutable object already has different bytes: ${key}`);
    this.name = 'ImmutableKeyConflictError';
    this.code = 'IMMUTABLE_KEY_CONFLICT';
  }
}

export function canonicalJson(value) {
  const seen = new Set();
  const normalize = (item) => {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new TypeError('Only finite JSON numbers are supported');
      return Object.is(item, -0) ? 0 : item;
    }
    if (Array.isArray(item)) {
      if (seen.has(item)) throw new TypeError('Circular JSON value');
      for (const key of Reflect.ownKeys(item)) {
        if (key === 'length') continue;
        if (
          typeof key !== 'string' ||
          !/^(0|[1-9]\d*)$/.test(key) ||
          Number(key) >= item.length ||
          !Object.hasOwn(item, key)
        ) {
          throw new TypeError('Arrays must not contain holes or extra properties');
        }
      }
      seen.add(item);
      const result = [];
      for (let index = 0; index < item.length; index++) {
        if (!Object.hasOwn(item, index)) throw new TypeError('Arrays must not contain holes');
        result.push(normalize(item[index]));
      }
      seen.delete(item);
      return result;
    }
    if (
      typeof item === 'object' &&
      [Object.prototype, null].includes(Object.getPrototypeOf(item))
    ) {
      if (seen.has(item)) throw new TypeError('Circular JSON value');
      seen.add(item);
      const result = Object.create(null);
      for (const key of Object.keys(item).sort()) {
        if (item[key] === undefined) throw new TypeError('Undefined is not JSON');
        result[key] = normalize(item[key]);
      }
      seen.delete(item);
      return result;
    }
    throw new TypeError('Value is not JSON-serializable');
  };
  return JSON.stringify(normalize(value));
}

function validateKey(key, { prefix = false } = {}) {
  if (
    typeof key !== 'string' ||
    key.length > 512 ||
    key.startsWith('/') ||
    key.includes('\\') ||
    key.includes('\0')
  ) {
    throw new TypeError('Invalid storage key');
  }
  if (key === '' && prefix) return key;
  const parts = key.split('/');
  if (prefix && parts.at(-1) === '') parts.pop();
  if (
    !parts.length ||
    parts.length > 32 ||
    parts.some(
      (part) => !part || part === '.' || part === '..' || !/^[A-Za-z0-9._-]{1,160}$/.test(part),
    )
  ) {
    throw new TypeError('Invalid storage key');
  }
  return key;
}

function decodeJson(text, key) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Stored JSON is invalid for key ${key}`);
  }
}

function isPreconditionFailed(error) {
  return (
    error?.name === 'PreconditionFailedError' ||
    error?.code === 'PRECONDITION_FAILED' ||
    error?.status === 412 ||
    error?.statusCode === 412
  );
}

export function createMemoryStore() {
  const values = new Map();
  return {
    async get(key) {
      validateKey(key);
      const bytes = values.get(key);
      return bytes === undefined ? null : decodeJson(bytes, key);
    },
    async put(key, value) {
      validateKey(key);
      const bytes = canonicalJson(value);
      const existing = values.get(key);
      if (existing !== undefined && existing !== bytes) throw new ImmutableKeyConflictError(key);
      values.set(key, bytes);
    },
    async list(prefix = '') {
      validateKey(prefix, { prefix: true });
      return [...values.keys()].filter((key) => key.startsWith(prefix)).sort();
    },
  };
}

function filePath(root, key) {
  validateKey(key);
  return path.join(root, ...key.split('/')) + '.json';
}

async function ensureSafeParent(root, key) {
  const parentParts = key.split('/').slice(0, -1);
  let current = root;
  for (const part of parentParts) {
    current = path.join(current, part);
    try {
      await mkdir(current, { mode: 0o700 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe storage directory');
  }
}

async function readFileBytes(root, key) {
  await verifySafeParents(root, key);
  const file = filePath(root, key);
  try {
    const info = await lstat(file);
    if (info.isSymbolicLink() || !info.isFile()) throw new Error('Unsafe storage object');
    const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const openedInfo = await handle.stat();
      if (!openedInfo.isFile()) throw new Error('Unsafe storage object');
      return await handle.readFile('utf8');
    } finally {
      await handle.close();
    }
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    if (error.code === 'ELOOP') throw new Error('Unsafe storage object');
    throw error;
  }
}

async function verifySafeParents(root, key) {
  let current = root;
  for (const part of key.split('/').slice(0, -1)) {
    current = path.join(current, part);
    try {
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe storage directory');
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
  }
}

export function createFileStore(directory) {
  if (typeof directory !== 'string' || !directory)
    throw new TypeError('A storage directory is required');
  const requestedRoot = path.resolve(directory);
  mkdirSync(requestedRoot, { recursive: true, mode: 0o700 });
  const rootStat = lstatSync(requestedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink())
    throw new TypeError('Storage root must be a real directory');
  const root = realpathSync(requestedRoot);

  return {
    async get(key) {
      validateKey(key);
      const text = await readFileBytes(root, key);
      return text === null ? null : decodeJson(text, key);
    },
    async put(key, value) {
      validateKey(key);
      const bytes = canonicalJson(value);
      await ensureSafeParent(root, key);
      const destination = filePath(root, key);
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        const handle = await open(temporary, 'wx', 0o600);
        try {
          await handle.writeFile(bytes, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        await link(temporary, destination);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = await readFileBytes(root, key);
        if (existing !== bytes) throw new ImmutableKeyConflictError(key);
      } finally {
        await unlink(temporary).catch(() => {});
      }
    },
    async list(prefix = '') {
      validateKey(prefix, { prefix: true });
      const keys = [];
      const visit = async (directoryPath, relativeParts) => {
        let entries;
        try {
          entries = await readdir(directoryPath, { withFileTypes: true });
        } catch (error) {
          if (error.code === 'ENOENT') return;
          throw error;
        }
        for (const entry of entries) {
          if (entry.isSymbolicLink()) continue;
          const currentParts = [...relativeParts, entry.name];
          const absolute = path.join(directoryPath, entry.name);
          if (entry.isDirectory()) {
            await visit(absolute, currentParts);
          } else if (entry.isFile() && entry.name.endsWith('.json')) {
            const finalPart = entry.name.slice(0, -5);
            if (!finalPart) continue;
            const key = [...relativeParts, finalPart].join('/');
            if (key.startsWith(prefix)) keys.push(key);
          }
        }
      };
      await visit(root, []);
      return keys.sort();
    },
  };
}

export function createEdgeOneBlobStore({ store, storeName, loadSdk } = {}) {
  let storePromise = store ? Promise.resolve(store) : null;
  const getStore = async () => {
    if (!storePromise) {
      storePromise = (async () => {
        const sdk = await (loadSdk ? loadSdk() : import('@edgeone/pages-blob'));
        return sdk.getStore(storeName || process.env.LOOM_BLOB_STORE || 'loom-space-private');
      })();
    }
    return storePromise;
  };
  const pending = new Map();
  const serializedPut = (key, work) => {
    const previous = pending.get(key) || Promise.resolve();
    const next = previous.then(work, work);
    pending.set(key, next);
    return next.finally(() => {
      if (pending.get(key) === next) pending.delete(key);
    });
  };

  return {
    async get(key) {
      validateKey(key);
      const blob = await getStore();
      const text = await blob.get(key, { type: 'text', consistency: 'strong' });
      return text === null ? null : decodeJson(String(text), key);
    },
    async put(key, value) {
      validateKey(key);
      const bytes = canonicalJson(value);
      return serializedPut(key, async () => {
        const blob = await getStore();
        const existing = await blob.get(key, { type: 'text', consistency: 'strong' });
        if (existing !== null) {
          if (String(existing) !== bytes) throw new ImmutableKeyConflictError(key);
          return;
        }
        // onlyIfNew makes this an atomic create-only write for one key. This is not a
        // general compare-and-swap primitive, global lock, or cross-request budget.
        try {
          await blob.set(key, bytes, { onlyIfNew: true });
        } catch (error) {
          if (!isPreconditionFailed(error)) throw error;
          const concurrent = await blob.get(key, { type: 'text', consistency: 'strong' });
          if (concurrent === bytes) return;
          if (concurrent !== null) throw new ImmutableKeyConflictError(key);
          throw error;
        }
        const confirmed = await blob.get(key, { type: 'text', consistency: 'strong' });
        if (confirmed !== bytes) {
          if (confirmed !== null) throw new ImmutableKeyConflictError(key);
          throw new Error('Blob write was not strongly confirmed');
        }
      });
    },
    async list(prefix = '') {
      validateKey(prefix, { prefix: true });
      const blob = await getStore();
      const keys = [];
      const seen = new Set();
      let cursor;
      do {
        const page = await blob.list({
          prefix,
          consistency: 'strong',
          paginate: false,
          ...(cursor ? { cursor } : {}),
        });
        for (const entry of page.blobs || []) {
          if (typeof entry?.key === 'string' && entry.key.startsWith(prefix)) keys.push(entry.key);
        }
        cursor = page.cursor;
        if (cursor && seen.has(cursor)) throw new Error('Blob list pagination cursor repeated');
        if (cursor) seen.add(cursor);
      } while (cursor);
      return [...new Set(keys)].sort();
    },
  };
}
