import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { applyOperations, validateSceneDocument } from '../web/js/editor/document.js';
import { canonicalJson, ImmutableKeyConflictError } from './storage.mjs';

const NO_STORE = 'private, no-store, max-age=0';
const MAX_JSON_DEPTH = 64;
const SOFT_WRITE_WINDOW_MS = 60_000;
const SOFT_WRITE_LIMIT_PER_MINUTE = 60;
const SOFT_MAX_SPACES_PER_VISITOR = 100;
const SOFT_MAX_REVISIONS_PER_VISITOR = 500;
const SOFT_LIMITER_MAX_VISITORS = 10_000;
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': NO_STORE,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};
const encoder = new TextEncoder();
const visitorIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const genericIdPattern = /^[A-Za-z0-9._-]{16,96}$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const conversationPattern = /^[A-Za-z0-9._-]{6,36}$/;
const editorPattern = /^[A-Za-z0-9._-]{8,80}$/;
const shareIdPattern = /^[A-Za-z0-9_-]{32,48}$/;
const operationNames = new Set([
  'set_environment',
  'set_material',
  'add_object',
  'move_object',
  'remove_object',
  'set_camera',
]);
const environmentFields = new Set([
  'skyPreset',
  'timeOfDay',
  'sunIntensity',
  'ambientIntensity',
  'doorState',
  'landscapeVisible',
]);

class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

function fail(status, code) {
  throw new ApiError(status, code);
}

function isRecord(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function onlyKeys(value, allowed, required = []) {
  if (!isRecord(value)) fail(400, 'invalid_request');
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(400, 'invalid_request');
  for (const key of required) if (!Object.hasOwn(value, key)) fail(400, 'invalid_request');
}

function rejectIdentityFields(value) {
  function visit(entry, depth) {
    if (depth > MAX_JSON_DEPTH) fail(400, 'invalid_request');
    if (Array.isArray(entry)) {
      for (const child of entry) visit(child, depth + 1);
    } else if (isRecord(entry)) {
      if (Object.hasOwn(entry, 'ownerId') || Object.hasOwn(entry, 'userId'))
        fail(400, 'invalid_request');
      for (const child of Object.values(entry)) visit(child, depth + 1);
    }
  }
  visit(value, 0);
}

function jsonResponse(status, value, extraHeaders = {}) {
  const headers = new Headers(JSON_HEADERS);
  for (const [key, headerValue] of Object.entries(extraHeaders)) headers.set(key, headerValue);
  return new Response(value === null ? null : JSON.stringify(value), { status, headers });
}

function noContent(status = 204) {
  return new Response(null, {
    status,
    headers: { 'cache-control': NO_STORE, 'x-content-type-options': 'nosniff' },
  });
}

function validateConfig(config) {
  try {
    const origin = new URL(config.origin);
    const local =
      origin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
    if (
      origin.origin !== config.origin ||
      origin.pathname !== '/' ||
      origin.search ||
      origin.hash ||
      origin.username ||
      origin.password
    )
      return 'origin';
    if (config.production ? origin.protocol !== 'https:' : !local) return 'origin';
    if (config.production && config.edgeRateLimitConfirmed !== true) return 'edge_rate_limit';
    if (typeof config.secret !== 'string' || Buffer.byteLength(config.secret) < 32) return 'secret';
    if (!/^[A-Za-z0-9_-]{1,24}$/.test(config.cookieKeyId || '')) return 'cookie_key_id';
    if (
      !Number.isSafeInteger(config.cookieTtlSeconds || 2_592_000) ||
      (config.cookieTtlSeconds || 2_592_000) < 60
    )
      return 'cookie_ttl';
    if (config.publicBaseUrl) {
      const publicUrl = new URL(config.publicBaseUrl);
      if (
        publicUrl.origin !== config.publicBaseUrl ||
        (config.production
          ? publicUrl.protocol !== 'https:'
          : !['http:', 'https:'].includes(publicUrl.protocol))
      )
        return 'public_origin';
    }
    return null;
  } catch {
    return 'config';
  }
}

function cookieName(production) {
  return production ? '__Host-loom-visitor' : 'loom-visitor';
}

function cookieValue(request, name) {
  const header = request.headers.get('cookie');
  if (!header) return null;
  let value = null;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    if (value !== null) return null;
    value = part.slice(index + 1).trim();
  }
  return value;
}

function hmac(secret, value) {
  return createHmac('sha256', secret).update(value).digest();
}

function signVisitor(visitorId, expiresAt, config) {
  const keyId = config.cookieKeyId || 'k1';
  const payload = `v1.${keyId}.${visitorId}.${expiresAt}`;
  const signature = hmac(config.secret, payload).toString('base64url');
  return `${payload}.${signature}`;
}

function verifyVisitor(request, config) {
  const token = cookieValue(request, cookieName(Boolean(config.production)));
  if (!token) return null;
  const parts = token.split('.');
  if (
    parts.length !== 5 ||
    parts[0] !== 'v1' ||
    !/^[A-Za-z0-9_-]{1,24}$/.test(parts[1]) ||
    !visitorIdPattern.test(parts[2]) ||
    !/^\d{1,12}$/.test(parts[3])
  )
    return null;
  const expiresAt = Number(parts[3]);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return null;
  const secret =
    parts[1] === config.cookieKeyId ? config.secret : config.previousSecrets?.[parts[1]];
  if (typeof secret !== 'string' || Buffer.byteLength(secret) < 32) return null;
  const payload = parts.slice(0, 4).join('.');
  const expected = hmac(secret, payload);
  let provided;
  try {
    provided = Buffer.from(parts[4], 'base64url');
  } catch {
    return null;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  return { visitorId: parts[2], expiresAt };
}

function cookieHeader(visitorId, expiresAt, config) {
  const name = cookieName(Boolean(config.production));
  const age = Math.max(0, expiresAt - Math.floor(Date.now() / 1000));
  const secure = config.production ? '; Secure' : '';
  return `${name}=${signVisitor(visitorId, expiresAt, config)}; Path=/; Max-Age=${age}; HttpOnly; SameSite=Lax${secure}`;
}

function requireWritePolicy(request, config) {
  if (request.headers.get('origin') !== config.origin) fail(403, 'origin_rejected');
  if (request.headers.get('x-loom-request') !== '1') fail(403, 'request_header_required');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite !== 'same-origin') fail(403, 'fetch_metadata_rejected');
}

