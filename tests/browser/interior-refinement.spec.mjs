import { test, expect } from '@playwright/test';
test.use({ trace: { mode: 'retain-on-failure', snapshots: false, screenshots: false } });

async function rendered(page) {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const w = window.loomWorld,
          original = w.renderer.render;
        w.renderer.render = function (...args) {
          original.apply(this, args);
          this.render = original;
          requestAnimationFrame(resolve);
        };
        w.controls.dispatchEvent({ type: 'change' });
      }),
  );
}
for (const fallback of [false, true]) {
  test(`refined laboratory close-ups and glass exterior in ${fallback ? 'SVG' : 'WebGL'}`, async ({
    page,
  }, testInfo) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.clock.setFixedTime(new Date('2026-11-04T12:00:00+08:00'));
    if (fallback)
      await page.addInitScript(() => {
        const get = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (type, ...args) {
          return type === 'webgl' || type === 'webgl2' ? null : get.call(this, type, ...args);
        };
      });
    await page.route('**/api/world-weather', (r) => r.fulfill({ status: 503, body: '{}' }));
    await page.goto('/world.html');
    await expect(page.locator('#loading')).toHaveClass('hidden', { timeout: 45000 });
    await page.locator('[data-view="interior"]').click();
    expect(await page.evaluate(() => window.loomWorld.compatibilityMode)).toBe(fallback);
    const detail = await page.evaluate(() => {
      const lab = window.loomWorld.model.laboratory;
      let doors = 0,
        leaves = 0,
        colouredLeaves = 0,
        lights = 0;
      lab.traverse((o) => {
        if (o.userData.cabinetFront) doors++;
        if (o.name === '端景绿植叶簇') {
          leaves++;
          if (o.geometry.getAttribute('color')) colouredLeaves++;
        }
        if (o.isPointLight) lights++;
      });
      return { doors, leaves, colouredLeaves, lights };
    });
    expect(detail).toEqual({ doors: 6, leaves: 9, colouredLeaves: 9, lights: 2 });
    for (const view of ['room', 'workbench', 'cabinet', 'plant', 'garden-front', 'garden-side']) {
      if (view !== 'room')
        await page.evaluate(async (view) => {
          const THREE = await import('three');
          const w = window.loomWorld;
          const lab = w.model.laboratory;
          if (view.startsWith('garden-')) {
            const { bendPoint } = await import('/scene/site-layout.js');
            const { GLASS_ROOM } = await import('/scene/pavilion-dimensions.js');
            const x = GLASS_ROOM.storeCenterX;
            w.controls.dispatchEvent({ type: 'start' });
            w.controls.enableDamping = false;
            w.camera.position.copy(bendPoint(new THREE.Vector3(x + 0.35, 1.45, 0.15)));
            w.controls.target.copy(
              bendPoint(
                view === 'garden-front'
                  ? new THREE.Vector3(x + 0.35, 1.05, 2.8)
                  : new THREE.Vector3(x - 2.2, 1.1, 0.15),
              ),
            );
            w.controls.update();
            return;
          }
          const table = lab.getObjectByName('白色手动升降长桌 1');
          const part =
            view === 'workbench'
              ? table
              : lab.getObjectByName(view === 'cabinet' ? '橡木储物柜' : '室内端景绿植');
          const target = new THREE.Box3().setFromObject(part).getCenter(new THREE.Vector3());
          const offset = new THREE.Vector3(
            ...(view === 'workbench'
              ? [1.1, 0.85, 1.55]
              : view === 'cabinet'
                ? [0.3, 0.75, 2.4]
                : [0.95, 0.4, -1.35]),
          );
          offset.applyQuaternion(table.getWorldQuaternion(new THREE.Quaternion()));
          w.controls.dispatchEvent({ type: 'start' });
          w.controls.enableDamping = false;
          w.controls.target.copy(target);
          w.camera.position.copy(target).add(offset);
          w.controls.update();
        }, view);
      await rendered(page);
      if (view.startsWith('garden-')) {
        const sightlines = await page.evaluate(async () => {
          const THREE = await import('three');
          const w = window.loomWorld;
          const lawn = w.model.landscape.getObjectByName('草坪地面');
          const panes = [],
            opaque = [];
          w.model.laboratory.traverseVisible((o) => {
            if (!o.isMesh) return;
            if (o.name === '正面固定玻璃' || o.name === '端面玻璃') panes.push(o);
            const materials = Array.isArray(o.material) ? o.material : [o.material];
            if (materials.some((m) => !m.transparent || m.opacity >= 1)) opaque.push(o);
          });
          w.model.root.updateMatrixWorld(true);
          w.camera.updateMatrixWorld(true);
          const ray = new THREE.Raycaster();
          let clear = 0;
          for (const x of [-0.7, -0.35, 0, 0.35, 0.7])
            for (const y of [-0.4, -0.2, 0, 0.2]) {
              ray.setFromCamera(new THREE.Vector2(x, y), w.camera);
              const glass = ray.intersectObjects(panes, false)[0];
              const grass = ray.intersectObject(lawn, false)[0];
              if (!glass || !grass || glass.distance >= grass.distance) continue;
              const block = ray.intersectObjects(opaque, false)[0];
              if (!block || block.distance > grass.distance) clear++;
            }
          return {
            clear,
            garden: w.model.landscape.visible,
            ground: w.model.ground.visible,
            indoor: w.laboratoryView.active,
            fog: w.scene.fog === null,
          };
        });
        expect(sightlines).toMatchObject({ garden: true, ground: true, indoor: true, fog: true });
        expect(sightlines.clear).toBeGreaterThan(0);
      }
      await page.screenshot({ path: testInfo.outputPath(`interior-${view}.png`) });
    }
    await page.locator('[data-view="enclosure"]').click();
    await rendered(page);
    expect(await page.evaluate(() => window.loomWorld.laboratoryView.active)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('interior-through-glass.png') });
    expect(errors).toEqual([]);
  });
}
