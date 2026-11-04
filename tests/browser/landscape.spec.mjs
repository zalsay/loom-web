import { test, expect } from '@playwright/test';

test.use({ trace: { mode: 'retain-on-failure', snapshots: false, screenshots: false } });

for (const fallback of [false, true]) {
  test(`short lawn and clustered trees render with ${fallback ? 'SVG fallback' : 'WebGL'} and mobile controls`, async ({
    page,
  }, testInfo) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+08:00'));
    if (fallback)
      await page.addInitScript(() => {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...args) {
          return type === 'webgl' || type === 'webgl2'
            ? null
            : getContext.call(this, type, ...args);
        };
      });
    await page.route('**/api/world-weather', (route) => route.fulfill({ status: 503, body: '{}' }));
    await page.goto('/world.html');
    await expect(page.locator('#loading')).toHaveClass('hidden', { timeout: 45000 });
    expect(await page.evaluate(() => window.loomWorld.compatibilityMode)).toBe(fallback);
    const landscape = await page.evaluate(() => {
      const w = window.loomWorld;
      const lawn = w.model.landscape.getObjectByName('草坪地面');
      return {
        colorField: !!lawn.geometry.getAttribute('color') && lawn.material.vertexColors,
        crowns: w.model.landscape.children
          .filter((o) => o.userData.detailed)
          .map((tree) => tree.children.filter((o) => o.name === '树带树冠' && o.visible).length),
      };
    });
    expect(landscape.colorField).toBe(true);
    expect(landscape.crowns.length).toBe(3);
    expect(landscape.crowns.every((count) => count >= 3)).toBe(true);
    for (const view of ['overview', 'trees', 'road', 'lawn']) {
      await page.evaluate(async (view) => {
        const THREE = await import('three');
        const w = window.loomWorld;
        w.controls.dispatchEvent({ type: 'start' });
        w.controls.enableDamping = false;
        if (view === 'trees') {
          const tree = w.model.landscape.children.find((o) => o.userData.detailed);
          w.controls.target.copy(tree.position).y = 2.5;
          w.camera.position.copy(tree.position).add(new THREE.Vector3(13, 7, 15));
        } else if (view === 'road') {
          const road = w.model.ground.getObjectByName('右侧主路');
          new THREE.Box3().setFromObject(road).getCenter(w.controls.target);
          w.camera.position.copy(w.controls.target).add(new THREE.Vector3(18, 16, 22));
        } else if (view === 'lawn') {
          w.controls.minDistance = 0.3;
          const grass = w.model.landscape.getObjectByName('细草叶');
          const matrix = new THREE.Matrix4();
          grass.getMatrixAt(100, matrix);
          const p = new THREE.Vector3().setFromMatrixPosition(matrix);
          w.controls.target.copy(p).y = 0.05;
          w.camera.position.copy(p).add(new THREE.Vector3(1.4, 0.85, 2.7));
        }
        w.controls.update();
        await new Promise((resolve) => {
          const render = w.renderer.render;
          w.renderer.render = function (...args) {
            render.apply(this, args);
            this.render = render;
            requestAnimationFrame(resolve);
          };
          w.controls.dispatchEvent({ type: 'change' });
        });
      }, view);
      await page.screenshot({ path: testInfo.outputPath(`landscape-${view}.png`) });
    }
    await page.locator('#landscape').uncheck();
    expect(await page.evaluate(() => window.loomWorld.model.landscape.visible)).toBe(false);
    await page.locator('#landscape').check();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#world-tools-toggle').click();
    await page.locator('#reset').click();
    await expect(page.locator('#landscape')).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          const w = window.loomWorld,
            render = w.renderer.render;
          w.renderer.render = function (...args) {
            render.apply(this, args);
            this.render = render;
            requestAnimationFrame(resolve);
          };
          w.controls.dispatchEvent({ type: 'change' });
        }),
    );
    await page.screenshot({ path: testInfo.outputPath('landscape-mobile.png') });
    expect(errors).toEqual([]);
  });
}