async function readJson(request, maximumBytes) {
  const contentType = request.headers.get('content-type') || '';
  if (!/^application\/json(?:\s*;|$)/i.test(contentType)) fail(415, 'json_required');
  if (!request.body) fail(400, 'invalid_json');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel();
        fail(413, 'request_too_large');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    const value = JSON.parse(text);
    rejectIdentityFields(value);
    return value;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    fail(400, 'invalid_json');
  }
}

function requireOwner(request, config) {
  const identity = verifyVisitor(request, config);
  if (!identity) fail(401, 'session_required');
  return identity.visitorId;
}

function requireId(value) {
  if (typeof value !== 'string' || !genericIdPattern.test(value)) fail(400, 'invalid_id');
  return value;
}

function requireUuid(value) {
  if (typeof value !== 'string' || !uuidPattern.test(value)) fail(400, 'invalid_id');
  return value;
}

function requireEditorId(value) {
  if (typeof value !== 'string' || !editorPattern.test(value)) fail(400, 'invalid_editor_session');
  return value;
}

function requireConversationId(request) {
  const value = request.headers.get('makers-conversation-id');
  if (!value || !conversationPattern.test(value)) fail(400, 'invalid_conversation_id');
  return value;
}

function decodeRoute(pathname) {
  try {
    return pathname.split('/').map((part) => decodeURIComponent(part));
  } catch {
    fail(400, 'invalid_path');
  }
}

function requirePublicShareId(pathname, prefix) {
  const raw = pathname.slice(prefix.length);
  if (!raw || raw.includes('/')) fail(404, 'not_found');
  let shareId;
  try {
    shareId = decodeURIComponent(raw);
  } catch {
    fail(404, 'not_found');
  }
  if (!shareIdPattern.test(shareId)) fail(404, 'not_found');
  return shareId;
}

const ownerRoot = (ownerId) => `private/v1/${ownerId}`;
const spacesRoot = (ownerId) => `${ownerRoot(ownerId)}/spaces`;
const spaceRoot = (ownerId, spaceId) => `${spacesRoot(ownerId)}/${spaceId}`;
const revisionsPrefix = (ownerId, spaceId) => `${spaceRoot(ownerId, spaceId)}/revisions/`;
const revisionKey = (ownerId, spaceId, revisionId) =>
  `${revisionsPrefix(ownerId, spaceId)}${revisionId}`;
const conversationKey = (ownerId, conversationId) =>
  `${ownerRoot(ownerId)}/conversations/${conversationId}`;
const shareKey = (ownerId, spaceId, shareId) => `${spaceRoot(ownerId, spaceId)}/shares/${shareId}`;
const turnPrefix = (ownerId, spaceId, turnId) =>
  `${spaceRoot(ownerId, spaceId)}/agent-turns/${turnId}/`;
const turnEventsPrefix = (ownerId, spaceId, turnId) =>
  `${turnPrefix(ownerId, spaceId, turnId)}events/`;

function normalizeScene(scene) {
  try {
    const normalized = validateSceneDocument(scene);
    const bytes = encoder.encode(canonicalJson(normalized)).byteLength;
    if (bytes > 256 * 1024) fail(413, 'scene_too_large');
    return normalized;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    fail(400, 'invalid_scene');
  }
}

function revisionIdFor(saveAttemptId, parentRevisionId, canonicalScene) {
  const hash = createHash('sha256')
    .update(saveAttemptId)
    .update('\0')
    .update(parentRevisionId || '')
    .update('\0')
    .update(canonicalScene)
    .digest('base64url');
  return `rev_${hash}`;
}

async function readRevision(store, ownerId, spaceId, revisionId) {
  const value = await store.get(revisionKey(ownerId, spaceId, revisionId));
  if (!value) return null;
  if (
    !isRecord(value) ||
    value.type !== 'revision' ||
    value.revisionId !== revisionId ||
    value.spaceId !== spaceId
  )
    throw new Error('Stored revision envelope is invalid');
  const scene = normalizeScene(value.scene);
  if (
    value.parentRevisionId !== null &&
    (typeof value.parentRevisionId !== 'string' || !genericIdPattern.test(value.parentRevisionId))
  )
    throw new Error('Stored revision parent is invalid');
  if (typeof value.saveAttemptId !== 'string' || !genericIdPattern.test(value.saveAttemptId))
    throw new Error('Stored revision attempt is invalid');
  return {
    scene,
    revisionId,
    parentRevisionId: value.parentRevisionId,
    saveAttemptId: value.saveAttemptId,
  };
}

async function listRevisions(store, ownerId, spaceId) {
  const keys = await store.list(revisionsPrefix(ownerId, spaceId));
  const values = [];
  for (const key of keys) {
    const revisionId = key.slice(revisionsPrefix(ownerId, spaceId).length);
    if (!revisionId || revisionId.includes('/')) continue;
    const revision = await readRevision(store, ownerId, spaceId, revisionId);
    if (revision) values.push(revision);
  }
  return values.sort((left, right) => left.revisionId.localeCompare(right.revisionId));
}

