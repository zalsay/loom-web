import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

for (const viewport of [
  { width: 390, height: 844 },
  { width: 926, height: 428 },
]) {
  test(`touch editing retains history, cloud save, export and read-only sharing at ${viewport.width}x${viewport.height}`, async ({
    browser,
  }) => {
    const options = { baseURL: test.info().project.use.baseURL, viewport, hasTouch: true };
    const owner = await browser.newContext(options);
    const visitor = await browser.newContext(options);
    try {
      const page = await owner.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto('/create.html');
      await expect(page.locator('#renderer-loading')).toBeHidden({ timeout: 45_000 });
      await expect(page.locator('#save-scene')).toBeEnabled();

      await page.locator('.mobile-switch [data-panel="properties"]').tap();
      await page.locator('[data-add="garden.bench.wood"]').tap();
      await expect(page.locator('#object-list option')).toHaveCount(1);
      await page.locator('#undo').tap();
      await expect(page.locator('#object-list option')).toHaveCount(0);
      await page.locator('#redo').tap();
      await expect(page.locator('#object-list option')).toHaveCount(1);

      const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.locator('#export-scene').tap(),
      ]);
      const document = JSON.parse(await readFile(await download.path(), 'utf8'));
      expect(document.objects).toHaveLength(1);
      expect(JSON.stringify(document)).not.toMatch(/ownerId|visitorId|conversationId|Cookie/);

      await page.locator('.mobile-switch [data-panel="canvas"]').tap();
      await page.locator('#save-scene').tap();
      await expect(page.locator('#save-status')).toHaveText('已保存');
      await page.locator('#open-library').tap();
      await expect(page.locator('#library-dialog')).toBeVisible();
      await expect(page.locator('.library-group').last().locator('.library-item')).toHaveCount(1);
      await page.locator('[data-close="library-dialog"]').tap();

      await page.locator('.mobile-switch [data-panel="assistant"]').tap();
      await page.locator('#share-scene').tap();
      await page.locator('#confirm-share').tap();
      await expect(page.locator('#share-result')).toBeVisible();
      const url = await page.locator('#share-url').inputValue();
      const shared = await visitor.newPage();
      await shared.goto(url);
      await expect(shared.locator('#renderer-loading')).toBeHidden({ timeout: 45_000 });
      await expect(shared.locator('.properties')).toBeHidden();
      await expect(shared.locator('.assistant')).toBeHidden();
      await expect(shared.locator('.mobile-switch')).toBeHidden();
      await expect(shared.locator('#save-scene')).toBeHidden();
      expect(await visitor.cookies()).toEqual([]);
      expect(
        await shared.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(1);

      page.once('dialog', (dialog) => dialog.accept());
      await page.locator('#revoke-share').tap();
      await expect(page.locator('#share-message')).toContainText('已撤销');
      expect(errors).toEqual([]);
    } finally {
      await owner.close();
      await visitor.close();
    }
  });
}
