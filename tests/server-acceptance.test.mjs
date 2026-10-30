import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.mjs';
import { createMemoryStore } from '../server/storage.mjs';
import { loadConfig } from '../server/config.mjs';
import { createDefaultScene } from '../web/js/editor/document.js';

const origin = 'http://localhost:5187';
const config = loadConfig({
  LOOM_ORIGIN: origin,
  LOOM_COOKIE_SECRET: 'acceptance-only-'.repeat(4),
  LOOM_AGENT_ENABLED: 'true',
});
function request(app, path, { method = 'GET', body, cookie, conversation } = {}) {
  return app.handle(
    new Request(new URL(path, origin), {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(conversation ? { 'Makers-Conversation-Id': conversation } : {}),
        ...(method !== 'GET'
          ? {
              Origin: origin,
              'Sec-Fetch-Site': 'same-origin',
              'X-Loom-Request': '1',
              'Content-Type': 'application/json',
            }
          : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }),
  );
}
async function bootstrap(app) {
  const response = await request(app, '/api/v1/session/bootstrap', { method: 'POST', body: {} });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}

test('two application instances retain sibling revisions and independent browser owners', async () => {
  const store = createMemoryStore();
  const appA = createApp({ store, config });
  const appB = createApp({ store, config });
  const cookie = await bootstrap(appA);
  const otherCookie = await bootstrap(appB);
  const spaceId = randomUUID();
  const path = `/api/v1/spaces/${spaceId}/revisions`;
  const scene = createDefaultScene();
  const first = await (
    await request(appA, path, {
      method: 'PUT',
      cookie,
      body: { saveAttemptId: randomUUID(), parentRevisionId: null, scene },
    })
  ).json();
  assert.ok(first.revisionId);
  const attempts = [randomUUID(), randomUUID()];
  const responses = await Promise.all(
    [appA, appB].map((app, i) =>
      request(app, path, {
        method: 'PUT',
        cookie,
        body: {
          saveAttemptId: attempts[i],
          parentRevisionId: first.revisionId,
          scene: { ...scene, title: `分支 ${i}` },
        },
      }),
    ),
  );
  assert.ok(responses.every((response) => response.status === 200));
  const children = await Promise.all(responses.map((response) => response.json()));
  assert.notEqual(children[0].revisionId, children[1].revisionId);
  const list = await (await request(appB, path, { cookie })).json();
  assert.equal(list.revisions.length, 3);
  for (const child of children) {
    const read = await request(appA, `${path}/${child.revisionId}`, { cookie });
    assert.equal(read.status, 200);
    assert.equal(
      (await request(appB, `${path}/${child.revisionId}`, { cookie: otherCookie })).status,
      404,
    );
  }
  const repeat = await (
    await request(appB, path, {
      method: 'PUT',
      cookie,
      body: {
        saveAttemptId: attempts[0],
        parentRevisionId: first.revisionId,
        scene: { ...scene, title: '分支 0' },
      },
    })
  ).json();
  assert.equal(repeat.revisionId, children[0].revisionId);
  const result = await (await request(appA, '/api/v1/spaces', { cookie })).json();
  assert.equal(result.spaces[0].branches.length, 2);
});

test('cold-start Agent replay does not call the injected model or mutate saved scene', async () => {
  const store = createMemoryStore();
  let calls = 0;
  const provider = {
    async generate() {
      calls++;
      return { operations: [{ op: 'set_environment', patch: { skyPreset: 'dusk' } }] };
    },
  };
  const appA = createApp({ store, config, provider });
  const cookie = await bootstrap(appA);
  const spaceId = randomUUID();
  const scene = createDefaultScene();
  const saved = await (
    await request(appA, `/api/v1/spaces/${spaceId}/revisions`, {
      method: 'PUT',
      cookie,
      body: { saveAttemptId: randomUUID(), parentRevisionId: null, scene },
    })
  ).json();
  const editorSessionId = randomUUID();
  const { conversationId } = await (
    await request(appA, `/api/v1/spaces/${spaceId}/agent/sessions`, {
      method: 'POST',
      cookie,
      body: { editorSessionId },
    })
  ).json();
  const turnId = randomUUID();
  const body = {
    action: 'start',
    spaceId,
    turnId,
    editorSessionId,
    baseDraftVersion: 4,
    draftScene: scene,
    prompt: '改成黄昏',
  };
  const stream = await request(appA, '/space-designer', {
    method: 'POST',
    cookie,
    conversation: conversationId,
    body,
  });
  assert.equal(stream.status, 200);
  assert.match(await stream.text(), /proposal_ready/);
  assert.equal(calls, 1);
  const appB = createApp({ store, config, provider });
  const repeated = await request(appB, '/space-designer', {
    method: 'POST',
    cookie,
    conversation: conversationId,
    body,
  });
  await repeated.text();
  assert.equal(calls, 1);
  const state = await request(appB, `/api/v1/spaces/${spaceId}/agent/turns/${turnId}`, {
    cookie,
    conversation: conversationId,
  });
  assert.equal(state.status, 200);
  const persisted = await (
    await request(appB, `/api/v1/spaces/${spaceId}/revisions/${saved.revisionId}`, { cookie })
  ).json();
  assert.equal(persisted.scene.environment.skyPreset, scene.environment.skyPreset);
});
