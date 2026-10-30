import { test, expect } from '@playwright/test';

async function installMocks(page, { agentEnabled = true } = {}) {
  const state = {
    agentEnabled,
    failSave401: false,
    failFirstAck: false,
    loseRevision: false,
    ackRequests: [],
    statusRequests: [],
    cancelRequests: 0,
    statusResult: 'unknown',
    savedScene: null,
    revisionId: 'rev_synthetic_001',
  };

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const json = (body, status = 200) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });

    if (url.pathname === '/api/v1/session' && method === 'GET') {
      return json({ state: 'ready', agentEnabled: state.agentEnabled });
    }
    if (url.pathname === '/api/v1/spaces' && method === 'GET') {
      return json({ spaces: [], nextCursor: null });
    }
    if (/^\/api\/v1\/spaces\/[^/]+\/revisions$/.test(url.pathname) && method === 'PUT') {
      if (state.failSave401) return json({ error: { code: 'session_required' } }, 401);
      state.savedScene = request.postDataJSON().scene;
      return json({ revisionId: state.revisionId, parentRevisionId: null, siblings: [] });
    }
    if (/^\/api\/v1\/spaces\/[^/]+\/revisions\/[^/]+$/.test(url.pathname) && method === 'GET') {
      if (state.loseRevision) return json({ error: { code: 'not_found' } }, 404);
      return json({
        scene: state.savedScene,
        revisionId: state.revisionId,
        parentRevisionId: null,
      });
    }
    if (/^\/api\/v1\/spaces\/[^/]+\/agent\/sessions$/.test(url.pathname) && method === 'POST') {
      return json({ conversationId: 'conv_test_123456' }, 201);
    }
    const statusMatch = url.pathname.match(/^\/api\/v1\/spaces\/[^/]+\/agent\/turns\/([^/]+)$/);
    if (statusMatch && method === 'GET') {
      state.statusRequests.push({
        turnId: statusMatch[1],
        conversationId: request.headers()['makers-conversation-id'],
      });
      return json({ turnId: statusMatch[1], status: state.statusResult, latestEventId: null });
    }
    if (
      /^\/api\/v1\/spaces\/[^/]+\/agent\/turns\/[^/]+\/ack$/.test(url.pathname) &&
      method === 'POST'
    ) {
      state.ackRequests.push({
        conversationId: request.headers()['makers-conversation-id'],
        body: request.postDataJSON(),
      });
      if (state.failFirstAck && state.ackRequests.length === 1) {
        return json({ error: { code: 'temporary_failure' } }, 503);
      }
      return json({ acknowledged: true });
    }
    if (
      /^\/api\/v1\/spaces\/[^/]+\/agent\/turns\/[^/]+\/cancel$/.test(url.pathname) &&
      method === 'POST'
    ) {
      state.cancelRequests++;
      return json({ cancelRequested: true });
    }
    return json({});
  });

  await page.addInitScript(() => {
    const nativeFetch = window.fetch.bind(window);
    window.__loomSyntheticAgent = { starts: 0, body: null, controller: null };
    window.fetch = async (input, init = {}) => {
      const url = new URL(input instanceof Request ? input.url : String(input), location.href);
      if (url.pathname !== '/space-designer') return nativeFetch(input, init);
      const state = window.__loomSyntheticAgent;
      state.starts++;
      const previous = Number(sessionStorage.getItem('loom-test-agent-starts') || 0);
      sessionStorage.setItem('loom-test-agent-starts', String(previous + 1));
      state.body = JSON.parse(init.body);
      return new Response(
        new ReadableStream({
          start(controller) {
            state.controller = controller;
          },
        }),
        { headers: { 'content-type': 'text/event-stream; charset=utf-8' } },
      );
    };
  });
  return state;
}

async function openEditor(page, options) {
  const state = await installMocks(page, options);
  await page.goto('/create.html');
  await expect(page.locator('#renderer-loading')).toBeHidden({ timeout: 45_000 });
  return state;
}

async function saveScene(page) {
  await page.locator('#save-scene').click();
  await expect(page.locator('#save-status')).toHaveText('已保存');
  await expect(page.locator('#agent-send')).toBeEnabled();
}

async function startTurn(page, prompt = '调整园林氛围') {
  await page.locator('#agent-prompt').fill(prompt);
  await page.locator('#agent-send').click();
  await expect.poll(() => page.evaluate(() => window.__loomSyntheticAgent.starts)).toBe(1);
  return page.evaluate(() => window.__loomSyntheticAgent.body);
}

