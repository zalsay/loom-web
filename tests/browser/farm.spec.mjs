import { test, expect } from '@playwright/test';

test.use({ reducedMotion: 'reduce' });

async function rendered(page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  );
}

async function openFarm(page, url = '/farm.html') {
  await page.goto(url);
  await expect(page.locator('#canvas-container canvas')).toBeVisible();
  await rendered(page);
}

test('farm crops, rover focus and all guided views remain usable after refinement', async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openFarm(page);
  for (const id of [1, 2, 3, 4, 5, 6]) {
    await page.locator(`[data-plot="${id}"]`).click();
    await expect(page.locator('#info-card')).not.toHaveClass(/hidden/);
    await expect(page.locator('#card-title')).toContainText(String(id).padStart(2, '0'));
  }
  for (const id of [0, 1]) {
    await page.locator(`[data-rover="${id}"]`).click();
    await expect(page.locator('#card-title')).toContainText(`${String(id + 1).padStart(2, '0')}号`);
  }
  await page.locator('#card-close').click();
  for (const view of ['control-room', 'agent-screen', 'plan', 'overview']) {
    await page.locator(`[data-view="${view}"]`).click();
    await rendered(page);
    await expect(page.locator(`[data-view="${view}"]`)).toHaveClass(/active/);
  }
  await page.locator('#toggle-drip').uncheck();
  await expect(page.locator('#toggle-drip')).not.toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('farm-overview.png') });
  expect(errors).toEqual([]);
});

test('returning to daylight restores the same rendered scene after dusk and night', async ({
  page,
}, testInfo) => {
  await openFarm(page);
  const canvas = page.locator('#canvas-container canvas');
  const daylight = await canvas.screenshot();
  await page.locator('#select-light').selectOption('dusk');
  await rendered(page);
  const dusk = await canvas.screenshot();
  expect(dusk.equals(daylight)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('farm-dusk.png') });
  await page.locator('#select-light').selectOption('night');
  await rendered(page);
  await page.screenshot({ path: testInfo.outputPath('farm-night.png') });
  await page.locator('#select-light').selectOption('day');
  await rendered(page);
  expect((await canvas.screenshot()).equals(daylight)).toBe(true);
});

test('mobile scene and embedded preview render without horizontal overflow', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openFarm(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  for (const link of await page.locator('.nav-btn').all()) {
    const bounds = await link.boundingBox();
    expect(bounds.height).toBeLessThan(42);
  }
  await page.screenshot({ path: testInfo.outputPath('farm-mobile.png') });
  await page.locator('[data-plot="3"]').click();
  await expect(page.locator('#card-title')).toContainText('草莓');
  await openFarm(page, '/farm.html?embedded');
  await expect(page.locator('.hud-panel')).toBeHidden();
  await expect(page.locator('.top-bar')).toBeHidden();
  const bounds = await page.locator('#canvas-container canvas').boundingBox();
  expect(bounds.width).toBe(390);
  expect(bounds.height).toBe(844);
  await page.screenshot({ path: testInfo.outputPath('farm-embedded.png') });
});

test('dragging a crop rotates the camera without opening its card, while a click selects it', async ({
  page,
}) => {
  await openFarm(page);
  const canvas = page.locator('#canvas-container canvas');
  const bounds = await canvas.boundingBox();
  const x = bounds.x + bounds.width / 2,
    y = bounds.y + bounds.height / 2;
  await page.locator('[data-plot="2"]').click();
  await page.locator('#card-close').click();
  await rendered(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 80, y + 30, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#info-card')).toHaveClass(/hidden/);
  await page.locator('[data-plot="2"]').click();
  await page.locator('#card-close').click();
  await rendered(page);
  await page.mouse.click(x, y);
  await expect(page.locator('#card-title')).toContainText('02');
  await expect(page.locator('#info-card')).not.toHaveClass(/hidden/);
});
