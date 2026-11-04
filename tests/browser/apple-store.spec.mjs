import { test, expect } from '@playwright/test';

test.use({ trace: { mode: 'retain-on-failure', snapshots: false, screenshots: false } });

async function openWorld(page, { fallback = false, night = false } = {}) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.setFixedTime(new Date(`2026-11-02T${night ? '20' : '12'}:00:00+08:00`));
  await page.route('**/api/world-weather', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
  if (fallback)
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        return type === 'webgl' || type === 'webgl2' ? null : original.call(this, type, ...args);
      };
    });
  await page.goto('/world.html');
  await expect(page.locator('#loading')).toHaveClass('hidden', { timeout: 45_000 });
  return errors;
}

test('store has local fitted interiors, exterior signs and a usable interior camera that resets', async ({
  page,
}) => {
  const errors = await openWorld(page);
  await page.locator('[data-view="interior"]').click();
  await expect(page.locator('[data-view="interior"]')).toHaveAttribute('aria-pressed', 'true');
  const result = await page.evaluate(async () => {
    const THREE = await import('three');
    const world = window.loomWorld;
    const store = world.model.building.getObjectByName('玻璃房 · 织界创客实验室');
    store.updateWorldMatrix(true, true);
    const tables = [],
      devices = [],
      exhibitSupports = [],
      obsoleteDevices = [],
      signs = [],
      wallDisplays = [],
      lights = [];
    store.traverse((object) => {
      if (object.userData.storeTable) {
        tables.push({
          name: object.name,
          type: object.userData.tableType,
          footprint: object.userData.footprint,
        });
        const tabletop = object.getObjectByName('白色圆角长方桌面');
        const surfaceY = new THREE.Box3().setFromObject(tabletop).max.y;
        object.traverse((part) => {
          if (!part.userData.laboratoryExhibit) return;
          const bounds = new THREE.Box3().setFromObject(part);
          let meshes = 0;
          const contacts = [];
          part.traverse((mesh) => {
            if (mesh.isMesh) meshes++;
            if (mesh.userData.tabletopContact)
              contacts.push(new THREE.Box3().setFromObject(mesh).min.y - surfaceY);
          });
          exhibitSupports.push({
            kind: part.userData.laboratoryExhibit,
            gap: bounds.min.y - surfaceY,
            meshes,
            contacts,
          });
        });
      }
      if (object.userData.device) devices.push(object.userData.device);
      if (/iPhone|MacBook|iPad|主屏手机|主屏平板/.test(object.name))
        obsoleteDevices.push(object.name);
      if (object.userData.wallDisplay) {
        const toolTypes = [];
        let baseplates = 0;
        let brickPieces = 0;
        let studs = 0;
        let meshes = 0;
        object.traverse((part) => {
          if (part.userData.wallTool) toolTypes.push(part.userData.toolType);
          if (part.userData.brickBaseplate) baseplates++;
          if (part.userData.brickPiece) brickPieces++;
          if (part.userData.brickStuds) studs += part.userData.studCount;
          if (part.isMesh) meshes++;
        });
        wallDisplays.push({
          kind: object.userData.wallDisplay,
          toolTypes,
          baseplates,
          brickPieces,
          studs,
          meshes,
        });
      }
      if (object.userData.exteriorLogo) {
        const sourceElements = new Set();
        let emitters = 0;
        const halos = [];
        object.traverse((part) => {
          if (part.isMesh && Number.isInteger(part.userData.sourceElementIndex))
            sourceElements.add(part.userData.sourceElementIndex);
          if (part.userData.ledEmitter && part.material.emissiveIntensity > 0) emitters++;
          if (part.userData.ledHalo)
            halos.push({
              texture: !!part.material.map?.isDataTexture,
              depthTest: part.material.depthTest,
              depthWrite: part.material.depthWrite,
              visible: part.visible,
            });
        });
        signs.push({
          name: object.name,
          brand: object.userData.brand,
          source: object.userData.logoSource,
          sourceElements: sourceElements.size,
          emitters,
          halos,
        });
      }
    });
    world.model.building.traverse((object) => {
      if (object.isPointLight)
        lights.push({ intensity: object.intensity, shadow: object.castShadow });
    });
    return {
      tables,
      devices,
      exhibitSupports,
      obsoleteDevices,
      projectScreen: !!store.getObjectByName('主屏实验室项目示意'),
      signs,
      wallDisplays,
      lights,
      near: world.camera.near,
      fov: world.camera.fov,
      distance: world.controls.minDistance,
      finite: [...world.camera.position, ...world.controls.target].every(Number.isFinite),
    };
  });
  expect(result.tables).toHaveLength(2);
  expect(
    result.tables.every(
      (table) =>
        table.type === 'manual-lifting-table' &&
        table.footprint[0] === 2.4 &&
        table.footprint[1] === 1.05,
    ),
  ).toBe(true);
  expect(result.devices).toHaveLength(6);
  expect(new Set(result.devices)).toEqual(
    new Set(['brick-robot-dog', 'development-board', 'tool-kit', 'quadcopter']),
  );
  expect(result.obsoleteDevices).toEqual([]);
  expect(result.projectScreen).toBe(true);
  expect(result.exhibitSupports).toHaveLength(6);
  for (const exhibit of result.exhibitSupports) {
    expect(Math.abs(exhibit.gap)).toBeLessThan(0.001);
    expect(exhibit.meshes).toBeGreaterThan(10);
    expect(exhibit.contacts.length).toBeGreaterThan(0);
    for (const contact of exhibit.contacts) expect(Math.abs(contact)).toBeLessThan(0.001);
  }
  expect(result.wallDisplays).toHaveLength(2);
  const tools = result.wallDisplays.find((panel) => panel.kind === 'tool-pegboard');
  const bricks = result.wallDisplays.find((panel) => panel.kind === 'brick-board');
  expect(new Set(tools.toolTypes).size).toBeGreaterThanOrEqual(5);
  expect(bricks.baseplates).toBe(1);
  expect(bricks.brickPieces).toBeGreaterThanOrEqual(10);
  expect(bricks.studs).toBeGreaterThanOrEqual(100);
  expect(result.wallDisplays.reduce((total, panel) => total + panel.meshes, 0)).toBeLessThan(180);
  expect(result.signs).toHaveLength(2);
  expect(
    result.signs.every(
      (sign) =>
        sign.brand === '织界' &&
        sign.source === 'assets/zhi-jie-logo.svg' &&
        sign.sourceElements === 28,
    ),
  ).toBe(true);
  for (const sign of result.signs) {
    expect(sign.emitters).toBe(28);
    expect(sign.halos).toHaveLength(1);
    expect(sign.halos[0]).toEqual({
      texture: true,
      depthTest: true,
      depthWrite: false,
      visible: true,
    });
  }
  expect(result.lights).toHaveLength(2);
  expect(result.lights.every((light) => light.intensity > 0 && !light.shadow)).toBe(true);
  expect(result.near).toBe(0.04);
  expect(result.fov).toBe(66);
  expect(result.distance).toBe(0.6);
  expect(result.finite).toBe(true);
  await page.locator('#reset').click();
  await expect(page.locator('[data-view="perspective"]')).toHaveAttribute('aria-pressed', 'true');
  const reset = await page.evaluate(() => ({
    near: window.loomWorld.camera.near,
    distance: window.loomWorld.controls.minDistance,
  }));
  expect(reset.distance).toBe(5);
  expect(reset.near).toBeGreaterThanOrEqual(0.25);
  expect(reset.near).toBeLessThanOrEqual(3);
  expect(errors).toEqual([]);
});

