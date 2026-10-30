import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.mjs';
import { loadConfig } from '../server/config.mjs';
import { createDefaultScene } from '../web/js/editor/document.js';
import { createMemoryStore } from '../server/storage.mjs';

const origin = 'http://localhost:5173';
const secret = 'local-test-secret-not-for-production-32-bytes';
const writeHeaders = (cookie, conversationId) => ({
  origin,
  'sec-fetch-site': 'same-origin',
  'x-loom-request': '1',
  'content-type': 'application/json',
  ...(cookie ? { cookie } : {}),
  ...(conversationId ? { 'makers-conversation-id': conversationId } : {}),
});
const request = (
  path,
  { method = 'GET', cookie, conversationId, body, headers = {}, base = origin } = {},
) =>
  new Request(`${base}${path}`, {
    method,
    headers: {
      ...(method === 'GET'
        ? {
            ...(cookie ? { cookie } : {}),
            ...(conversationId ? { 'makers-conversation-id': conversationId } : {}),
          }
        : { ...writeHeaders(cookie, conversationId), origin: new URL(base).origin }),
      ...headers,
    },
    ...(method === 'GET'
      ? {}
      : {
          body: body === undefined ? '{}' : typeof body === 'string' ? body : JSON.stringify(body),
        }),
  });
const payload = async (response) => response.json();
const createServer = ({
  store = createMemoryStore(),
  agentEnabled = false,
  production = false,
  provider = null,
  config: override = {},
} = {}) => {
  const config = {
    origin: production ? 'https://loom.example' : origin,
    publicBaseUrl: production ? 'https://loom.example' : origin,
    secret,
    cookieKeyId: 'k1',
    cookieTtlSeconds: 3600,
    production,
    agentEnabled,
    providerBudgetConfirmed: production,
    edgeRateLimitConfirmed: production,
    maxJsonBytes: 384 * 1024,
    maxPromptBytes: 8192,
    softWriteLimitPerMinute: 60,
    softMaxSpacesPerVisitor: 100,
    softMaxRevisionsPerVisitor: 500,
    ...override,
  };
  return { app: createApp({ store, config, provider }), store, config };
};

async function bootstrap(app, { headers = {}, base = origin } = {}) {
  const response = await app.handle(
    request('/api/v1/session/bootstrap', { method: 'POST', body: {}, headers, base }),
  );
  const result = await payload(response);
  assert.equal(response.status, 200, JSON.stringify(result));
  const value = response.headers.get('set-cookie');
  return { cookie: value?.split(';')[0], response, result };
}

async function saveScene(
  app,
  cookie,
  spaceId = randomUUID(),
  { saveAttemptId = randomUUID(), parentRevisionId = null, scene = createDefaultScene() } = {},
) {
  const response = await app.handle(
    request(`/api/v1/spaces/${spaceId}/revisions`, {
      method: 'PUT',
      cookie,
      body: { saveAttemptId, parentRevisionId, scene },
    }),
  );
  return {
    response,
    body: await payload(response),
    spaceId,
    saveAttemptId,
    parentRevisionId,
    scene,
  };
}