function proposalEvents(turn, operations) {
  const proposalId = `pr_${'a'.repeat(32)}`;
  return [
    {
      id: 'synthetic_proposal_001',
      type: 'proposal',
      data: {
        turnId: turn.turnId,
        proposalId,
        editorSessionId: turn.editorSessionId,
        baseDraftVersion: turn.baseDraftVersion,
        operations,
      },
    },
    {
      id: 'synthetic_ready_002',
      type: 'proposal_ready',
      data: {
        turnId: turn.turnId,
        proposalId,
        editorSessionId: turn.editorSessionId,
        baseDraftVersion: turn.baseDraftVersion,
      },
    },
  ];
}

async function sendFrames(page, events) {
  await page.evaluate((frames) => {
    const bytes = new TextEncoder().encode(
      frames
        .map(({ id, type, data }) => `id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`)
        .join(''),
    );
    window.__loomSyntheticAgent.controller.enqueue(bytes);
    window.__loomSyntheticAgent.controller.close();
  }, events);
}

async function readDrafts(page) {
  return page.evaluate(async () => {
    const { createDraftStore } = await import('/js/editor/persistence.js');
    const store = await createDraftStore();
    const entries = await store.list('draft:');
    store.close();
    return entries;
  });
}

async function waitForPendingAck(page) {
  await page.waitForFunction(async () => {
    const { createDraftStore } = await import('/js/editor/persistence.js');
    const store = await createDraftStore();
    const entries = await store.list('draft:');
    store.close();
    return entries.some(({ value }) => value.pendingAck?.turnId);
  });
}

async function waitForPendingTurn(page) {
  await page.waitForFunction(async () => {
    const { createDraftStore } = await import('/js/editor/persistence.js');
    const store = await createDraftStore();
    const entries = await store.list('draft:');
    store.close();
    return entries.some(({ value }) => value.pendingTurn?.turnId);
  });
}

async function editTitle(page, title) {
  await page.locator('#scene-title').fill(title);
  await page.locator('#scene-title').press('Tab');
  await page.waitForFunction(async (expectedTitle) => {
    const { createDraftStore } = await import('/js/editor/persistence.js');
    const store = await createDraftStore();
    const entries = await store.list('draft:');
    store.close();
    return entries.some(({ value }) => value.scene.title === expectedTitle);
  }, title);
}

test('one proposal containing two operations is one undo step', async ({ page }) => {
  const mock = await openEditor(page);
  await saveScene(page);
  const turn = await startTurn(page);
  await sendFrames(
    page,
    proposalEvents(turn, [
      { op: 'set_environment', patch: { skyPreset: 'dusk' } },
      { op: 'set_environment', patch: { doorState: 'open' } },
    ]),
  );
  await expect(page.locator('#sky-preset')).toHaveValue('dusk');
  await expect(page.locator('#doors-open')).toBeChecked();
  await expect(page.locator('#retry-agent-ack')).toHaveCount(0);
  await expect.poll(() => mock.ackRequests.length).toBe(1);

  await page.locator('#undo').click();
  await expect(page.locator('#sky-preset')).toHaveValue('soft-afternoon');
  await expect(page.locator('#doors-open')).not.toBeChecked();
  await expect(page.locator('#undo')).toBeDisabled();
});

test('manual edit makes a previously streamed proposal stale', async ({ page }) => {
  const mock = await openEditor(page);
  await saveScene(page);
  const turn = await startTurn(page);
  await page.locator('#doors-open').check();
  await sendFrames(
    page,
    proposalEvents(turn, [{ op: 'set_environment', patch: { skyPreset: 'dusk' } }]),
  );
  await expect(page.locator('#conversation')).toContainText('你已继续编辑');
  await expect(page.locator('#sky-preset')).toHaveValue('soft-afternoon');
  await expect(page.locator('#doors-open')).toBeChecked();
  expect(mock.ackRequests).toHaveLength(0);
});

