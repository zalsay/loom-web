import { test, expect } from '@playwright/test';

test.use({ trace: { mode: 'retain-on-failure', snapshots: false, screenshots: false } });

async function openWorld(page, { fallback = false, reducedMotion = 'reduce' } = {}) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion });
  await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+08:00'));
  await page.route('**/api/world-weather', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
  if (fallback)
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        if (type === 'webgl' || type === 'webgl2') return null;
        return original.call(this, type, ...args);
      };
    });
  await page.goto('/world.html');
  await expect(page.locator('#loading')).toHaveClass('hidden', { timeout: 45_000 });
  return errors;
}

async function visibility(page) {
  return page.evaluate(() => {
    const w = window.loomWorld;
    const visible = [];
    let devices = 0;
    let tables = 0;
    let lights = 0;
    w.model.root.traverseVisible((object) => {
      if (object.isMesh || object.isLine || object.isInstancedMesh) visible.push(object.name);
      if (object.userData.device) devices++;
      if (object.userData.storeTable) tables++;
      if (object.isPointLight) lights++;
    });
    const effective = (object) => {
      for (let node = object; node; node = node.parent) if (!node.visible) return false;
      return true;
    };
    return {
      active: w.laboratoryView.active,
      visible,
      tables,
      devices,
      lights,
      laboratory: effective(w.model.laboratory),
      ground: effective(w.model.ground),
      landscape: effective(w.model.landscape),
      panda: effective(w.model.panda),
      roof: effective(w.model.building.getObjectByName('屋面顶板与金属压边')),
      roomCeiling: effective(w.model.laboratory.getObjectByName('店内暖白天花')),
      maxDistance: w.controls.maxDistance,
    };
  });
}

test('walk into the laboratory renders only its room, then restores exterior state and controls', async ({
  page,
}) => {
  const errors = await openWorld(page);
  const entry = page.getByRole('button', { name: '走进实验室', exact: true });
  await expect(entry).toBeVisible();
  await expect(page.getByRole('button', { name: '店内看看', exact: true })).toHaveCount(0);
  const before = await visibility(page);
  await page.locator('#landscape').uncheck();
  await page.evaluate(() => {
    const w = window.loomWorld;
    w.model.building.getObjectByName('檐口分缝').visible = false;
    window.__laboratoryRendered = new Set();
    if (!w.compatibilityMode)
      w.model.root.traverse((object) => {
        if (object.isMesh)
          object.onBeforeRender = () => {
            if (w.laboratoryView.active) window.__laboratoryRendered.add(object.name);
          };
      });
  });
  await entry.click();
  await expect(entry).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('body')).toHaveAttribute('data-world-view', 'laboratory');
  await expect(page.locator('#landscape')).toBeDisabled();
  const inside = await visibility(page);
  expect(inside).toMatchObject({
    active: true,
    laboratory: true,
    ground: false,
    landscape: false,
    panda: false,
    roof: false,
    roomCeiling: true,
    tables: 2,
    devices: 6,
    lights: 2,
    maxDistance: 8.5,
  });
  expect(inside.visible.length).toBeLessThan(before.visible.length / 2);
  expect(inside.visible).not.toContain('弧形屋面与白色檐口');
  expect(inside.visible).toContain('正面固定玻璃');
  expect(inside.visible).toContain('端面玻璃');
  expect(inside.visible).toContain('真实穿孔暖灰纤维板');
  if (!(await page.evaluate(() => window.loomWorld.compatibilityMode))) {
    await expect
      .poll(() => page.evaluate(() => window.__laboratoryRendered.size))
      .toBeGreaterThan(0);
    const rendered = await page.evaluate(() => [...window.__laboratoryRendered]);
    expect(rendered).not.toContain('屋面顶板与金属压边');
    expect(rendered).not.toContain('head');
    expect(rendered).not.toContain('草坪地面');
    for (const exhibitMesh of [
      '黄色模块化背板',
      '绿色PCB电路基板',
      '固定双叶螺旋桨',
      '螺丝刀绝缘手柄',
    ])
      expect(rendered).toContain(exhibitMesh);
  }
  await page.locator('#doors').check();
  expect(
    await page.evaluate(() => {
      const doors = [];
      window.loomWorld.model.laboratory.traverse((object) => {
        if (object.userData.doorLeaf) doors.push(object);
      });
      return (
        doors.length === 2 &&
        doors.every(
          (door) =>
            Math.abs(door.rotation.y - (door.userData.closedAngle + door.userData.openAngle)) <
            0.0001,
        )
      );
    }),
  ).toBe(true);
  await page.locator('[data-view="aerial"]').click();
  await expect(page.locator('#landscape')).toBeEnabled();
  expect(await visibility(page)).toMatchObject({
    active: false,
    laboratory: true,
    ground: true,
    landscape: false,
    panda: true,
    roof: true,
    maxDistance: 220,
  });
  expect(
    await page.evaluate(() => window.loomWorld.model.building.getObjectByName('檐口分缝').visible),
  ).toBe(false);
  await page.locator('#landscape').check();
  await entry.click();
  await page.locator('#reset').click();
  expect(await visibility(page)).toMatchObject({
    active: false,
    landscape: true,
    panda: true,
    roof: true,
  });
  await expect(page.locator('[data-view="perspective"]')).toHaveAttribute('aria-pressed', 'true');
  expect(errors).toEqual([]);
});

