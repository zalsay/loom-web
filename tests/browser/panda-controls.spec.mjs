import { test, expect } from '@playwright/test';

async function openWorld(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.route('**/api/world-weather', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
  await page.goto('/world.html');
  await expect(page.locator('#loading')).toHaveClass('hidden', { timeout: 45_000 });
  return errors;
}

async function pose(page) {
  return page.evaluate(() => {
    const panda = window.loomWorld.model.panda;
    return {
      name: panda.name,
      position: panda.position.toArray(),
      rotation: panda.rotation.toArray(),
    };
  });
}

test('ground gameplay is removed and keyboard actions cannot move the roof sculpture', async ({
  page,
}) => {
  const errors = await openWorld(page);
  await expect(
    page.locator('#panda-control-toggle, #panda-controls, #panda-stick, #panda-jump, #panda-run'),
  ).toHaveCount(0);
  const before = await pose(page);
  expect(before.name).toBe('LoomOS Rooftop Panda');
  expect(
    await page.evaluate(() => {
      const w = window.loomWorld;
      return (
        !w.pandaController &&
        !w.pandaInput &&
        !w.setPandaMode &&
        !w.model.root.getObjectByName('LoomOS Panda')
      );
    }),
  ).toBe(true);
  await page.keyboard.down('w');
  await page.keyboard.down('Shift');
  await page.keyboard.press('Space');
  await page.waitForTimeout(300);
  await page.keyboard.up('Shift');
  await page.keyboard.up('w');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Escape');
  expect(await pose(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test('view, landscape, side doors and reset still work with a static rooftop panda', async ({
  page,
}) => {
  const errors = await openWorld(page);
  const before = await pose(page);
  await page.locator('[data-view="aerial"]').click();
  await expect(page.locator('[data-view="aerial"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#landscape').uncheck();
  expect(await page.evaluate(() => window.loomWorld.model.landscape.visible)).toBe(false);
  await page.locator('#doors').check();
  const doors = await page.evaluate(() => {
    const leaves = [];
    window.loomWorld.model.building.traverse((object) => {
      if (object.userData.doorLeaf) leaves.push(object);
    });
    const facade = window.loomWorld.model.building.getObjectByName('玻璃房正面固定玻璃立面');
    const names = [];
    facade.traverse((object) => names.push(object.name));
    return {
      count: leaves.length,
      frontFixed: names.every((name) => !/门|拉手|铰链/.test(name)),
      open: leaves.every(
        (door) =>
          Math.abs(door.rotation.y - ((door.userData.closedAngle || 0) + door.userData.openAngle)) <
          0.0001,
      ),
    };
  });
  expect(doors).toEqual({ count: 2, frontFixed: true, open: true });
  await page.locator('#autorotate').check();
  expect(await page.evaluate(() => window.loomWorld.controls.autoRotate)).toBe(true);
  await page.locator('#reset').click();
  await expect(page.locator('[data-view="perspective"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.loomWorld.controls.autoRotate)).toBe(false);
  expect(await pose(page)).toEqual(before);
  expect(errors).toEqual([]);
});