test('stopping locally prevents late proposal frames from applying', async ({ page }) => {
  const mock = await openEditor(page);
  await saveScene(page);
  const turn = await startTurn(page);
  await page.locator('#agent-stop').click();
  await expect(page.locator('#agent-stop')).toBeHidden();
  await sendFrames(
    page,
    proposalEvents(turn, [
      { op: 'set_environment', patch: { skyPreset: 'dusk' } },
      { op: 'set_environment', patch: { doorState: 'open' } },
    ]),
  );
  await expect(page.locator('#sky-preset')).toHaveValue('soft-afternoon');
  await expect(page.locator('#doors-open')).not.toBeChecked();
  await expect(page.locator('#notice')).toContainText('仍可能继续处理并计费');
  await expect.poll(() => mock.cancelRequests).toBe(1);
  expect(mock.ackRequests).toHaveLength(0);
});

test('failed acknowledgement survives reload and opening a local copy without reapplying operations', async ({
  page,
}) => {
  const mock = await openEditor(page);
  mock.failFirstAck = true;
  await saveScene(page);
  const turn = await startTurn(page);
  await sendFrames(
    page,
    proposalEvents(turn, [
      { op: 'set_environment', patch: { skyPreset: 'dusk' } },
      { op: 'set_environment', patch: { doorState: 'open' } },
    ]),
  );
  await waitForPendingAck(page);
  await expect(page.locator('#retry-agent-ack')).toBeVisible();

  await page.reload();
  await expect(page.locator('#renderer-loading')).toBeHidden({ timeout: 45_000 });
  await expect(page.locator('#retry-agent-ack')).toBeVisible();
  await page.locator('#open-library').click();
  await expect(page.locator('#library-dialog')).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('.library-group').first().locator('.library-item button').first().click();
  await expect(page.locator('#retry-agent-ack')).toBeVisible();
  await expect(page.locator('#notice')).toContainText('不会重复应用操作');
  await page.waitForFunction(async () => {
    const { createDraftStore } = await import('/js/editor/persistence.js');
    const store = await createDraftStore();
    const entries = await store.list('draft:');
    store.close();
    return entries.filter(({ value }) => value.pendingAck?.turnId).length >= 2;
  });

  await page.reload();
  await expect(page.locator('#renderer-loading')).toBeHidden({ timeout: 45_000 });
  await expect(page.locator('#retry-agent-ack')).toBeVisible();
  await page.locator('#retry-agent-ack').click();
  await expect(page.locator('#retry-agent-ack')).toHaveCount(0);
  await expect.poll(() => mock.ackRequests.length).toBe(2);
  expect(await page.evaluate(() => sessionStorage.getItem('loom-test-agent-starts'))).toBe('1');

  await expect(page.locator('#sky-preset')).toHaveValue('dusk');
  await expect(page.locator('#doors-open')).toBeChecked();
  await page.locator('#undo').click();
  await expect(page.locator('#sky-preset')).toHaveValue('soft-afternoon');
  await expect(page.locator('#doors-open')).not.toBeChecked();
  await expect(page.locator('#undo')).toBeDisabled();
});

test('recovered turn status is queried explicitly and unknown local state can be cleared', async ({
  page,
}) => {
  const mock = await openEditor(page);
  await saveScene(page);
  const entries = await readDrafts(page);
  const pointer = await page.evaluate(() => sessionStorage.getItem('loom-space-tab-draft-record'));
  const current = entries.find(({ key }) => key === `draft:${pointer}`);
  expect(current).toBeTruthy();
  await page.evaluate(async (key) => {
    const { createDraftStore } = await import('/js/editor/persistence.js');
    const store = await createDraftStore();
    const entry = await store.load(key);
    await store.save(key, {
      ...entry,
      pendingTurn: {
        turnId: crypto.randomUUID(),
        conversationId: 'conv_test_123456',
        editorSessionId: 'editor_test_session_01',
        baseDraftVersion: 0,
        lastEventId: null,
      },
    });
    store.close();
  }, current.key);

  await page.reload();
  await expect(page.locator('#renderer-loading')).toBeHidden({ timeout: 45_000 });
  await expect(page.locator('#agent-send')).toBeDisabled();
  await expect(page.locator('#conversation')).toContainText('清除此提示不会停止旧任务');
  await page.getByRole('button', { name: '查询上次任务状态' }).click();
  await expect(page.locator('#conversation')).toContainText('服务端没有可确认的任务状态');
  expect(mock.statusRequests).toHaveLength(1);
  expect(mock.statusRequests[0].conversationId).toBe('conv_test_123456');
  expect(await page.evaluate(() => sessionStorage.getItem('loom-test-agent-starts'))).toBeNull();
  await page.getByRole('button', { name: '清除此恢复提示' }).click();
  await expect(page.locator('#agent-send')).toBeEnabled();
  await expect
    .poll(async () => {
      const records = await readDrafts(page);
      return records.find(({ key }) => key === current.key)?.value.pendingTurn || null;
    })
    .toBeNull();
});