test('laboratory hides rain, fog and SVG overlays while retaining fallback-hidden surfaces', async ({
  page,
}) => {
  const errors = await openWorld(page, { fallback: true });
  const exteriorPaths = await page.locator('#viewport svg path').count();
  expect(exteriorPaths).toBeGreaterThan(0);
  await page.evaluate(() => {
    const w = window.loomWorld;
    w.atmosphere.setConditions({
      now: Date.parse('2026-11-04T20:00:00+08:00'),
      current: { condition: 'rain' },
      sun: null,
    });
  });
  await page.locator('[data-view="interior"]').click();
  await expect(page.locator('#world-atmosphere-haze')).toBeHidden();
  await expect
    .poll(() => page.locator('#viewport svg path').count())
    .toBeLessThan(exteriorPaths / 2);
  expect(await page.locator('#viewport svg path').count()).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.loomWorld.scene.fog)).toBeNull();
  const flags = await page.evaluate(() => {
    const w = window.loomWorld;
    const signs = [];
    const halos = [];
    w.model.laboratory.traverse((object) => {
      if (object.userData.exteriorLogo) signs.push(object.visible);
      if (object.userData.ledHalo) halos.push(object.visible);
    });
    return {
      clonedRoom: w.model.root.getObjectByName(w.model.laboratory.name) === w.model.laboratory,
      signs,
      halos,
    };
  });
  expect(flags).toEqual({ clonedRoom: true, signs: [false, false], halos: [false, false] });
  await page.locator('[data-view="enclosure"]').click();
  await expect(page.locator('#world-atmosphere-haze')).toBeVisible();
  const restored = await page.evaluate(() => {
    const signs = [];
    const halos = [];
    const w = window.loomWorld;
    w.model.laboratory.traverse((object) => {
      if (object.userData.exteriorLogo) signs.push(object.visible);
      if (object.userData.ledHalo) halos.push(object.visible);
    });
    return { fog: !!w.scene.fog, signs, halos };
  });
  expect(restored).toEqual({ fog: true, signs: [true, true], halos: [false, false] });
  expect(errors).toEqual([]);
});

test('touch entry and exit stay usable at phone and short landscape sizes', async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  try {
    const errors = await openWorld(page);
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      if ((await page.locator('#world-tools-toggle').getAttribute('aria-expanded')) === 'false')
        await page.locator('#world-tools-toggle').tap();
      const entry = page.getByRole('button', { name: '走进实验室', exact: true });
      await entry.tap();
      await expect(entry).toHaveAttribute('aria-pressed', 'true');
      expect(await visibility(page)).toMatchObject({
        active: true,
        panda: false,
        roof: false,
        tables: 2,
        devices: 6,
      });
      const box = await entry.boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      await page.locator('[data-view="perspective"]').tap();
      expect(await visibility(page)).toMatchObject({ active: false, panda: true, roof: true });
    }
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
