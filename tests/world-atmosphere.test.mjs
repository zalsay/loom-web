import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../web/vendor/three.module.js';
import { createWorldAtmosphere } from '../web/js/world-atmosphere.js';

const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
globalThis.document = { body: { dataset: {} } };
after(() => {
  if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument);
  else delete globalThis.document;
});

const day = {
  sunrise: Date.parse('2026-06-20T22:00:00Z'), // 06:00 in Shanghai.
  sunset: Date.parse('2026-06-21T10:00:00Z'), // 18:00 in Shanghai.
  date: '2026-06-21',
};

function createHarness(options = {}) {
  document.body.dataset = {};
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f0e8);
  scene.fog = new THREE.Fog(0xded8ca, 36, 180);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
  camera.position.set(1, 8, 22);
  camera.lookAt(0, 0, 0);
  const hemi = new THREE.HemisphereLight(0xdce8ff, 0x5a5142, 1.2);
  const sun = new THREE.DirectionalLight(0xfff1d5, 1.4);
  const fill = new THREE.PointLight(0xd4e6ff, 0.55);
  sun.position.set(8, 12, 4);
  scene.add(hemi, sun, fill);
  const renderer = { domElement: { style: { backgroundColor: 'rgb(245, 240, 232)' } } };
  const unrelatedGeometry = new THREE.BoxGeometry(1, 1, 1);
  const unrelatedMaterial = new THREE.MeshBasicMaterial({ color: 0xff00ff });
  const unrelated = new THREE.Mesh(unrelatedGeometry, unrelatedMaterial);
  unrelated.name = 'unrelated test mesh';
  scene.add(unrelated);
  const originalBackground = scene.background;
  const originalFog = scene.fog;
  const controller = createWorldAtmosphere({
    THREE,
    scene,
    originalBackground,
    originalFog,
    camera,
    renderer,
    hemi,
    sun,
    fill,
    ...options,
  });
  return {
    scene,
    originalBackground,
    originalFog,
    camera,
    hemi,
    sun,
    fill,
    renderer,
    unrelated,
    unrelatedGeometry,
    unrelatedMaterial,
    controller,
  };
}

function state(now, { sun = day, condition = 'clear' } = {}) {
  return { now, sun, current: { condition } };
}

function particle(scene) {
  return scene.children.find((object) => object.name === 'World weather particles') ?? null;
}

function trackDispose(resource) {
  let count = 0;
  resource.addEventListener('dispose', () => count++);
  return () => count;
}

test('day, dusk, night, and mismatched sun dates keep stable background and readable night lighting', () => {
  const { scene, hemi, sun, fill, controller } = createHarness();
  const originalHemiColor = hemi.color.clone();

  controller.setConditions(state(Date.parse('2026-06-21T04:00:00Z'))); // 12:00 Shanghai.
  assert.equal(document.body.dataset.worldPhase, 'day');
  const middaySky = scene.background.getHex();
  const middaySun = sun.intensity;
  assert.ok(middaySun > 0.08);

  controller.setConditions(state(Date.parse('2026-06-21T09:40:00Z'))); // 17:40 Shanghai.
  assert.equal(document.body.dataset.worldPhase, 'dusk');
  const duskSky = scene.background.getHex();
  assert.notEqual(duskSky, middaySky);

  controller.setConditions(state(day.sunset));
  assert.equal(document.body.dataset.worldPhase, 'dusk');
  const afterSunset = Date.parse('2026-06-21T10:01:00Z');
  controller.setConditions(state(afterSunset));
  assert.equal(document.body.dataset.worldPhase, 'night');
  const nightSky = scene.background.getHex();
  const nightLight = [hemi.intensity, sun.intensity, fill.intensity];
  assert.ok(nightLight[0] >= 0.82, `night hemisphere intensity=${nightLight[0]}`);
  assert.ok(nightLight[1] >= 0.08, `night sun intensity=${nightLight[1]}`);
  assert.ok(nightLight[2] >= 0.28, `night fill intensity=${nightLight[2]}`);
  controller.setConditions(state(afterSunset));
  assert.equal(document.body.dataset.worldPhase, 'night');
  assert.equal(scene.background.getHex(), nightSky);
  assert.deepEqual([hemi.intensity, sun.intensity, fill.intensity], nightLight);

  controller.setConditions(
    state(Date.parse('2026-06-21T04:00:00Z'), {
      sun: { ...day, date: '2026-06-20' },
    }),
  );
  assert.equal(document.body.dataset.worldPhase, 'day');
  assert.ok(hemi.intensity > 0.82);
  assert.notDeepEqual(hemi.color.toArray(), originalHemiColor.toArray());
  controller.dispose();
});