test('a disconnected turn is retained and status recovery never starts a second model request', async ({
  page,
}) => {
  const mock = await openEditor(page);
  await saveScene(page);
  const turn = await startTurn(page);
  await page.evaluate(() =>
    window.__loomSyntheticAgent.controller.error(new Error('synthetic stream disconnect')),
  );
  await expect(page.getByRole('button', { name: '查询上次任务状态' })).toBeVisible();
  await waitForPendingTurn(page);
  await expect(page.locator('#sky-preset')).toHaveValue('soft-afternoon');

  await page.reload();
  await expect(page.locator('#renderer-loading')).toBeHidden({ timeout: 45_000 });
  await expect(page.getByRole('button', { name: '查询上次任务状态' })).toBeVisible();
  await expect(page.locator('#agent-send')).toBeDisabled();
  expect(mock.statusRequests).toHaveLength(0);
  expect(await page.evaluate(() => sessionStorage.getItem('loom-test-agent-starts'))).toBe('1');

  await page.getByRole('button', { name: '查询上次任务状态' }).click();
  await expect(page.locator('#conversation')).toContainText('服务端没有可确认的任务状态');
  expect(mock.statusRequests).toHaveLength(1);
  expect(mock.statusRequests[0].turnId).toBe(turn.turnId);
  expect(mock.statusRequests[0].conversationId).toBe('conv_test_123456');
  expect(await page.evaluate(() => sessionStorage.getItem('loom-test-agent-starts'))).toBe('1');
});

test('a 401 invalidates the local agent and cloud session', async ({ page }) => {
  const mock = await openEditor(page);
  await page.locator('[data-add="garden.lamp"]').click();
  mock.failSave401 = true;
  await page.locator('#save-scene').click();
  await expect(page.locator('#notice')).toContainText('浏览器身份已失效');
  await expect(page.locator('#save-scene')).toBeDisabled();
  await expect(page.locator('#agent-prompt')).toBeDisabled();
});

test('an inaccessible cloud space drops its stale agent recovery state before continuing as a new copy', async ({
  page,
}) => {
  const mock = await openEditor(page);
  await saveScene(page);
  const entries = await readDrafts(page);
  const pointer = await page.evaluate(() => sessionStorage.getItem('loom-space-tab-draft-record'));
  const current = entries.find(({ key }) => key === `draft:${pointer}`);
  expect(current).toBeTruthy();
  await page.evaluate(
    async ({ key, oldSpaceId }) => {
      const { createDraftStore } = await import('/js/editor/persistence.js');
      const store = await createDraftStore();
      const entry = await store.load(key);
      await store.save(key, {
        ...entry,
        pendingAck: {
          spaceId: oldSpaceId,
          turnId: crypto.randomUUID(),
          proposalId: `pr_${'a'.repeat(32)}`,
          conversationId: 'conv_old_123456',
          editorSessionId: 'editor_old_session_01',
          baseDraftVersion: 0,
          appliedDraftVersion: 1,
          outcome: 'scene_applied',
        },
        pendingTurn: {
          spaceId: oldSpaceId,
          turnId: crypto.randomUUID(),
          conversationId: 'conv_old_123456',
          editorSessionId: 'editor_old_session_01',
          baseDraftVersion: 0,
          lastEventId: null,
        },
      });
      store.close();
    },
    { key: current.key, oldSpaceId: current.value.spaceId },
  );
  mock.loseRevision = true;

  await page.reload();
  await expect(page.locator('#renderer-loading')).toBeHidden({ timeout: 45_000 });
  await expect(page.locator('#notice')).toContainText('本地内容已保留为新副本');
  await expect(page.locator('#retry-agent-ack')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '查询上次任务状态' })).toHaveCount(0);
  await page.locator('#save-scene').click();
  await expect(page.locator('#save-status')).toHaveText('已保存');
  await expect(page.locator('#agent-send')).toBeEnabled();
  await expect
    .poll(async () => {
      const records = await readDrafts(page);
      const draft = records.find(({ key }) => key === current.key)?.value;
      return { pendingAck: draft?.pendingAck ?? null, pendingTurn: draft?.pendingTurn ?? null };
    })
    .toEqual({ pendingAck: null, pendingTurn: null });
});