function pageLimit(url, fallback = 25) {
  const raw = url.searchParams.get('limit');
  if (raw === null) return fallback;
  if (!/^\d{1,3}$/.test(raw)) fail(400, 'invalid_pagination');
  return Math.max(1, Math.min(100, Number(raw)));
}

function pageOffset(url) {
  const cursor = url.searchParams.get('cursor');
  if (cursor === null) return 0;
  if (!/^\d{1,9}$/.test(cursor)) fail(400, 'invalid_pagination');
  return Number(cursor);
}

function nextCursor(offset, length, total) {
  return offset + length < total ? String(offset + length) : null;
}

function isSafeOperations(operations) {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 32)
    fail(400, 'invalid_operations');
  for (const operation of operations) {
    if (!isRecord(operation) || !operationNames.has(operation.op)) fail(400, 'invalid_operations');
    switch (operation.op) {
      case 'set_environment':
        onlyKeys(operation, new Set(['op', 'patch']), ['op', 'patch']);
        if (
          !isRecord(operation.patch) ||
          !Object.keys(operation.patch).length ||
          Object.keys(operation.patch).some((key) => !environmentFields.has(key))
        )
          fail(400, 'invalid_operations');
        break;
      case 'set_material':
        onlyKeys(operation, new Set(['op', 'target', 'materialId']), [
          'op',
          'target',
          'materialId',
        ]);
        if (!isRecord(operation.target) || typeof operation.materialId !== 'string')
          fail(400, 'invalid_operations');
        if (operation.target.kind === 'template') {
          onlyKeys(operation.target, new Set(['kind', 'targetId', 'materialSlot']), [
            'kind',
            'targetId',
            'materialSlot',
          ]);
          if (
            typeof operation.target.targetId !== 'string' ||
            typeof operation.target.materialSlot !== 'string'
          )
            fail(400, 'invalid_operations');
        } else if (operation.target.kind === 'object') {
          onlyKeys(operation.target, new Set(['kind', 'objectId']), ['kind', 'objectId']);
          if (typeof operation.target.objectId !== 'string') fail(400, 'invalid_operations');
        } else fail(400, 'invalid_operations');
        break;
      case 'add_object':
        onlyKeys(operation, new Set(['op', 'id', 'assetId', 'name', 'transform', 'materialId']), [
          'op',
          'id',
          'assetId',
          'name',
          'transform',
          'materialId',
        ]);
        if (
          typeof operation.id !== 'string' ||
          typeof operation.assetId !== 'string' ||
          typeof operation.name !== 'string' ||
          !isRecord(operation.transform) ||
          typeof operation.materialId !== 'string'
        )
          fail(400, 'invalid_operations');
        break;
      case 'move_object':
        onlyKeys(operation, new Set(['op', 'objectId', 'transform']), [
          'op',
          'objectId',
          'transform',
        ]);
        if (typeof operation.objectId !== 'string' || !isRecord(operation.transform))
          fail(400, 'invalid_operations');
        break;
      case 'remove_object':
        onlyKeys(operation, new Set(['op', 'objectId']), ['op', 'objectId']);
        if (typeof operation.objectId !== 'string') fail(400, 'invalid_operations');
        break;
      case 'set_camera':
        onlyKeys(operation, new Set(['op', 'camera']), ['op', 'camera']);
        if (!isRecord(operation.camera)) fail(400, 'invalid_operations');
        break;
      default:
        fail(400, 'invalid_operations');
    }
  }
  return operations;
}

function stableShareId(ownerId, spaceId, revisionId, shareAttemptId) {
  return createHash('sha256')
    .update(canonicalJson({ ownerId, spaceId, revisionId, shareAttemptId }))
    .digest('base64url')
    .slice(0, 32);
}

function shareUrl(config, shareId) {
  const base = config.publicBaseUrl || config.origin;
  return new URL(`/api/v1/public/spaces/${shareId}`, base).toString();
}

function agentEnabled(config, provider) {
  return Boolean(
    config.agentEnabled &&
      provider &&
      (!config.production || config.providerBudgetConfirmed === true),
  );
}

function assertAgentReady(config, provider) {
  if (!agentEnabled(config, provider)) fail(503, 'agent_disabled');
}

function checkProviderRequestHash(existingEvents, requestHash) {
  const starts = existingEvents.filter((event) => event.name === 'turn_started');
  if (!starts.length) return false;
  if (starts.some((event) => event.requestHash === requestHash)) return true;
  fail(409, 'turn_id_conflict');
}

function sseFrame(event) {
  const data = JSON.stringify(event.data);
  return `id: ${event.eventId}\nevent: ${event.name}\ndata: ${data}\n\n`;
}

function readTurnStatus(events, ack) {
  if (ack) return 'applied';
  const names = new Set(events.map((event) => event.name));
  if (names.has('turn_cancelled') || names.has('cancel_requested')) return 'cancel_requested';
  if (names.has('turn_error') || names.has('error')) return 'failed';
  if (names.has('proposal_ready')) return 'proposal_ready';
  if (names.has('turn_started')) return 'running';
  return 'unknown';
}

