import { test, expect } from '@playwright/test';

// A close-up SVG scene has tens of thousands of paths. Keep action/error traces
// without serializing that entire DOM before every geometry assertion.
test.use({ trace: { mode: 'retain-on-failure', snapshots: false, screenshots: false } });

async function openWorld(page, fallback = false) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.clock.setFixedTime(new Date('2026-11-02T12:00:00+08:00'));
  if (fallback) {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        if (type === 'webgl' || type === 'webgl2') return null;
        return original.call(this, type, ...args);
      };
    });
  }
  await page.route('**/api/world-weather', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
  await page.goto('/world.html');
  await expect(page.locator('#loading')).toHaveClass('hidden', { timeout: 45_000 });
  return errors;
}

async function setRoofView(page, angle) {
  await page.evaluate(async (angle) => {
    const THREE = await import('three');
    const world = window.loomWorld;
    const panda = world.model.root.getObjectByName('LoomOS Rooftop Panda');
    const eave = new THREE.Vector3().fromArray(panda.userData.rooftopEavePosition);
    const direction = new THREE.Vector3()
      .fromArray(panda.userData.rooftopOutwardDirection)
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    world.controls.dispatchEvent({ type: 'start' });
    world.controls.enableDamping = false;
    world.model.landscape.visible = false;
    world.controls.target.copy(eave);
    world.camera.position.copy(eave).addScaledVector(direction, 11);
    world.camera.position.y += 3.5;
    world.controls.update();
    world.controls.dispatchEvent({ type: 'change' });
  }, angle);
}

async function layers(page, name = 'LoomOS Rooftop Panda') {
  return page.evaluate((name) => {
    const panda = window.loomWorld.model.root.getObjectByName(name);
    const emblem = [];
    panda.traverse((object) => {
      if (object.isMesh && object.name.startsWith('emblem-svg-')) emblem.push(object.renderOrder);
    });
    return {
      eyes: panda.getObjectByName('eye-patch-left').renderOrder,
      belly: panda.getObjectByName('belly').renderOrder,
      emblem,
    };
  }, name);
}

