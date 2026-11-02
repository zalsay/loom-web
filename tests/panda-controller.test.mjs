import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../web/vendor/three.module.js';
import { createPandaController } from '../web/js/panda-controller.js';

function makePanda(position = [0, 0, 0]) {
  const panda = new THREE.Group();
  panda.position.set(...position);
  panda.rotation.y = 0.85;
  panda.scale.setScalar(0.42);

  const meshes = new Map();
  for (const [name, coords] of [
    ['body', [0, 1, 0]],
    ['arm-left', [-1, 1.5, 0]],
    ['arm-right', [1, 1.5, 0]],
    ['paw-left', [-1.2, 0.8, 0]],
    ['paw-right', [1.2, 0.8, 0]],
    ['leg-left', [-0.4, 0.5, 0]],
    ['leg-right', [0.4, 0.5, 0]],
    ['foot-left', [-0.4, 0.2, 0.2]],
    ['foot-right', [0.4, 0.2, 0.2]],
    ['toe-left-0', [-0.4, 0.2, 0.7]],
    ['toe-right-0', [0.4, 0.2, 0.7]],
  ]) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.2, 0.2),
      new THREE.MeshBasicMaterial({ color: 'white' }),
    );
    mesh.name = name;
    mesh.position.set(...coords);
    panda.add(mesh);
    meshes.set(name, mesh);
  }
  return { panda, meshes };
}

function cameraLooking(direction) {
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 4, 0);
  camera.lookAt(direction[0], 4 + direction[1], direction[2]);
  camera.updateMatrixWorld(true);
  return camera;
}

function closeTo(actual, expected, epsilon = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `${actual} not within ${epsilon} of ${expected}`,
  );
}

test('camera-relative diagonal movement is normalized, turns the panda, and runs faster', () => {
  const { panda } = makePanda();
  const controller = createPandaController({ THREE, panda });
  controller.setActive(true);
  assert.equal(panda.getObjectByName('toe-left-0').parent.name, 'panda-motion-leg-left');
  assert.equal(panda.getObjectByName('toe-right-0').parent.name, 'panda-motion-leg-right');
  const camera = cameraLooking([0, 0, -1]);
  controller.setMovement(1, 1);
  controller.update(0, camera);
  controller.update(100, camera);

  const moved = controller.getState();
  closeTo(Math.hypot(moved.position.x, moved.position.z), 0.26);
  closeTo(moved.position.x, 0.26 / Math.sqrt(2));
  closeTo(moved.position.z, -0.26 / Math.sqrt(2));
  closeTo(moved.heading, Math.atan2(1, -1));
  assert.equal(moved.moving, true);
  assert.equal(moved.running, false);

  const beforeRun = panda.position.clone();
  controller.setRunning(true);
  controller.update(200, camera);
  closeTo(Math.hypot(panda.position.x - beforeRun.x, panda.position.z - beforeRun.z), 0.48);
  assert.equal(controller.getState().running, true);
  controller.dispose();
});

test('movement follows the horizontal camera direction and remains finite overhead', () => {
  const { panda } = makePanda();
  const controller = createPandaController({ THREE, panda });
  controller.setActive(true);
  const eastCamera = cameraLooking([1, 0, 0]);
  controller.setMovement(0, 1);
  controller.update(0, eastCamera);
  controller.update(100, eastCamera);
  closeTo(panda.position.x, 0.26);
  closeTo(panda.position.z, 0);

  const overhead = cameraLooking([0, -1, 0]);
  controller.update(200, overhead);
  assert.ok(Number.isFinite(panda.position.x));
  assert.ok(Number.isFinite(panda.position.z));
  closeTo(panda.position.x, 0.52);
  closeTo(panda.position.z, 0);
  controller.dispose();
});

test('jump is ground-only, lands at spawn height, and rejects airborne retriggers', () => {
  const { panda } = makePanda([2, 1, 3]);
  const controller = createPandaController({ THREE, panda });
  controller.setActive(true);
  assert.equal(controller.jump(), true);
  assert.equal(controller.jump(), false);
  controller.update(0, null);
  controller.update(100, null);
  const rising = controller.getState();
  assert.equal(rising.grounded, false);
  assert.ok(rising.jumpHeight > 0);
  assert.ok(rising.position.y > 1);
  assert.equal(controller.jump(), false);

  let time = 200;
  while (!controller.getState().grounded && time < 3000) {
    controller.update(time, null);
    time += 100;
  }
  controller.update(time, null);
  assert.equal(controller.getState().grounded, true);
  closeTo(controller.getState().position.y, 1);
  closeTo(controller.getState().jumpHeight, 0);
  assert.equal(controller.jump(), true);
  controller.dispose();
});