test('persisted pagehide/pageshow keeps renderer live', async ({ page }) => {
  await openEditor(page);
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await page.locator('[data-add="garden.bench.wood"]').click();
  await expect(page.locator('#object-list option')).toHaveCount(1);
  await expect(page.locator('#notice')).toBeHidden();
});

test('new scene keeps the old local draft and this tab reloads its new branch', async ({
  page,
}) => {
  await openEditor(page, { agentEnabled: false });
  await page.locator('#scene-title').fill('旧草稿');
  await page.locator('#scene-title').press('Tab');
  await page.locator('[data-add="garden.lamp"]').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#new-scene').click();
  await expect(page.locator('#notice')).toContainText('已创建本地副本');
  await page.locator('#scene-title').fill('新标签分支');
  await page.locator('#scene-title').press('Tab');
  await page.locator('[data-add="garden.tree"]').click();
  await page.waitForFunction(async () => {
    const { createDraftStore } = await import('/js/editor/persistence.js');
    const store = await createDraftStore();
    const entries = await store.list('draft:');
    store.close();
    return (
      entries.some(
        ({ value }) => value.scene.title === '旧草稿' && value.scene.objects.length === 1,
      ) &&
      entries.some(
        ({ value }) => value.scene.title === '新标签分支' && value.scene.objects.length === 1,
      )
    );
  });

  await page.reload();
  await expect(page.locator('#renderer-loading')).toBeHidden({ timeout: 45_000 });
  await expect(page.locator('#scene-title')).toHaveValue('新标签分支');
  await expect(page.locator('#object-list option')).toHaveText('园林树 1');
  await page.locator('#open-library').click();
  await expect(page.locator('.library-group').first()).toContainText('旧草稿');
  await expect(page.locator('.library-group').first()).toContainText('新标签分支');
});

test('duplicated tabs fork session storage draft pointers and independently recover after reload', async ({
  page,
}) => {
  await openEditor(page, { agentEnabled: false });
  await editTitle(page, '原标签草稿');
  const originalPointer = await page.evaluate(() =>
    sessionStorage.getItem('loom-space-tab-draft-record'),
  );
  expect(originalPointer).toBeTruthy();

  const popupPromise = page.waitForEvent('popup');
  await page.evaluate(() => window.open('about:blank', '_blank'));
  const popup = await popupPromise;
  const duplicatedPointer = await popup.evaluate(() =>
    sessionStorage.getItem('loom-space-tab-draft-record'),
  );
  expect(duplicatedPointer).toBe(originalPointer);
  await installMocks(popup, { agentEnabled: false });
  await popup.goto('/create.html');
  await expect(popup.locator('#renderer-loading')).toBeHidden({ timeout: 45_000 });
  await expect(popup.locator('#scene-title')).toHaveValue('原标签草稿');
  const branchPointer = await popup.evaluate(() =>
    sessionStorage.getItem('loom-space-tab-draft-record'),
  );
  expect(branchPointer).not.toBe(originalPointer);

  await editTitle(popup, '重复标签分支');
  const entries = await readDrafts(page);
  const original = entries.find(({ value }) => value.scene.title === '原标签草稿');
  const branch = entries.find(({ value }) => value.scene.title === '重复标签分支');
  expect(original).toBeTruthy();
  expect(branch).toBeTruthy();
  expect(branch.key).not.toBe(original.key);

  await page.reload();
  await expect(page.locator('#renderer-loading')).toBeHidden({ timeout: 45_000 });
  await expect(page.locator('#scene-title')).toHaveValue('原标签草稿');
  await popup.reload();
  await expect(popup.locator('#renderer-loading')).toBeHidden({ timeout: 45_000 });
  await expect(popup.locator('#scene-title')).toHaveValue('重复标签分支');

  const recovered = await readDrafts(popup);
  expect(recovered.find(({ value }) => value.scene.title === '原标签草稿')?.key).toBe(original.key);
  expect(recovered.find(({ value }) => value.scene.title === '重复标签分支')?.key).toBe(branch.key);
  await popup.close();
});
