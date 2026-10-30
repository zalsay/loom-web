import { test, expect } from '@playwright/test';

async function openEditor(page) {
  await page.goto('/create.html');
  await expect(page.locator('#renderer-loading')).toBeHidden({ timeout: 45_000 });
  await expect(page.locator('#save-scene')).toBeEnabled();
}

test('simultaneous first-visit tabs bootstrap one shared HttpOnly identity', async ({
  page,
  context,
}) => {
  let bootstrapCount = 0;
  context.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/v1/session/bootstrap'))
      bootstrapCount++;
  });
  const other = await context.newPage();
  await Promise.all([openEditor(page), openEditor(other)]);
  expect(bootstrapCount).toBe(1);
  const cookies = await context.cookies();
  const identity = cookies.filter((cookie) => cookie.name === 'loom-visitor');
  expect(identity).toHaveLength(1);
  expect(identity[0].httpOnly).toBe(true);
  expect(identity[0].sameSite).toBe('Lax');
  expect(await page.evaluate(() => document.cookie.includes('loom-visitor'))).toBe(false);
  await expect(other.locator('#save-scene')).toBeEnabled();
});

test('an unknown save result survives reload and retries the same immutable attempt', async ({
  page,
}) => {
  await openEditor(page);
  await page.locator('#scene-title').fill('未知响应恢复');
  await page.locator('#scene-title').press('Tab');
  const attempts = [];
  await page.route('**/api/v1/spaces/*/revisions', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    attempts.push(route.request().postDataJSON());
    const response = await route.fetch();
    if (attempts.length === 1) return route.abort('failed');
    return route.fulfill({ response });
  });
  await page.locator('#save-scene').click();
  await expect(page.locator('#notice')).toHaveAttribute('data-tone', 'error');
  await expect(page.locator('#save-status')).toContainText('尚未同步');
  await page.waitForFunction(async () => {
    const { createDraftStore } = await import('/js/editor/persistence.js');
    const store = await createDraftStore();
    const entries = await store.list('draft:');
    store.close();
    return entries.some(({ value }) => value.scene.title === '未知响应恢复' && value.pendingSave);
  });
  await page.reload();
  await expect(page.locator('#renderer-loading')).toBeHidden({ timeout: 45_000 });
  await expect(page.locator('#save-scene')).toBeEnabled();
  await page.locator('#save-scene').click();
  await expect(page.locator('#save-status')).toHaveText('已保存');
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await page.locator('#open-library').click();
  await expect(page.locator('.library-group').last().locator('.library-item')).toHaveCount(1);
});

test('a delayed save from a previous same-space draft cannot advance the opened branch', async ({
  page,
}) => {
  await openEditor(page);
  let initialRevision;
  page.on('response', async (response) => {
    if (
      response.request().method() === 'PUT' &&
      /\/revisions$/.test(response.url()) &&
      !initialRevision
    ) {
      initialRevision = (await response.json()).revisionId;
    }
  });
  await page.locator('#save-scene').click();
  await expect(page.locator('#save-status')).toHaveText('已保存');
  await expect.poll(() => initialRevision).toBeTruthy();
  let release;
  const delayed = new Promise((resolve) => {
    release = resolve;
  });
  let delayedRequestSeen = false;
  let nextParent;
  await page.route('**/api/v1/spaces/*/revisions', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    if (!delayedRequestSeen) {
      delayedRequestSeen = true;
      await delayed;
      return route.fulfill({
        json: {
          revisionId: 'rev_late_old_draft_123456',
          parentRevisionId: initialRevision,
          siblings: [],
        },
      });
    }
    nextParent = route.request().postDataJSON().parentRevisionId;
    const response = await route.fetch();
    return route.fulfill({ response });
  });
  await page.locator('#scene-title').fill('旧草稿的迟到保存');
  await page.locator('#scene-title').press('Tab');
  await page.locator('#save-scene').click();
  await expect.poll(() => delayedRequestSeen).toBe(true);
  await page.locator('#open-library').click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('.library-group').last().getByRole('button', { name: '打开副本' }).click();
  await expect(page.locator('#library-dialog')).not.toBeVisible();
  await expect(page.locator('#scene-title')).not.toHaveValue('旧草稿的迟到保存');
  release();
  await expect(page.locator('#save-scene')).toBeEnabled();
  await page.locator('#scene-title').fill('当前分支的新修改');
  await page.locator('#scene-title').press('Tab');
  await page.locator('#save-scene').click();
  await expect(page.locator('#save-status')).toHaveText('已保存');
  expect(nextParent).toBe(initialRevision);
});