test('pause clears movement and run, preserves an airborne jump, and avoids resume teleporting', () => {
  const { panda } = makePanda();
  const controller = createPandaController({ THREE, panda });
  controller.setActive(true);
  const camera = cameraLooking([0, 0, -1]);
  controller.setMovement(0, 1);
  controller.setRunning(true);
  controller.update(0, camera);
  controller.update(100, camera);
  closeTo(panda.position.z, -0.48);
  controller.jump();
  controller.update(200, camera);
  const heightAtPause = controller.getState().jumpHeight;
  const zAtPause = panda.position.z;

  controller.setMovement(0, 1);
  controller.setRunning(true);
  controller.pause();
  assert.equal(controller.getState().moving, false);
  assert.equal(controller.getState().running, false);
  assert.equal(controller.getState().grounded, false);
  closeTo(controller.getState().jumpHeight, heightAtPause);

  controller.setMovement(0, 1);
  controller.setRunning(true);
  controller.update(50_000, camera);
  closeTo(panda.position.z, zAtPause);
  controller.update(50_100, camera);
  closeTo(panda.position.z, zAtPause - 0.48);
  controller.dispose();
});

test('unpaused frame deltas are capped and world bounds are enforced', () => {
  const { panda } = makePanda([0, 0, 0]);
  const controller = createPandaController({
    THREE,
    panda,
    bounds: { minX: -1, maxX: 1, minZ: -0.5, maxZ: 0.5 },
  });
  controller.setActive(true);
  const camera = cameraLooking([0, 0, -1]);
  controller.setMovement(1, 1);
  controller.update(0, camera);
  controller.update(10_000, camera);
  closeTo(Math.hypot(panda.position.x, panda.position.z), 0.26);
  controller.setMovement(0, 1);
  for (let i = 1; i <= 20; i++) controller.update(10_000 + i * 100, camera);
  closeTo(panda.position.z, -0.5);
  controller.dispose();
});

test('reset restores the spawn transform while deactivation settles and preserves x/z', () => {
  const { panda } = makePanda([4, 2, 5]);
  const controller = createPandaController({ THREE, panda });
  controller.setActive(true);
  const camera = cameraLooking([0, 0, -1]);
  controller.setMovement(0, 1);
  controller.update(0, camera);
  controller.update(100, camera);
  controller.jump();
  controller.update(200, camera);
  controller.setActive(false);
  const settled = controller.getState();
  assert.equal(settled.active, false);
  assert.equal(settled.moving, false);
  assert.equal(settled.grounded, true);
  closeTo(settled.position.x, 4);
  closeTo(settled.position.z, 4.48);
  closeTo(settled.position.y, 2);

  controller.setActive(true);
  controller.setMovement(1, 0);
  controller.update(300, camera);
  controller.update(400, camera);
  assert.notEqual(panda.position.x, 4);
  controller.reset();
  assert.deepEqual(controller.getState().position, { x: 4, y: 2, z: 5 });
  closeTo(controller.getState().heading, 0.85);
  assert.equal(controller.getState().active, true);
  assert.equal(controller.getState().moving, false);
  controller.dispose();
});

test('reduced motion retains translation and jumping with milder gait and no bob', () => {
  const normalPanda = makePanda();
  const reducedPanda = makePanda();
  const normal = createPandaController({ THREE, panda: normalPanda.panda });
  const reduced = createPandaController({ THREE, panda: reducedPanda.panda, reducedMotion: true });
  normal.setActive(true);
  reduced.setActive(true);
  const camera = cameraLooking([0, 0, -1]);
  normal.setMovement(0, 1);
  reduced.setMovement(0, 1);
  normal.update(0, camera);
  reduced.update(0, camera);
  normal.update(100, camera);
  reduced.update(100, camera);
  closeTo(normalPanda.panda.position.z, -0.26);
  closeTo(reducedPanda.panda.position.z, -0.26);
  assert.ok(
    Math.abs(reducedPanda.panda.getObjectByName('panda-motion-arm-left').rotation.x) <
      Math.abs(normalPanda.panda.getObjectByName('panda-motion-arm-left').rotation.x),
  );
  closeTo(reducedPanda.panda.position.y, 0);
  assert.equal(reduced.jump(), true);
  reduced.update(200, camera);
  assert.ok(reduced.getState().jumpHeight > 0);
  normal.dispose();
  reduced.dispose();
});

