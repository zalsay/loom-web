import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

async function openEditor(page) {
  await page.goto('/create.html');
  await expect(page.locator('#renderer-loading')).toBeHidden({ timeout: 45_000 });
  await expect(page.locator('#save-scene')).toBeEnabled();
}

async function exportDocument(page) {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#export-scene').click(),
  ]);
  return JSON.parse(await readFile(await download.path(), 'utf8'));
}

async function save(page) {
  await page.locator('#save-scene').click();
  await expect(page.locator('#save-status')).toHaveText('已保存');
}

test('official viewer stays separate and the editor supports atomic manual history and export', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('.desktop-nav a[href="./create.html"]')).toBeVisible();
  await openEditor(page);
  await expect(page.locator('#agent-status')).toContainText('助手尚未启用');
  await page.locator('[data-add="garden.bench.wood"]').click();
  await expect(page.locator('#object-list option')).toHaveCount(1);
  await page.locator('[data-vector="position"][data-axis="0"]').fill('11');
  await page.locator('[data-vector="position"][data-axis="0"]').press('Tab');
  await page.locator('#undo').click();
  await expect(page.locator('[data-vector="position"][data-axis="0"]')).toHaveValue('5');
  await page.locator('#redo').click();
  await expect(page.locator('[data-vector="position"][data-axis="0"]')).toHaveValue('11');
  await page.locator('#sky-preset').selectOption('dusk');
  await page.locator('summary').filter({ hasText: '廊亭材质' }).click();
  await page.locator('#frame-material').selectOption('metal.graphite');
  const scene = await exportDocument(page);
  expect(scene.objects[0].transform.position[0]).toBe(11);
  expect(scene.environment.skyPreset).toBe('dusk');
  expect(scene.templateOverrides).toContainEqual({
    targetId: 'pavilion.frame',
    materialSlot: 'surface',
    materialId: 'metal.graphite',
  });
  expect(JSON.stringify(scene)).not.toMatch(/ownerId|visitorId|conversationId|Cookie/);
  expect(errors).toEqual([]);
});

test('real IndexedDB restores scene and undo history without flattening other tab drafts', async ({
  page,
  context,
}) => {
  await openEditor(page);
  await page.locator('[data-add="garden.bamboo-cluster"]').click();
  await expect(page.locator('#object-list option')).toHaveCount(1);
  await page.waitForFunction(async () => {
    const { createDraftStore } = await import('/js/editor/persistence.js');
    const store = await createDraftStore();
    const entries = await store.list('draft:');
    store.close();
    return entries.some(({ value }) => value.scene.objects.length === 1);
  });
  await page.reload();
  await expect(page.locator('#renderer-loading')).toBeHidden({ timeout: 45_000 });
  await expect(page.locator('#object-list option')).toHaveCount(1);
  await expect(page.locator('#undo')).toBeEnabled();
  await page.locator('#undo').click();
  await expect(page.locator('#object-list option')).toHaveCount(0);
  const other = await context.newPage();
  await openEditor(other);
  await other.locator('[data-add="garden.lamp"]').click();
  await other.locator('#scene-title').fill('另一个标签页');
  await other.locator('#scene-title').press('Tab');
  await page.locator('[data-add="garden.tree"]').click();
  await page.locator('#open-library').click();
  await expect(page.locator('#library-content')).toContainText('另一个标签页');
  const entries = await page.evaluate(async () => {
    const { createDraftStore } = await import('/js/editor/persistence.js');
    const store = await createDraftStore();
    const entries = await store.list('draft:');
    store.close();
    return entries.map(({ key }) => key);
  });
  // Reload reuses this tab's record; the second tab receives one independent record.
  expect(new Set(entries).size).toBe(2);
});

