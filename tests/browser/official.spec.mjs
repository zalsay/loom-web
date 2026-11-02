import { test, expect } from '@playwright/test';

test('official scene retains its camera, door and landscape controls', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Keep control regression independent from upstream weather service availability.
  await page.route('**/api/world-weather', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        weatherStatus: 'unavailable',
        sunStatus: 'unavailable',
        current: null,
        sun: null,
      }),
    }),
  );
  await page.goto('/world.html');
  // The official viewer fades the overlay with opacity, which remains "visible"
  // under Playwright's box-based visibility definition.
  await expect(page.locator('#loading')).toHaveClass('hidden', { timeout: 45_000 });
  await expect(page.locator('#viewport canvas')).toBeVisible();
  await page.locator('[data-view="eye"]').click();
  await expect(page.locator('[data-view="eye"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#doors').check();
  expect(
    await page.evaluate(() => {
      const doors = [];
      window.loomWorld.model.building.traverse((object) => {
        if (object.userData.doorLeaf) doors.push(object);
      });
      const frontFacade = window.loomWorld.model.building.getObjectByName('玻璃房正面固定玻璃立面');
      const frontNames = [];
      frontFacade?.traverse((object) => frontNames.push(object.name));
      return (
        doors.length === 2 &&
        doors.every((door) => door.parent.name === '栅格区前方双开玻璃门') &&
        frontNames.includes('正面固定玻璃') &&
        frontNames.includes('正面固定玻璃竖向接缝') &&
        frontNames.includes('正面固定玻璃底部轨道') &&
        frontNames.includes('正面固定玻璃顶部轨道') &&
        frontNames.every((name) => !/门|拉手|铰链/.test(name)) &&
        doors.every(
          (door) =>
            Math.abs(
              door.rotation.y - ((door.userData.closedAngle || 0) + door.userData.openAngle),
            ) < 0.0001,
        )
      );
    }),
  ).toBe(true);
  await page.locator('#landscape').uncheck();
  expect(await page.evaluate(() => window.loomWorld.model.landscape.visible)).toBe(false);
  await page.locator('#autorotate').check();
  await page.locator('#reset').click();
  await expect(page.locator('[data-view="perspective"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#autorotate')).not.toBeChecked();
  await expect(page.locator('.world-options a[href="./create.html"]')).toBeVisible();
  expect(errors).toEqual([]);
});