test('rain-to-snow-to-clear transitions dispose only replaced particles and restore owned scene/light state once', () => {
  const harness = createHarness();
  const {
    scene,
    originalBackground,
    originalFog,
    hemi,
    sun,
    fill,
    unrelated,
    unrelatedGeometry,
    unrelatedMaterial,
    controller,
  } = harness;
  const originalFogColor = scene.fog.color.clone();
  const originalFogNear = scene.fog.near;
  const originalFogFar = scene.fog.far;
  const originalHemi = {
    intensity: hemi.intensity,
    color: hemi.color.clone(),
    ground: hemi.groundColor.clone(),
  };
  const originalSun = {
    intensity: sun.intensity,
    color: sun.color.clone(),
    position: sun.position.clone(),
  };
  const originalFill = { intensity: fill.intensity, color: fill.color.clone() };
  const unrelatedGeometryDisposed = trackDispose(unrelatedGeometry);
  const unrelatedMaterialDisposed = trackDispose(unrelatedMaterial);

  controller.setConditions(state(Date.parse('2026-06-21T04:00:00Z'), { condition: 'rain' }));
  const rain = particle(scene);
  assert.ok(rain?.isLineSegments);
  assert.equal(rain.geometry.attributes.position.count, 256);
  assert.ok(rain.geometry.attributes.position.count <= 256);
  const rainGeometryDisposed = trackDispose(rain.geometry);
  const rainMaterialDisposed = trackDispose(rain.material);

  controller.setConditions(state(Date.parse('2026-06-21T04:00:00Z'), { condition: 'snow' }));
  assert.equal(rainGeometryDisposed(), 1);
  assert.equal(rainMaterialDisposed(), 1);
  const snow = particle(scene);
  assert.ok(snow?.isPoints);
  assert.equal(snow.geometry.attributes.position.count, 104);
  assert.ok(snow.geometry.attributes.position.count <= 256);
  const snowGeometryDisposed = trackDispose(snow.geometry);
  const snowMaterialDisposed = trackDispose(snow.material);

  controller.setConditions(state(Date.parse('2026-06-21T04:00:00Z'), { condition: 'clear' }));
  assert.equal(particle(scene), null);
  assert.equal(controller.update(1000), false);
  assert.equal(snowGeometryDisposed(), 1);
  assert.equal(snowMaterialDisposed(), 1);
  assert.equal(unrelatedGeometryDisposed(), 0);
  assert.equal(unrelatedMaterialDisposed(), 0);

  controller.dispose();
  controller.dispose();
  assert.equal(scene.background, originalBackground);
  assert.equal(scene.fog, originalFog);
  assert.ok(scene.fog.color.equals(originalFogColor));
  assert.equal(scene.fog.near, originalFogNear);
  assert.equal(scene.fog.far, originalFogFar);
  assert.equal(hemi.intensity, originalHemi.intensity);
  assert.ok(hemi.color.equals(originalHemi.color));
  assert.ok(hemi.groundColor.equals(originalHemi.ground));
  assert.equal(sun.intensity, originalSun.intensity);
  assert.ok(sun.color.equals(originalSun.color));
  assert.ok(sun.position.equals(originalSun.position));
  assert.equal(fill.intensity, originalFill.intensity);
  assert.ok(fill.color.equals(originalFill.color));
  assert.ok(scene.children.includes(unrelated));
  assert.equal(unrelatedGeometryDisposed(), 0);
  assert.equal(unrelatedMaterialDisposed(), 0);
});

test('reduced motion and SVG compatibility keep precipitation out of the scene', () => {
  const reduced = createHarness({ reducedMotion: true });
  reduced.controller.setConditions(
    state(Date.parse('2026-06-21T04:00:00Z'), { condition: 'rain' }),
  );
  assert.equal(particle(reduced.scene), null);
  assert.equal(reduced.controller.update(16), false);
  reduced.controller.dispose();

  const compatibility = createHarness({ compatibilityMode: true });
  const originalBackground = compatibility.renderer.domElement.style.backgroundColor;
  compatibility.controller.setConditions(
    state(Date.parse('2026-06-21T04:00:00Z'), { condition: 'rain' }),
  );
  assert.equal(particle(compatibility.scene), null);
  assert.equal(compatibility.controller.update(16), false);
  assert.equal(
    compatibility.renderer.domElement.style.backgroundColor,
    compatibility.scene.background.getStyle(),
  );
  const rainyBackground = compatibility.renderer.domElement.style.backgroundColor;
  compatibility.controller.setConditions(
    state(Date.parse('2026-06-21T04:00:00Z'), { condition: 'snow' }),
  );
  assert.equal(particle(compatibility.scene), null);
  assert.equal(compatibility.controller.update(32), false);
  assert.equal(
    compatibility.renderer.domElement.style.backgroundColor,
    compatibility.scene.background.getStyle(),
  );
  assert.notEqual(compatibility.renderer.domElement.style.backgroundColor, rainyBackground);
  compatibility.controller.dispose();
  assert.equal(compatibility.renderer.domElement.style.backgroundColor, originalBackground);
});