test('cloud save, read-only snapshots and revoke do not expose editing authority', async ({
  page,
  browser,
}) => {
  await openEditor(page);
  await page.locator('[data-add="garden.lamp"]').click();
  await save(page);
  await page.locator('#share-scene').click();
  await page.locator('#confirm-share').click();
  await expect(page.locator('#share-result')).toBeVisible();
  const url = await page.locator('#share-url').inputValue();
  const publicContext = await browser.newContext();
  const viewer = await publicContext.newPage();
  await viewer.goto(url);
  await expect(viewer.locator('#renderer-loading')).toBeHidden({ timeout: 45_000 });
  await expect(viewer.locator('.properties')).toBeHidden();
  await expect(viewer.locator('#save-scene')).toBeHidden();
  expect(await publicContext.cookies()).toEqual([]);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#revoke-share').click();
  await expect(page.locator('#share-message')).toContainText('已撤销');
  await viewer.reload();
  await expect(viewer.locator('#renderer-loading')).toHaveText('这份分享已被撤销。');
  await publicContext.close();
});

test('cleared identity cannot claim old cloud content; local data remains a new copy', async ({
  page,
  context,
}) => {
  await openEditor(page);
  await page.locator('[data-add="garden.bench.wood"]').click();
  await save(page);
  await context.clearCookies();
  await page.reload();
  await expect(page.locator('#renderer-loading')).toBeHidden({ timeout: 45_000 });
  await expect(page.locator('#notice')).toContainText('不能认领旧空间');
  await expect(page.locator('#object-list option')).toHaveCount(1);
  await save(page);
  await page.locator('#open-library').click();
  await expect(page.locator('.library-group').last().locator('.library-item')).toHaveCount(1);
});

test('offline changes stay dirty and import rejects executable or unknown fields', async ({
  page,
  context,
}) => {
  await openEditor(page);
  await save(page);
  await context.setOffline(true);
  await page.locator('[data-add="garden.tree"]').click();
  await page.locator('#save-scene').click();
  await expect(page.locator('#save-status')).toContainText('尚未同步');
  const scene = await exportDocument(page);
  expect(scene.objects).toHaveLength(1);
  await context.setOffline(false);
  await page.locator('#import-file').setInputFiles({
    name: 'unsafe.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...scene, script: 'alert(1)' })),
  });
  await expect(page.locator('#notice')).toHaveAttribute('data-tone', 'error');
  await expect(page.locator('#object-list option')).toHaveCount(1);
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('#import-file').setInputFiles({
    name: 'backup.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(scene)),
  });
  await expect(page.locator('#notice')).toContainText('已导入');
  await expect(page.locator('#save-status')).toContainText('尚未同步');
});

test('storage denial is visible and does not claim a safe local save', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      get() {
        throw new Error('Storage denied');
      },
    });
  });
  await openEditor(page);
  await expect(page.locator('#save-status')).toContainText('本地保存失败');
  await page.locator('[data-add="garden.lamp"]').click();
  expect((await exportDocument(page)).objects).toHaveLength(1);
});

test('mobile panels remain usable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openEditor(page);
  await page.locator('[data-panel="properties"]').click();
  await expect(page.locator('.properties')).toBeVisible();
  await page.locator('[data-add="garden.bench.wood"]').click();
  await expect(page.locator('#object-list option')).toHaveCount(1);
  await page.locator('[data-panel="assistant"]').click();
  await expect(page.locator('.assistant')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('[data-panel="canvas"]').click();
  await expect(page.locator('.properties')).toBeHidden();
  await expect(page.locator('.assistant')).toBeHidden();
});

test('SVG fallback is explicit and preserves document semantics', async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (type === 'webgl2' || type === 'webgl') return null;
      return getContext.call(this, type, ...args);
    };
  });
  await openEditor(page);
  await expect(page.locator('#viewport svg')).toBeVisible();
  await expect(page.locator('#render-status')).toContainText('简化');
  await page.locator('[data-add="garden.bench.wood"]').click();
  expect((await exportDocument(page)).objects[0].assetId).toBe('garden.bench.wood');
});