export function createApp({ store, config, provider = null } = {}) {
  if (
    !store ||
    typeof store.get !== 'function' ||
    typeof store.put !== 'function' ||
    typeof store.list !== 'function'
  )
    throw new TypeError('A compatible store is required');
  if (!config || typeof config !== 'object')
    throw new TypeError('Explicit server config is required');
  const configError = validateConfig(config);
  const activeProvider = agentEnabled(config, provider) ? provider : null;
  const activeTurns = new Map();
  // Best-effort per-runtime smoothing only: EdgeOne instances do not share this state.
  const softWriteAttempts = new Map();
  const secretUnavailable = () => configError !== null;

  function enforceSoftWriteRateLimit(ownerId) {
    const now = Date.now();
    const limit =
      Number.isSafeInteger(config.softWriteLimitPerMinute) && config.softWriteLimitPerMinute > 0
        ? config.softWriteLimitPerMinute
        : SOFT_WRITE_LIMIT_PER_MINUTE;
    const attempts = (softWriteAttempts.get(ownerId) || []).filter(
      (timestamp) => timestamp > now - SOFT_WRITE_WINDOW_MS,
    );
    if (attempts.length >= limit) {
      softWriteAttempts.delete(ownerId);
      softWriteAttempts.set(ownerId, attempts);
      fail(429, 'soft_write_rate_limited');
    }
    attempts.push(now);
    softWriteAttempts.delete(ownerId);
    softWriteAttempts.set(ownerId, attempts);
    if (softWriteAttempts.size > SOFT_LIMITER_MAX_VISITORS) {
      const oldestOwner = softWriteAttempts.keys().next().value;
      if (oldestOwner !== undefined && oldestOwner !== ownerId)
        softWriteAttempts.delete(oldestOwner);
    }
  }

  async function enforceSoftRevisionLimits(ownerId, spaceId, revisionId) {
    const targetKey = revisionKey(ownerId, spaceId, revisionId);
    if (await store.get(targetKey)) return;
    const prefix = `${spacesRoot(ownerId)}/`;
    const keys = await store.list(prefix);
    const spaces = new Set();
    let revisions = 0;
    for (const key of keys) {
      if (!key.startsWith(prefix)) continue;
      const [storedSpaceId, kind, storedRevisionId, ...extra] = key.slice(prefix.length).split('/');
      if (!genericIdPattern.test(storedSpaceId || '')) continue;
      spaces.add(storedSpaceId);
      if (
        kind === 'revisions' &&
        genericIdPattern.test(storedRevisionId || '') &&
        extra.length === 0
      )
        revisions++;
    }
    const maxSpaces =
      Number.isSafeInteger(config.softMaxSpacesPerVisitor) && config.softMaxSpacesPerVisitor > 0
        ? config.softMaxSpacesPerVisitor
        : SOFT_MAX_SPACES_PER_VISITOR;
    const maxRevisions =
      Number.isSafeInteger(config.softMaxRevisionsPerVisitor) &&
      config.softMaxRevisionsPerVisitor > 0
        ? config.softMaxRevisionsPerVisitor
        : SOFT_MAX_REVISIONS_PER_VISITOR;
    if (!spaces.has(spaceId) && spaces.size >= maxSpaces) fail(429, 'soft_space_limit');
    if (revisions >= maxRevisions) fail(429, 'soft_revision_limit');
  }

  async function loadConversation(ownerId, conversationId, spaceId, editorSessionId) {
    const binding = await store.get(conversationKey(ownerId, conversationId));
    if (
      !binding ||
      binding.spaceId !== spaceId ||
      (editorSessionId && binding.editorSessionId !== editorSessionId)
    )
      fail(404, 'not_found');
    return binding;
  }

  async function loadTurnEvents(ownerId, spaceId, turnId) {
    const prefix = turnEventsPrefix(ownerId, spaceId, turnId);
    const keys = await store.list(prefix);
    const events = [];
    for (const key of keys) {
      const event = await store.get(key);
      if (event && event.turnId === turnId && event.spaceId === spaceId) events.push(event);
    }
    return events.sort(
      (left, right) =>
        String(left.createdAt).localeCompare(String(right.createdAt)) ||
        left.eventId.localeCompare(right.eventId),
    );
  }

  async function appendTurnEvent({
    ownerId,
    spaceId,
    turnId,
    conversationId,
    executionId,
    sequence,
    name,
    data,
    requestHash,
  }) {
    const eventId = `${executionId}_${String(sequence).padStart(4, '0')}`;
    const event = {
      eventId,
      executionId,
      sequence,
      name,
      createdAt: new Date().toISOString(),
      turnId,
      spaceId,
      conversationId,
      ...(requestHash ? { requestHash } : {}),
      data,
    };
    await store.put(`${turnEventsPrefix(ownerId, spaceId, turnId)}${eventId}`, event);
    return event;
  }

  async function hasCancelRequest(ownerId, spaceId, turnId) {
    const events = await loadTurnEvents(ownerId, spaceId, turnId);
    return events.some((event) => event.name === 'cancel_requested');
  }

  async function authorizedTurn(request, ownerId, spaceId, turnId) {
    const conversationId = requireConversationId(request);
    const events = await loadTurnEvents(ownerId, spaceId, turnId);
    const conversations = new Set(events.map((event) => event.conversationId).filter(Boolean));
    if (!events.length || conversations.size !== 1 || !conversations.has(conversationId))
      fail(404, 'not_found');
    await loadConversation(ownerId, conversationId, spaceId);
    return { conversationId, events };
  }

  async function handleAgentStart(request, url, ownerId) {
    assertAgentReady(config, activeProvider);
    requireWritePolicy(request, config);
    enforceSoftWriteRateLimit(ownerId);
    const body = await readJson(request, config.maxJsonBytes || 384 * 1024);
    onlyKeys(
      body,
      new Set([
        'action',
        'spaceId',
        'turnId',
        'editorSessionId',
        'baseDraftVersion',
        'draftScene',
        'prompt',
      ]),
      [
        'action',
        'spaceId',
        'turnId',
        'editorSessionId',
        'baseDraftVersion',
        'draftScene',
        'prompt',
      ],
    );
    if (body.action !== 'start') fail(400, 'invalid_action');
    const spaceId = requireId(body.spaceId);
    const turnId = requireUuid(body.turnId);
    const editorSessionId = requireEditorId(body.editorSessionId);
    const baseDraftVersion = body.baseDraftVersion;
    if (!Number.isSafeInteger(baseDraftVersion) || baseDraftVersion < 0)
      fail(400, 'invalid_draft_version');
    if (
      typeof body.prompt !== 'string' ||
      !body.prompt.trim() ||
      encoder.encode(body.prompt).byteLength > (config.maxPromptBytes || 8 * 1024)
    )
      fail(400, 'invalid_prompt');
    const conversationId = requireConversationId(request);
    await loadConversation(ownerId, conversationId, spaceId, editorSessionId);
    const draftScene = normalizeScene(body.draftScene);
    const draftCanonical = canonicalJson(draftScene);
    const operationsInput = {
      action: 'start',
      spaceId,
      turnId,
      conversationId,
      editorSessionId,
      baseDraftVersion,
      draftScene,
      prompt: body.prompt,
    };
    const requestHash = createHmac('sha256', config.secret)
      .update(canonicalJson(operationsInput))
      .digest('hex');
    const priorEvents = await loadTurnEvents(ownerId, spaceId, turnId);
    if (checkProviderRequestHash(priorEvents, requestHash)) {
      return replaySse(priorEvents);
    }

    const executionId = randomUUID();
    const controller = new AbortController();
    const activeKey = `${ownerId}/${spaceId}/${turnId}`;
    activeTurns.set(activeKey, controller);
    const firstEvent = await appendTurnEvent({
      ownerId,
      spaceId,
      turnId,
      conversationId,
      executionId,
      sequence: 1,
      name: 'turn_started',
      requestHash,
      data: { turnId, editorSessionId, baseDraftVersion },
    });
    const stream = new ReadableStream({
      start(controllerForStream) {
        controllerForStream.enqueue(encoder.encode(sseFrame(firstEvent)));
        queueMicrotask(() => {
          void runAgentTurn({
            ownerId,
            spaceId,
            turnId,
            conversationId,
            executionId,
            editorSessionId,
            baseDraftVersion,
            draftScene,
            draftCanonical,
            prompt: body.prompt,
            requestHash,
            abortController: controller,
            streamController: controllerForStream,
            activeKey,
          });
        });
      },
      cancel(reason) {
        controller.abort(reason instanceof Error ? reason : new Error('SSE client disconnected'));
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': NO_STORE,
        connection: 'keep-alive',
        'x-content-type-options': 'nosniff',
        'x-accel-buffering': 'no',
      },
    });
  }

  async function runAgentTurn(args) {
    const {
      ownerId,
      spaceId,
      turnId,
      conversationId,
      executionId,
      editorSessionId,
      baseDraftVersion,
      draftScene,
      draftCanonical,
      prompt,
      requestHash,
      abortController,
      streamController,
      activeKey,
    } = args;
    let sequence = 2;
    let closed = false;
    const send = async (name, data) => {
      const event = await appendTurnEvent({
        ownerId,
        spaceId,
        turnId,
        conversationId,
        executionId,
        sequence: sequence++,
        name,
        data,
        requestHash: undefined,
      });
      if (!closed) {
        try {
          streamController.enqueue(encoder.encode(sseFrame(event)));
        } catch {
          closed = true;
          abortController.abort(new Error('SSE stream closed'));
        }
      }
      return event;
    };
    let cancelPoll;
    try {
      cancelPoll = setInterval(() => {
        void hasCancelRequest(ownerId, spaceId, turnId)
          .then((cancelled) => {
            if (cancelled && !abortController.signal.aborted)
              abortController.abort(new Error('Turn cancelled'));
          })
          .catch(() => {});
      }, 750);
      cancelPoll.unref?.();
      if (abortController.signal.aborted || (await hasCancelRequest(ownerId, spaceId, turnId))) {
        await send('turn_cancelled', { turnId });
        return;
      }
      const output = await activeProvider.generate({
        draftScene,
        prompt,
        signal: abortController.signal,
      });
      if (abortController.signal.aborted || (await hasCancelRequest(ownerId, spaceId, turnId))) {
        await send('turn_cancelled', { turnId });
        return;
      }
      onlyKeys(output, new Set(['operations']), ['operations']);
      const operations = isSafeOperations(output.operations);
      const reduced = applyOperations(draftScene, operations);
      normalizeScene(reduced);
      const proposalId = `pr_${randomUUID().replaceAll('-', '')}`;
      const proposal = {
        turnId,
        proposalId,
        editorSessionId,
        baseDraftVersion,
        operations,
        baseDraftHash: createHash('sha256').update(draftCanonical).digest('hex'),
      };
      await send('proposal', proposal);
      await send('proposal_ready', { turnId, proposalId, editorSessionId, baseDraftVersion });
    } catch (error) {
      if (abortController.signal.aborted) {
        await send('turn_cancelled', { turnId }).catch(() => {});
      } else {
        await send('error', {
          turnId,
          code: error instanceof ApiError ? error.code : 'provider_or_proposal_failed',
        }).catch(() => {});
      }
    } finally {
      if (cancelPoll) clearInterval(cancelPoll);
      if (activeTurns.get(activeKey) === abortController) activeTurns.delete(activeKey);
      try {
        if (!closed) streamController.close();
      } catch {
        closed = true;
      }
    }
  }

  function replaySse(events, afterId = null) {
    let selected = events;
    if (afterId !== null) {
      const index = events.findIndex((event) => event.eventId === afterId);
      if (index < 0) fail(410, 'replay_unavailable');
      selected = events.slice(index + 1);
    }
    const stream = new ReadableStream({
      start(controller) {
        for (const event of selected) controller.enqueue(encoder.encode(sseFrame(event)));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': NO_STORE,
        'x-content-type-options': 'nosniff',
      },
    });
  }

  async function dispatch(request) {
    const url = new URL(request.url);
    const parts = decodeRoute(url.pathname);
    const method = request.method.toUpperCase();

    if (parts.join('/') === '/space-designer') {
      if (method !== 'POST')
        return jsonResponse(405, { error: { code: 'method_not_allowed' } }, { allow: 'POST' });
      const ownerId = requireOwner(request, config);
      return handleAgentStart(request, url, ownerId);
    }

    if (parts.join('/') === '/api/v1/session') {
      if (method === 'GET') {
        const identity = verifyVisitor(request, config);
        return jsonResponse(
          200,
          identity
            ? {
                state: 'ready',
                agentEnabled: Boolean(activeProvider),
                expiresAt: new Date(identity.expiresAt * 1000).toISOString(),
              }
            : { state: 'bootstrap_required', agentEnabled: Boolean(activeProvider) },
        );
      }
      return jsonResponse(405, { error: { code: 'method_not_allowed' } }, { allow: 'GET' });
    }
    if (parts.join('/') === '/api/v1/session/bootstrap') {
      if (method === 'POST') {
        requireWritePolicy(request, config);
        const body = await readJson(request, config.maxJsonBytes || 384 * 1024);
        onlyKeys(body, new Set());
        const existing = verifyVisitor(request, config);
        if (existing) {
          enforceSoftWriteRateLimit(existing.visitorId);
          return jsonResponse(200, {
            state: 'ready',
            agentEnabled: Boolean(activeProvider),
            expiresAt: new Date(existing.expiresAt * 1000).toISOString(),
          });
        }
        const visitorId = randomUUID();
        const expiresAt = Math.floor(Date.now() / 1000) + (config.cookieTtlSeconds || 2_592_000);
        return jsonResponse(
          200,
          {
            state: 'ready',
            agentEnabled: Boolean(activeProvider),
            expiresAt: new Date(expiresAt * 1000).toISOString(),
          },
          {
            'set-cookie': cookieHeader(visitorId, expiresAt, config),
          },
        );
      }
      return jsonResponse(405, { error: { code: 'method_not_allowed' } }, { allow: 'POST' });
    }

    if (parts.length === 4 && parts[1] === 'api' && parts[2] === 'v1' && parts[3] === 'spaces') {
      if (method !== 'GET')
        return jsonResponse(405, { error: { code: 'method_not_allowed' } }, { allow: 'GET' });
      const ownerId = requireOwner(request, config);
      const allKeys = await store.list(`${spacesRoot(ownerId)}/`);
      const spaceIds = [
        ...new Set(
          allKeys
            .map((key) => key.slice(`${spacesRoot(ownerId)}/`.length).split('/')[0])
            .filter(Boolean),
        ),
      ].sort();
      const spaces = [];
      for (const spaceId of spaceIds) {
        if (!genericIdPattern.test(spaceId)) continue;
        const revisions = await listRevisions(store, ownerId, spaceId);
        if (!revisions.length) continue;
        const childIds = new Set(
          revisions
            .filter((revision) => revision.parentRevisionId)
            .map((revision) => revision.parentRevisionId),
        );
        const heads = revisions
          .filter((revision) => !childIds.has(revision.revisionId))
          .map((revision) => revision.revisionId);
        spaces.push({
          spaceId,
          title: revisions.at(-1).scene.title,
          revisions: revisions.map(({ revisionId, parentRevisionId }) => ({
            revisionId,
            parentRevisionId,
          })),
          branches: heads,
        });
      }
      const offset = pageOffset(url);
      const limit = pageLimit(url);
      const page = spaces.slice(offset, offset + limit);
      return jsonResponse(200, {
        spaces: page,
        nextCursor: nextCursor(offset, page.length, spaces.length),
      });
    }

    const publicSharePrefix = '/api/v1/public/spaces/';
    if (url.pathname.startsWith(publicSharePrefix)) {
      const shareId = requirePublicShareId(url.pathname, publicSharePrefix);
      if (method !== 'GET')
        return jsonResponse(405, { error: { code: 'method_not_allowed' } }, { allow: 'GET' });
      const revoked = await store.get(`public/v1/shares/${shareId}/revoked`);
      if (revoked) fail(410, 'share_revoked');
      const snapshots = await store.list(`public/v1/shares/${shareId}/`);
      const snapshotKey = snapshots.find((key) => key !== `public/v1/shares/${shareId}/revoked`);
      if (!snapshotKey) fail(404, 'not_found');
      const snapshot = await store.get(snapshotKey);
      if (!snapshot || typeof snapshot.revisionId !== 'string') fail(404, 'not_found');
      const scene = normalizeScene(snapshot.scene);
      return jsonResponse(200, { scene, revisionId: snapshot.revisionId });
    }

    if (parts.length >= 5 && parts[1] === 'api' && parts[2] === 'v1' && parts[3] === 'spaces') {
      const spaceId = requireId(parts[4]);
      const ownerId = requireOwner(request, config);
      const rootParts = parts.slice(5);

      if (rootParts.length === 1 && rootParts[0] === 'revisions' && method === 'PUT') {
        requireWritePolicy(request, config);
        enforceSoftWriteRateLimit(ownerId);
        const body = await readJson(request, config.maxJsonBytes || 384 * 1024);
        onlyKeys(body, new Set(['saveAttemptId', 'parentRevisionId', 'scene']), [
          'saveAttemptId',
          'parentRevisionId',
          'scene',
        ]);
        const saveAttemptId = requireId(body.saveAttemptId);
        if (body.parentRevisionId !== null && typeof body.parentRevisionId !== 'string')
          fail(400, 'invalid_parent_revision');
        const parentRevisionId =
          body.parentRevisionId === null ? null : requireId(body.parentRevisionId);
        if (parentRevisionId && !(await readRevision(store, ownerId, spaceId, parentRevisionId)))
          fail(404, 'not_found');
        const scene = normalizeScene(body.scene);
        const sceneBytes = canonicalJson(scene);
        const revisionId = revisionIdFor(saveAttemptId, parentRevisionId, sceneBytes);
        await enforceSoftRevisionLimits(ownerId, spaceId, revisionId);
        const envelope = {
          type: 'revision',
          spaceId,
          revisionId,
          parentRevisionId,
          saveAttemptId,
          scene,
        };
        try {
          await store.put(revisionKey(ownerId, spaceId, revisionId), envelope);
        } catch (error) {
          if (error instanceof ImmutableKeyConflictError) fail(409, 'save_attempt_conflict');
          throw error;
        }
        const revisions = await listRevisions(store, ownerId, spaceId);
        const siblings = revisions
          .filter(
            (revision) =>
              revision.parentRevisionId === parentRevisionId && revision.revisionId !== revisionId,
          )
          .map((revision) => revision.revisionId);
        return jsonResponse(200, { revisionId, parentRevisionId, siblings });
      }

      if (rootParts.length === 1 && rootParts[0] === 'revisions' && method === 'GET') {
        const revisions = await listRevisions(store, ownerId, spaceId);
        const offset = pageOffset(url);
        const limit = pageLimit(url);
        const page = revisions
          .slice(offset, offset + limit)
          .map(({ revisionId, parentRevisionId }) => ({ revisionId, parentRevisionId }));
        return jsonResponse(200, {
          revisions: page,
          nextCursor: nextCursor(offset, page.length, revisions.length),
        });
      }

      if (rootParts.length === 2 && rootParts[0] === 'revisions' && method === 'GET') {
        const revisionId = requireId(rootParts[1]);
        const revision = await readRevision(store, ownerId, spaceId, revisionId);
        if (!revision) fail(404, 'not_found');
        return jsonResponse(200, {
          scene: revision.scene,
          revisionId,
          parentRevisionId: revision.parentRevisionId,
        });
      }

      if (rootParts.length === 1 && rootParts[0] === 'shares' && method === 'POST') {
        requireWritePolicy(request, config);
        enforceSoftWriteRateLimit(ownerId);
        const body = await readJson(request, config.maxJsonBytes || 384 * 1024);
        onlyKeys(body, new Set(['revisionId', 'shareAttemptId']), ['revisionId', 'shareAttemptId']);
        const revisionId = requireId(body.revisionId);
        const shareAttemptId = requireId(body.shareAttemptId);
        const revision = await readRevision(store, ownerId, spaceId, revisionId);
        if (!revision) fail(404, 'not_found');
        const shareId = stableShareId(ownerId, spaceId, revisionId, shareAttemptId);
        const privateShare = { type: 'share', spaceId, shareId, revisionId, shareAttemptId };
        const existing = await store.get(shareKey(ownerId, spaceId, shareId));
        if (existing && canonicalJson(existing) !== canonicalJson(privateShare))
          fail(409, 'share_attempt_conflict');
        const revoked = await store.get(`public/v1/shares/${shareId}/revoked`);
        if (revoked) fail(409, 'share_revoked');
        await store.put(shareKey(ownerId, spaceId, shareId), privateShare);
        await store.put(`public/v1/shares/${shareId}/${revisionId}`, {
          scene: revision.scene,
          revisionId,
        });
        return jsonResponse(200, { shareId, url: shareUrl(config, shareId), revisionId });
      }

      if (rootParts.length === 2 && rootParts[0] === 'shares' && method === 'DELETE') {
        requireWritePolicy(request, config);
        enforceSoftWriteRateLimit(ownerId);
        const shareId = rootParts[1];
        if (!shareIdPattern.test(shareId)) fail(404, 'not_found');
        const share = await store.get(shareKey(ownerId, spaceId, shareId));
        if (!share || share.spaceId !== spaceId || share.shareId !== shareId)
          fail(404, 'not_found');
        await store.put(`public/v1/shares/${shareId}/revoked`, { shareId, revoked: true });
        return jsonResponse(200, { revoked: true });
      }

      if (
        rootParts.length === 2 &&
        rootParts[0] === 'agent' &&
        rootParts[1] === 'sessions' &&
        method === 'POST'
      ) {
        requireWritePolicy(request, config);
        enforceSoftWriteRateLimit(ownerId);
        const body = await readJson(request, config.maxJsonBytes || 384 * 1024);
        onlyKeys(body, new Set(['editorSessionId']), ['editorSessionId']);
        const editorSessionId = requireEditorId(body.editorSessionId);
        const spaceRevisions = await listRevisions(store, ownerId, spaceId);
        if (!spaceRevisions.length) fail(404, 'not_found');
        const conversationId = randomUUID();
        await store.put(conversationKey(ownerId, conversationId), {
          type: 'conversation',
          conversationId,
          spaceId,
          editorSessionId,
        });
        return jsonResponse(201, { conversationId });
      }

      if (rootParts.length === 3 && rootParts[0] === 'agent' && rootParts[1] === 'turns') {
        const turnId = requireUuid(rootParts[2]);
        const { conversationId, events } = await authorizedTurn(request, ownerId, spaceId, turnId);
        const ack = await store.get(`${turnPrefix(ownerId, spaceId, turnId)}ack`);
        if (method === 'GET') {
          const status = readTurnStatus(events, ack);
          const latestEventId = events.at(-1)?.eventId || null;
          return jsonResponse(200, { turnId, status, latestEventId, ...(ack ? { ack } : {}) });
        }
      }

      if (
        rootParts.length === 4 &&
        rootParts[0] === 'agent' &&
        rootParts[1] === 'turns' &&
        rootParts[3] === 'events' &&
        method === 'GET'
      ) {
        const turnId = requireUuid(rootParts[2]);
        const { events } = await authorizedTurn(request, ownerId, spaceId, turnId);
        const afterId = request.headers.get('last-event-id') || url.searchParams.get('after');
        return replaySse(events, afterId || null);
      }

      if (
        rootParts.length === 4 &&
        rootParts[0] === 'agent' &&
        rootParts[1] === 'turns' &&
        rootParts[3] === 'ack' &&
        method === 'POST'
      ) {
        const turnId = requireUuid(rootParts[2]);
        const { conversationId, events } = await authorizedTurn(request, ownerId, spaceId, turnId);
        requireWritePolicy(request, config);
        enforceSoftWriteRateLimit(ownerId);
        const body = await readJson(request, config.maxJsonBytes || 384 * 1024);
        onlyKeys(
          body,
          new Set([
            'proposalId',
            'editorSessionId',
            'baseDraftVersion',
            'appliedDraftVersion',
            'outcome',
          ]),
          ['proposalId', 'editorSessionId', 'baseDraftVersion', 'appliedDraftVersion', 'outcome'],
        );
        if (
          typeof body.proposalId !== 'string' ||
          !/^pr_[A-Za-z0-9_-]{16,80}$/.test(body.proposalId)
        )
          fail(400, 'invalid_proposal');
        const editorSessionId = requireEditorId(body.editorSessionId);
        if (
          !Number.isSafeInteger(body.baseDraftVersion) ||
          !Number.isSafeInteger(body.appliedDraftVersion) ||
          body.appliedDraftVersion !== body.baseDraftVersion + 1 ||
          body.outcome !== 'scene_applied'
        )
          fail(400, 'invalid_ack');
        await loadConversation(ownerId, conversationId, spaceId, editorSessionId);
        const proposals = events.filter(
          (event) => event.name === 'proposal' && event.data?.proposalId === body.proposalId,
        );
        const ready = events.some(
          (event) => event.name === 'proposal_ready' && event.data?.proposalId === body.proposalId,
        );
        const proposalMatches = proposals.some(
          (event) =>
            event.data.editorSessionId === editorSessionId &&
            event.data.baseDraftVersion === body.baseDraftVersion,
        );
        if (!ready || !proposalMatches) fail(409, 'proposal_mismatch');
        const acknowledgement = {
          turnId,
          proposalId: body.proposalId,
          editorSessionId,
          baseDraftVersion: body.baseDraftVersion,
          appliedDraftVersion: body.appliedDraftVersion,
          outcome: 'scene_applied',
        };
        const key = `${turnPrefix(ownerId, spaceId, turnId)}ack`;
        const existing = await store.get(key);
        if (existing && canonicalJson(existing) !== canonicalJson(acknowledgement))
          fail(409, 'ack_conflict');
        await store.put(key, acknowledgement);
        return jsonResponse(200, { acknowledged: true, ...acknowledgement });
      }

      if (
        rootParts.length === 4 &&
        rootParts[0] === 'agent' &&
        rootParts[1] === 'turns' &&
        rootParts[3] === 'cancel' &&
        method === 'POST'
      ) {
        const turnId = requireUuid(rootParts[2]);
        const { conversationId, events } = await authorizedTurn(request, ownerId, spaceId, turnId);
        requireWritePolicy(request, config);
        enforceSoftWriteRateLimit(ownerId);
        const body = await readJson(request, config.maxJsonBytes || 384 * 1024);
        onlyKeys(body, new Set());
        const ack = await store.get(`${turnPrefix(ownerId, spaceId, turnId)}ack`);
        if (ack) fail(409, 'turn_already_applied');
        const cancelAlreadyRequested = events.some((event) => event.name === 'cancel_requested');
        if (!cancelAlreadyRequested) {
          const executionId = randomUUID();
          await appendTurnEvent({
            ownerId,
            spaceId,
            turnId,
            conversationId,
            executionId,
            sequence: 1,
            name: 'cancel_requested',
            data: { turnId },
          });
        }
        const activeKey = `${ownerId}/${spaceId}/${turnId}`;
        activeTurns.get(activeKey)?.abort(new Error('Turn cancelled by user'));
        return jsonResponse(200, { cancelRequested: true });
      }

      return jsonResponse(
        405,
        { error: { code: 'method_not_allowed' } },
        { allow: 'GET, PUT, POST, DELETE' },
      );
    }

    return jsonResponse(404, { error: { code: 'not_found' } });
  }

  async function handle(request) {
    if (secretUnavailable()) return jsonResponse(503, { error: { code: 'server_not_configured' } });
    try {
      return await dispatch(request);
    } catch (error) {
      if (error instanceof ApiError)
        return jsonResponse(error.status, { error: { code: error.code } });
      return jsonResponse(503, { error: { code: 'service_unavailable' } });
    }
  }

  return { handle };
}