test('dispose is idempotent, restores the exact hierarchy/transforms, and leaves resources owned by scene', () => {
  const { panda, meshes } = makePanda([3, 1, -2]);
  const childOrder = [...panda.children];
  const pandaTransform = {
    position: panda.position.clone(),
    quaternion: panda.quaternion.clone(),
    scale: panda.scale.clone(),
  };
  const childTransforms = new Map(
    childOrder.map((child) => [
      child,
      {
        position: child.position.clone(),
        quaternion: child.quaternion.clone(),
        scale: child.scale.clone(),
      },
    ]),
  );
  let geometryDisposals = 0;
  let materialDisposals = 0;
  for (const mesh of meshes.values()) {
    mesh.geometry.addEventListener('dispose', () => geometryDisposals++);
    mesh.material.addEventListener('dispose', () => materialDisposals++);
  }
  const controller = createPandaController({ THREE, panda });
  controller.setActive(true);
  controller.setMovement(1, 1);
  controller.update(0, cameraLooking([0, 0, -1]));
  controller.update(100, cameraLooking([0, 0, -1]));
  controller.dispose();
  controller.dispose();

  assert.deepEqual(panda.children, childOrder);
  assert.deepEqual(panda.position.toArray(), pandaTransform.position.toArray());
  panda.quaternion
    .toArray()
    .forEach((value, index) => closeTo(value, pandaTransform.quaternion.toArray()[index]));
  assert.deepEqual(panda.scale.toArray(), pandaTransform.scale.toArray());
  for (const child of childOrder) {
    assert.equal(child.parent, panda);
    const before = childTransforms.get(child);
    assert.deepEqual(child.position.toArray(), before.position.toArray(), child.name);
    child.quaternion
      .toArray()
      .forEach((value, index) => closeTo(value, before.quaternion.toArray()[index]));
    assert.deepEqual(child.scale.toArray(), before.scale.toArray(), child.name);
  }
  assert.equal(geometryDisposals, 0);
  assert.equal(materialDisposals, 0);
  assert.equal(controller.getState().active, false);
  assert.equal(controller.getState().grounded, true);
  assert.equal(controller.getState().jumpHeight, 0);
  assert.equal(controller.jump(), false);
  assert.equal(controller.update(500, null), false);
});

test('dispose removes only its own pivots and preserves unrelated children added later', () => {
  const { panda } = makePanda();
  const controller = createPandaController({ THREE, panda });
  const external = new THREE.Group();
  external.name = 'world-addon';
  panda.add(external);
  controller.dispose();

  assert.equal(external.parent, panda);
  assert.equal(panda.getObjectByName('world-addon'), external);
  assert.equal(panda.getObjectByName('panda-motion-arm-left'), undefined);
  assert.equal(panda.getObjectByName('panda-motion-leg-right'), undefined);
});

test('controller starts inactive and scales analog input strength without slowing diagonals', () => {
  const { panda } = makePanda();
  const controller = createPandaController({ THREE, panda });
  const camera = cameraLooking([0, 0, -1]);
  assert.equal(controller.getState().active, false);

  controller.setMovement(0, 1);
  controller.update(0, camera);
  controller.update(100, camera);
  closeTo(panda.position.z, 0);

  controller.setActive(true);
  controller.setMovement(0, 0.25);
  controller.update(200, camera);
  controller.update(300, camera);
  closeTo(panda.position.z, -0.065);
  controller.setMovement(1, 1);
  controller.update(400, camera);
  controller.update(500, camera);
  closeTo(Math.hypot(panda.position.x, panda.position.z + 0.065), 0.52);
  controller.dispose();
});

test('translation is frame-rate independent between common RAF cadences', () => {
  const runCadence = (frameMs, frameCount) => {
    const { panda } = makePanda();
    const controller = createPandaController({ THREE, panda });
    controller.setActive(true);
    controller.setMovement(0, 1);
    const camera = cameraLooking([0, 0, -1]);
    controller.update(0, camera);
    for (let i = 1; i <= frameCount; i++) controller.update(i * frameMs, camera);
    const distance = -panda.position.z;
    controller.dispose();
    return distance;
  };

  const thirtyFps = runCadence(1000 / 30, 30);
  const sixtyFps = runCadence(1000 / 60, 60);
  closeTo(thirtyFps, 2.6, 0.001);
  closeTo(sixtyFps, 2.6, 0.001);
  closeTo(thirtyFps, sixtyFps, 0.001);
});