test('the only panda is a roof climber with its back and tail outside', async ({ page }) => {
  const errors = await openWorld(page);
  const pose = await page.evaluate(async () => {
    const THREE = await import('three');
    const world = window.loomWorld;
    const panda = world.model.root.getObjectByName('LoomOS Rooftop Panda');
    const outward = new THREE.Vector3().fromArray(panda.userData.rooftopOutwardDirection);
    const forward = new THREE.Vector3(0, 0, 1).transformDirection(panda.matrixWorld);
    const torso = panda.getObjectByName('torso').getWorldPosition(new THREE.Vector3());
    const tail = panda.getObjectByName('tail').getWorldPosition(new THREE.Vector3());
    const support = world.model.building.getObjectByName('视频起点侧白色栅格立面');
    const blades = support.children.filter((object) => object.name === '白色水平栅格片');
    const headCenter = new THREE.Box3()
      .setFromObject(panda.getObjectByName('head'))
      .getCenter(new THREE.Vector3());
    const eave = new THREE.Vector3().fromArray(panda.userData.rooftopEavePosition);
    const bends = ['left', 'right'].flatMap((side) =>
      [
        ['arm', 'forearm', 'elbow', 'paw'],
        ['leg', 'shin', 'knee', 'foot'],
      ].map(([upperName, lowerName, jointName, endName]) => {
        const upper = panda.getObjectByName(`${upperName}-${side}`);
        const lower = panda.getObjectByName(`${lowerName}-${side}`);
        const joint = panda.getObjectByName(`${jointName}-${side}`);
        const end = panda.getObjectByName(`${endName}-${side}`);
        const axis = (part) => new THREE.Vector3(0, 1, 0).transformDirection(part.matrixWorld);
        const bounds = (part) => new THREE.Box3().setFromObject(part);
        const upperBounds = bounds(upper);
        const lowerBounds = bounds(lower);
        const jointBounds = bounds(joint);
        const geometrySize = (part) => {
          part.geometry.computeBoundingBox();
          return (
            part.geometry.boundingBox.getSize(new THREE.Vector3()).y * part.scale.y * panda.scale.y
          );
        };
        return {
          side,
          kind: upperName,
          bend: axis(upper).dot(axis(lower)),
          lengths: [geometrySize(upper), geometrySize(lower)],
          connects:
            upperBounds.intersectsBox(jointBounds) &&
            lowerBounds.intersectsBox(jointBounds) &&
            lowerBounds.intersectsBox(bounds(end)) &&
            upperBounds.intersectsBox(bounds(panda.getObjectByName('torso'))),
          faceted: [upper, lower, joint].every(
            (part) => part.material.flatShading && part.geometry.getAttribute('color'),
          ),
        };
      }),
    );
    const feet = ['left', 'right'].map((side) => {
      const foot = panda.getObjectByName(`foot-${side}`);
      foot.geometry.computeBoundingBox();
      const sole = foot.localToWorld(new THREE.Vector3(0, foot.geometry.boundingBox.min.y, 0));
      const intoFacade = new THREE.Vector3(0, -1, 0).applyNormalMatrix(
        new THREE.Matrix3().getNormalMatrix(foot.matrixWorld),
      );
      const ray = new THREE.Raycaster(
        sole.clone().addScaledVector(intoFacade, -0.2),
        intoFacade,
        0,
        0.3,
      );
      const hit = ray.intersectObjects(blades, false)[0];
      return hit ? sole.distanceTo(hit.point) : null;
    });
    return {
      face: forward.dot(outward),
      tail: tail.sub(torso).dot(outward),
      onlyRoof: panda === world.model.panda && !world.model.root.getObjectByName('LoomOS Panda'),
      static: !world.pandaController && !world.pandaInput && !world.setPandaMode,
      support: panda.userData.rooftopFootSupport,
      feet,
      bends,
      headHeight: headCenter.y - eave.y,
      headOutside: headCenter.sub(eave).dot(outward),
    };
  });
  expect(pose.face).toBeLessThan(-0.99);
  expect(pose.tail).toBeGreaterThan(0.6);
  expect(pose.onlyRoof).toBe(true);
  expect(pose.static).toBe(true);
  expect(pose.support).toBe('视频起点侧白色栅格立面');
  expect(pose.headHeight).toBeGreaterThan(0.6);
  expect(pose.headOutside).toBeLessThan(0.95);
  for (const limb of pose.bends) {
    expect(limb.bend, `${limb.side} ${limb.kind} visibly bends`).toBeLessThan(0.96);
    expect(limb.connects, `${limb.side} ${limb.kind} stays joined`).toBe(true);
    expect(limb.faceted).toBe(true);
    for (const length of limb.lengths) expect(length).toBeLessThan(0.95);
  }
  for (const gap of pose.feet) {
    expect(gap).not.toBeNull();
    expect(gap).toBeLessThan(0.004);
  }
  await expect(page.locator('#panda-controls, #panda-control-toggle')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('SVG layers show the face above the roof without painting the hidden belly or emblem through it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  const errors = await openWorld(page, true);
  expect(await page.evaluate(() => window.loomWorld.compatibilityMode)).toBe(true);
  // The initial real SVG scene has rendered above. These assertions target the
  // visibility/paint-order hook, not SVG rasterization: leave the full geometry
  // available to raycasts without repainting 60,000 paths on each camera change.
  await page.evaluate(() => {
    window.loomWorld.renderer.render = () => {};
  });
  await setRoofView(page, 0);
  await expect.poll(() => layers(page)).toMatchObject({ eyes: 0, belly: 0 });
  expect((await layers(page)).emblem.every((order) => order === 0)).toBe(true);

  await setRoofView(page, Math.PI);
  await expect.poll(async () => (await layers(page)).eyes).toBeGreaterThan(0);
  const inside = await layers(page);
  expect(inside.belly).toBe(0);
  expect(inside.emblem.length).toBeGreaterThan(0);
  expect(inside.emblem.every((order) => order === 0)).toBe(true);

  await setRoofView(page, 0);
  await expect.poll(() => layers(page)).toMatchObject({ eyes: 0, belly: 0 });
  expect((await layers(page)).emblem.every((order) => order === 0)).toBe(true);
  expect(errors).toEqual([]);
});

test('sculpture refactor keeps the roof rig and renders front, side and street silhouettes', async ({
  page,
}, testInfo) => {
  const errors = await openWorld(page);
  const sculpture = await page.evaluate(() => {
    const panda = window.loomWorld.model.panda;
    return {
      tuft: !!panda.getObjectByName('tuft'),
      headVertices: panda.getObjectByName('head').geometry.getAttribute('position').count,
      eyeColor: panda.getObjectByName('eye-left').material.color.getHex(),
      support: panda.userData.rooftopFootSupport,
    };
  });
  expect(sculpture.tuft).toBe(false);
  expect(sculpture.headVertices).toBeLessThanOrEqual(2304);
  expect(sculpture.eyeColor).toBe(0x20252a);
  expect(sculpture.support).toBeTruthy();
  let previousScreenshot;
  for (const [name, angle] of [
    ['front', Math.PI],
    ['side', Math.PI / 2],
    ['street', 0],
  ]) {
    await setRoofView(page, angle);
    await page.evaluate(async () => {
      const world = window.loomWorld;
      world.camera.position
        .sub(world.controls.target)
        .multiplyScalar(0.65)
        .add(world.controls.target);
      world.controls.update();
      // Await an actual render, not just a changed camera: SVG mode throttles frames.
      await new Promise((resolve) => {
        const original = world.renderer.render;
        world.renderer.render = function (...args) {
          original.apply(this, args);
          this.render = original;
          requestAnimationFrame(resolve);
        };
        world.controls.dispatchEvent({ type: 'change' });
      });
    });
    const screenshot = await page.screenshot({ path: testInfo.outputPath(`panda-${name}.png`) });
    if (previousScreenshot) expect(screenshot.equals(previousScreenshot)).toBe(false);
    previousScreenshot = screenshot;
  }
  expect(errors).toEqual([]);
});