test('phone and short landscape view controls fit with the additional interior view', async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 320, height: 568 },
    hasTouch: true,
    isMobile: browser.browserType().name() === 'webkit',
  });
  try {
    const page = await context.newPage();
    const errors = await openWorld(page);
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 844, height: 390 },
    ]) {
      await page.setViewportSize(viewport);
      if ((await page.locator('#world-tools-toggle').getAttribute('aria-expanded')) === 'false')
        await page.locator('#world-tools-toggle').tap();
      await expect(page.locator('[data-view="interior"]')).toBeVisible();
      const layout = await page.evaluate(() => {
        const box = document.querySelector('[data-view="interior"]').getBoundingClientRect();
        return {
          left: box.left,
          right: box.right,
          top: box.top,
          bottom: box.bottom,
          height: box.height,
          width: innerWidth,
          viewportHeight: innerHeight,
          overflow: document.documentElement.scrollWidth > innerWidth + 1,
        };
      });
      expect(layout.left).toBeGreaterThanOrEqual(0);
      expect(layout.right).toBeLessThanOrEqual(layout.width);
      expect(layout.top).toBeGreaterThanOrEqual(0);
      expect(layout.bottom).toBeLessThanOrEqual(layout.viewportHeight);
      expect(layout.height).toBeGreaterThanOrEqual(44);
      expect(layout.overflow).toBe(false);
      await page.locator('[data-view="interior"]').tap();
      await expect(page.locator('[data-view="interior"]')).toHaveAttribute('aria-pressed', 'true');
    }
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('night and SVG compatibility retain the shop without new network assets or gameplay', async ({
  page,
}) => {
  const errors = await openWorld(page, { fallback: true, night: true });
  expect(await page.evaluate(() => window.loomWorld.compatibilityMode)).toBe(true);
  await page.locator('[data-view="interior"]').click();
  await expect(page.locator('[data-view="interior"]')).toHaveAttribute('aria-pressed', 'true');
  expect(
    await page.evaluate(() => {
      const world = window.loomWorld;
      return (
        !!world.model.building.getObjectByName('后墙产品陈列区') &&
        !!world.model.building.getObjectByName('正面玻璃外墙织界标志') &&
        !!world.model.building.getObjectByName('洞洞板工具墙') &&
        !!world.model.building.getObjectByName('乐高积木墙') &&
        !world.model.root.getObjectByName('LoomOS Panda')
      );
    }),
  ).toBe(true);
  const led = await page.evaluate(() => {
    const emitters = [],
      halos = [];
    window.loomWorld.model.building.traverse((object) => {
      if (object.userData.ledEmitter) emitters.push(object.material.emissiveIntensity);
      if (object.userData.ledHalo) halos.push(object.visible);
    });
    return { emitters, halos };
  });
  expect(led.emitters).toHaveLength(56);
  expect(led.emitters.every((intensity) => intensity > 0)).toBe(true);
  expect(led.halos).toEqual([false, false]);
  await expect(page.locator('#panda-controls, #panda-control-toggle')).toHaveCount(0);
  expect(errors).toEqual([]);
});