test('session bootstrap is same-origin, signed, HttpOnly and does not expose owner or credential', async () => {
  const { app } = createServer();
  assert.deepEqual(await payload(await app.handle(request('/api/v1/session'))), {
    state: 'bootstrap_required',
    agentEnabled: false,
  });
  const blocked = await app.handle(
    request('/api/v1/session/bootstrap', {
      method: 'POST',
      body: {},
      headers: { origin: 'https://attacker.example' },
    }),
  );
  assert.equal(blocked.status, 403);
  const initial = await bootstrap(app);
  assert.match(initial.cookie, /^loom-visitor=v1\.k1\.[^.]+\./);
  assert.match(initial.response.headers.get('set-cookie'), /HttpOnly/);
  assert.match(initial.response.headers.get('set-cookie'), /SameSite=Lax/);
  assert.match(initial.response.headers.get('set-cookie'), /Path=\//);
  assert.doesNotMatch(initial.response.headers.get('set-cookie'), /Domain=|Secure/);
  const session = await app.handle(request('/api/v1/session', { cookie: initial.cookie }));
  const data = await payload(session);
  assert.equal(data.state, 'ready');
  assert.equal(data.agentEnabled, false);
  assert.equal(Object.hasOwn(data, 'visitorId'), false);
  assert.equal(JSON.stringify(data).includes(secret), false);
  const repeated = await app.handle(
    request('/api/v1/session/bootstrap', { method: 'POST', cookie: initial.cookie, body: {} }),
  );
  assert.equal(repeated.headers.get('set-cookie'), null);
  assert.equal((await payload(repeated)).state, 'ready');
  assert.equal(session.headers.get('cache-control'), 'private, no-store, max-age=0');
});

test('production requires HTTPS and emits only the __Host- Secure cookie', async () => {
  const { app } = createServer({ production: true });
  const result = await bootstrap(app, { base: 'https://loom.example' });
  assert.match(result.cookie, /^__Host-loom-visitor=/);
  assert.match(result.response.headers.get('set-cookie'), /; Secure/);
  assert.match(result.response.headers.get('set-cookie'), /; HttpOnly/);
  assert.match(result.response.headers.get('set-cookie'), /; SameSite=Lax/);
  assert.match(result.response.headers.get('set-cookie'), /; Path=\//);
  assert.doesNotMatch(result.response.headers.get('set-cookie'), /Domain=/);
  const bad = createServer({ production: true, config: { origin: origin } }).app;
  assert.equal((await bad.handle(request('/api/v1/session'))).status, 503);
  const missingEdgeLimitConfirmation = createServer({
    production: true,
    config: { edgeRateLimitConfirmed: false },
  }).app;
  assert.equal((await missingEdgeLimitConfirmation.handle(request('/api/v1/session'))).status, 503);
});

test('over-deep JSON is rejected as a client error before recursive identity checks overflow', async () => {
  const { app } = createServer();
  const { cookie } = await bootstrap(app);
  let nested = { harmless: true };
  for (let depth = 0; depth < 100; depth++) nested = [nested];
  const tooDeep = await app.handle(
    request('/api/v1/session/bootstrap', {
      method: 'POST',
      cookie,
      body: JSON.stringify(nested),
    }),
  );
  assert.equal(tooDeep.status, 400);
  assert.equal((await payload(tooDeep)).error.code, 'invalid_request');
});

test('writes reject bad Origin, Fetch Metadata, content type, malformed JSON, oversized JSON and forged owner fields', async () => {
  const { app } = createServer();
  const { cookie } = await bootstrap(app);
  const path = `/api/v1/spaces/${randomUUID()}/revisions`;
  const crossOrigin = await app.handle(
    request(path, { method: 'PUT', cookie, body: {}, headers: { origin: 'https://evil.test' } }),
  );
  assert.equal(crossOrigin.status, 403);
  const missingHeader = await app.handle(
    request(path, { method: 'PUT', cookie, body: {}, headers: { 'x-loom-request': '' } }),
  );
  assert.equal(missingHeader.status, 403);
  const badFetchMetadata = await app.handle(
    request(path, { method: 'PUT', cookie, body: {}, headers: { 'sec-fetch-site': 'cross-site' } }),
  );
  assert.equal(badFetchMetadata.status, 403);
  const text = await app.handle(
    request(path, { method: 'PUT', cookie, body: '{}', headers: { 'content-type': 'text/plain' } }),
  );
  assert.equal(text.status, 415);
  const malformed = await app.handle(request(path, { method: 'PUT', cookie, body: '{' }));
  assert.equal(malformed.status, 400);
  const oversized = await app.handle(
    request(path, { method: 'PUT', cookie, body: 'x'.repeat(384 * 1024 + 1) }),
  );
  assert.equal(oversized.status, 413);
  const forged = await app.handle(
    request(path, {
      method: 'PUT',
      cookie,
      body: {
        ownerId: 'victim',
        saveAttemptId: randomUUID(),
        parentRevisionId: null,
        scene: createDefaultScene(),
      },
    }),
  );
  assert.equal(forged.status, 400);
});

test('anonymous soft write throttling is per visitor and reports 429', async () => {
  const { app } = createServer({ config: { softWriteLimitPerMinute: 1 } });
  const firstOwner = await bootstrap(app);
  const secondOwner = await bootstrap(app);
  const firstWrite = await saveScene(app, firstOwner.cookie);
  assert.equal(firstWrite.response.status, 200);
  const throttled = await saveScene(app, firstOwner.cookie);
  assert.equal(throttled.response.status, 429);
  assert.equal(throttled.body.error.code, 'soft_write_rate_limited');
  const otherVisitor = await saveScene(app, secondOwner.cookie);
  assert.equal(otherVisitor.response.status, 200);
});

test('anonymous soft space and revision caps allow idempotent retries and return 429 for new data', async () => {
  const { app } = createServer({
    config: { softMaxSpacesPerVisitor: 1, softMaxRevisionsPerVisitor: 2 },
  });
  const { cookie } = await bootstrap(app);
  const spaceId = randomUUID();
  const first = await saveScene(app, cookie, spaceId);
  assert.equal(first.response.status, 200);
  const retry = await saveScene(app, cookie, spaceId, {
    saveAttemptId: first.saveAttemptId,
    scene: first.scene,
  });
  assert.equal(retry.response.status, 200);
  const secondSpace = await saveScene(app, cookie, randomUUID());
  assert.equal(secondSpace.response.status, 429);
  assert.equal(secondSpace.body.error.code, 'soft_space_limit');
  const secondRevision = await saveScene(app, cookie, spaceId, {
    parentRevisionId: first.body.revisionId,
    scene: createDefaultScene({ title: '另一份版本' }),
  });
  assert.equal(secondRevision.response.status, 200);
  const thirdRevision = await saveScene(app, cookie, spaceId, {
    parentRevisionId: secondRevision.body.revisionId,
    scene: createDefaultScene({ title: '超出软上限' }),
  });
  assert.equal(thirdRevision.response.status, 429);
  assert.equal(thirdRevision.body.error.code, 'soft_revision_limit');
});

test('immutable revisions are retry-safe and preserve independent sibling payloads', async () => {
  const { app, store } = createServer();
  const { cookie } = await bootstrap(app);
  const spaceId = randomUUID();
  const saveAttemptId = randomUUID();
  const scene = createDefaultScene({ title: '竹影' });
  const first = await saveScene(app, cookie, spaceId, { saveAttemptId, scene });
  assert.equal(first.response.status, 200);
  const retry = await saveScene(app, cookie, spaceId, { saveAttemptId, scene });
  assert.equal(retry.body.revisionId, first.body.revisionId);
  assert.equal((await store.list('private/v1/')).length, 1);
  const altered = createDefaultScene({ title: '木影' });
  const differentBytes = await saveScene(app, cookie, spaceId, { saveAttemptId, scene: altered });
  assert.equal(differentBytes.response.status, 200);
  assert.notEqual(differentBytes.body.revisionId, first.body.revisionId);
  const sibling = await saveScene(app, cookie, spaceId, {
    scene: createDefaultScene({ title: '午後' }),
  });
  assert.equal(sibling.response.status, 200);
  assert.ok(sibling.body.siblings.includes(first.body.revisionId));
  assert.ok(sibling.body.siblings.includes(differentBytes.body.revisionId));
  const revisions = await payload(
    await app.handle(request(`/api/v1/spaces/${spaceId}/revisions`, { cookie })),
  );
  assert.equal(revisions.revisions.length, 3);
  const read = await payload(
    await app.handle(
      request(`/api/v1/spaces/${spaceId}/revisions/${first.body.revisionId}`, { cookie }),
    ),
  );
  assert.equal(read.scene.title, '竹影');
  assert.equal(read.parentRevisionId, null);
});

test('owner isolation returns 404 and public shares contain only a read-only scene snapshot and revoke strongly', async () => {
  const { app } = createServer();
  const owner = await bootstrap(app);
  const otherOwner = await bootstrap(app);
  const spaceId = randomUUID();
  const saved = await saveScene(app, owner.cookie, spaceId);
  assert.equal(saved.response.status, 200);
  assert.equal(
    (
      await app.handle(
        request(`/api/v1/spaces/${spaceId}/revisions/${saved.body.revisionId}`, {
          cookie: otherOwner.cookie,
        }),
      )
    ).status,
    404,
  );
  assert.equal(
    (await payload(await app.handle(request('/api/v1/spaces', { cookie: otherOwner.cookie }))))
      .spaces.length,
    0,
  );
  const share = await payload(
    await app.handle(
      request(`/api/v1/spaces/${spaceId}/shares`, {
        method: 'POST',
        cookie: owner.cookie,
        body: { revisionId: saved.body.revisionId, shareAttemptId: randomUUID() },
      }),
    ),
  );
  const publicRead = await app.handle(request(`/api/v1/public/spaces/${share.shareId}`));
  assert.equal(publicRead.status, 200);
  assert.equal(publicRead.headers.get('cache-control'), 'private, no-store, max-age=0');
  const publicBody = await payload(publicRead);
  assert.equal(publicBody.revisionId, saved.body.revisionId);
  assert.equal(publicBody.scene.title, saved.scene.title);
  assert.deepEqual(Object.keys(publicBody).sort(), ['revisionId', 'scene']);
  assert.equal(JSON.stringify(publicBody).includes(owner.cookie), false);
  for (const suffix of [
    `/${share.shareId}/extra`,
    `/${share.shareId}/`,
    `/${share.shareId}%2Fextra`,
  ]) {
    const extraPath = await app.handle(request(`/api/v1/public/spaces${suffix}`));
    assert.equal(extraPath.status, 404, suffix);
  }
  assert.equal(
    (
      await app.handle(
        request(`/api/v1/spaces/${spaceId}/shares/${share.shareId}`, {
          method: 'DELETE',
          cookie: otherOwner.cookie,
          body: {},
        }),
      )
    ).status,
    404,
  );
  const revoked = await app.handle(
    request(`/api/v1/spaces/${spaceId}/shares/${share.shareId}`, {
      method: 'DELETE',
      cookie: owner.cookie,
      body: {},
    }),
  );
  assert.equal(revoked.status, 200);
  assert.equal((await app.handle(request(`/api/v1/public/spaces/${share.shareId}`))).status, 410);
  const retry = await app.handle(
    request(`/api/v1/spaces/${spaceId}/shares`, {
      method: 'POST',
      cookie: owner.cookie,
      body: { revisionId: saved.body.revisionId, shareAttemptId: share.shareId },
    }),
  );
  assert.equal(retry.status, 200);
  assert.notEqual((await payload(retry)).shareId, share.shareId);
});

test('fake Agent validates draft, emits persisted proposal events, binds editor and conversation, and does not rerun duplicates', async () => {
  let calls = 0;
  const provider = {
    async generate() {
      calls++;
      return { operations: [{ op: 'set_environment', patch: { timeOfDay: 17 } }] };
    },
  };
  const { app } = createServer({ agentEnabled: true, provider });
  const { cookie } = await bootstrap(app);
  const spaceId = randomUUID();
  const saved = await saveScene(app, cookie, spaceId);
  assert.equal(saved.response.status, 200);
  const editorSessionId = 'editor_session_12345678';
  const session = await payload(
    await app.handle(
      request(`/api/v1/spaces/${spaceId}/agent/sessions`, {
        method: 'POST',
        cookie,
        body: { editorSessionId },
      }),
    ),
  );
  const turnId = randomUUID();
  const body = {
    action: 'start',
    spaceId,
    turnId,
    editorSessionId,
    baseDraftVersion: 7,
    draftScene: saved.scene,
    prompt: '午後の日差しを少し遅くして',
  };
  const start = () =>
    app.handle(
      request('/space-designer', {
        method: 'POST',
        cookie,
        conversationId: session.conversationId,
        body,
      }),
    );
  const response = await start();
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.match(text, /event: proposal\n/);
  assert.match(text, /event: proposal_ready\n/);
  assert.equal(calls, 1);
  const mismatchedSession = await app.handle(
    request('/space-designer', {
      method: 'POST',
      cookie,
      conversationId: session.conversationId,
      body: { ...body, turnId: randomUUID(), editorSessionId: 'other_editor_session_123' },
    }),
  );
  assert.equal(mismatchedSession.status, 404);
  const proposal = JSON.parse(text.match(/event: proposal\ndata: ([^\n]+)/)[1]);
  const ackPath = `/api/v1/spaces/${spaceId}/agent/turns/${turnId}/ack`;
  const staleAck = await app.handle(
    request(ackPath, {
      method: 'POST',
      cookie,
      conversationId: session.conversationId,
      body: {
        proposalId: proposal.proposalId,
        editorSessionId,
        baseDraftVersion: 6,
        appliedDraftVersion: 7,
        outcome: 'scene_applied',
      },
    }),
  );
  assert.equal(staleAck.status, 409);
  const ack = await app.handle(
    request(ackPath, {
      method: 'POST',
      cookie,
      conversationId: session.conversationId,
      body: {
        proposalId: proposal.proposalId,
        editorSessionId,
        baseDraftVersion: 7,
        appliedDraftVersion: 8,
        outcome: 'scene_applied',
      },
    }),
  );
  assert.equal(ack.status, 200);
  const status = await app.handle(
    request(`/api/v1/spaces/${spaceId}/agent/turns/${turnId}`, {
      cookie,
      conversationId: session.conversationId,
    }),
  );
  assert.equal((await payload(status)).status, 'applied');
  const replay = await start();
  const replayText = await replay.text();
  assert.match(replayText, /event: proposal_ready\n/);
  assert.equal(calls, 1);
  const foreign = await bootstrap(app);
  assert.equal(
    (
      await app.handle(
        request(`/api/v1/spaces/${spaceId}/agent/turns/${turnId}`, {
          cookie: foreign.cookie,
          conversationId: session.conversationId,
        }),
      )
    ).status,
    404,
  );
});

test('cancel is best-effort and records a durable status without retrying the provider', async () => {
  let calls = 0;
  const provider = {
    generate({ signal }) {
      calls++;
      return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    },
  };
  const { app } = createServer({ agentEnabled: true, provider });
  const { cookie } = await bootstrap(app);
  const spaceId = randomUUID();
  const saved = await saveScene(app, cookie, spaceId);
  const editorSessionId = 'editor_session_cancel_123';
  const session = await payload(
    await app.handle(
      request(`/api/v1/spaces/${spaceId}/agent/sessions`, {
        method: 'POST',
        cookie,
        body: { editorSessionId },
      }),
    ),
  );
  const turnId = randomUUID();
  const stream = await app.handle(
    request('/space-designer', {
      method: 'POST',
      cookie,
      conversationId: session.conversationId,
      body: {
        action: 'start',
        spaceId,
        turnId,
        editorSessionId,
        baseDraftVersion: 0,
        draftScene: saved.scene,
        prompt: 'stop me',
      },
    }),
  );
  const reader = stream.body.getReader();
  await reader.read();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const cancel = await app.handle(
    request(`/api/v1/spaces/${spaceId}/agent/turns/${turnId}/cancel`, {
      method: 'POST',
      cookie,
      conversationId: session.conversationId,
      body: {},
    }),
  );
  assert.equal(cancel.status, 200);
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(new TextDecoder().decode(value));
  }
  await reader.releaseLock();
  assert.equal(calls, 1);
  assert.match(chunks.join(''), /event: turn_cancelled/);
  const status = await app.handle(
    request(`/api/v1/spaces/${spaceId}/agent/turns/${turnId}`, {
      cookie,
      conversationId: session.conversationId,
    }),
  );
  assert.equal((await payload(status)).status, 'cancel_requested');
});

test('disabled Agent remains unavailable and GET session advertises it accurately', async () => {
  const { app } = createServer({ agentEnabled: true, provider: null });
  const { cookie } = await bootstrap(app);
  const session = await payload(await app.handle(request('/api/v1/session', { cookie })));
  assert.equal(session.agentEnabled, false);
  const response = await app.handle(
    request('/space-designer', { method: 'POST', cookie, body: {} }),
  );
  assert.equal(response.status, 503);
});
