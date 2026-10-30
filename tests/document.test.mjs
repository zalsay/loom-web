import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyOperations,
  ASSETS,
  createDefaultScene,
  MATERIALS,
  SCENE_LIMITS,
  TEMPLATE_TARGETS,
  validateSceneDocument,
} from '../web/js/editor/document.js';

const bench = (id = 'obj_bench_1') => ({
  id,
  assetId: 'garden.bench.wood',
  name: '木长椅',
  transform: {
    position: [1, 0, 2],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  },
  materialId: 'wood.warm-oak',
});

test('default scene follows the fixed template and registry contract', () => {
  const scene = createDefaultScene();
  assert.equal(scene.schemaVersion, 1);
  assert.match(scene.documentId, /^scene_[a-f0-9]{32}$/);
  assert.equal(scene.title, '我的织界空间');
  assert.equal(scene.seed, 4917);
  assert.equal(scene.template.id, 'official-pavilion-garden');
  assert.equal(scene.template.version, '1.0.0');
  assert.deepEqual(scene.templateOverrides, []);
  assert.deepEqual(scene.objects, []);
  assert.equal(createDefaultScene({ title: '春日' }).title, '春日');
  assert.equal(createDefaultScene({ seed: 0xffffffff }).seed, 0xffffffff);
  assert.equal(Object.isFrozen(ASSETS), true);
  assert.equal(Object.isFrozen(MATERIALS), true);
  assert.equal(ASSETS['garden.bamboo-cluster'].label, '竹丛');
  assert.equal(MATERIALS['glass.frosted'].label, '磨砂玻璃');
  assert.deepEqual(Object.keys(TEMPLATE_TARGETS), [
    'pavilion.frame',
    'pavilion.roof',
    'pavilion.glass',
  ]);
});

test('validator returns an independent normalized clone', () => {
  const source = createDefaultScene();
  const validated = validateSceneDocument(source);
  assert.notStrictEqual(validated, source);
  assert.notStrictEqual(validated.environment, source.environment);
  source.environment.doorState = 'open';
  assert.equal(validated.environment.doorState, 'closed');
  assert.equal(source.environment.doorState, 'open');
});

test('validator rejects unknown, inherited, accessor, and symbol fields without invoking getters', () => {
  const base = createDefaultScene();
  assert.throws(() => validateSceneDocument({ ...base, ownerId: 'forged' }), /unknown field/);
  assert.throws(
    () => validateSceneDocument(Object.assign(Object.create({ ownerId: 'x' }), base)),
    /custom prototype/,
  );

  let getterCalled = false;
  const accessorScene = { ...base };
  Object.defineProperty(accessorScene, 'title', {
    enumerable: true,
    get() {
      getterCalled = true;
      return '不应读取';
    },
  });
  assert.throws(() => validateSceneDocument(accessorScene), /data property/);
  assert.equal(getterCalled, false);

  const symbolScene = { ...base, [Symbol('extra')]: true };
  assert.throws(() => validateSceneDocument(symbolScene), /symbol keys/);

  const protoKeyScene = { ...base };
  Object.defineProperty(protoKeyScene, '__proto__', {
    enumerable: true,
    value: { polluted: true },
  });
  assert.throws(() => validateSceneDocument(protoKeyScene), /unknown field/);
  assert.equal({}.polluted, undefined);
});

test('validator rejects invalid numbers, bounds, registry versions, and duplicate IDs', () => {
  const base = createDefaultScene();
  assert.throws(() => validateSceneDocument({ ...base, seed: Number.NaN }), /finite/);
  assert.throws(() => validateSceneDocument({ ...base, seed: -1 }), /between/);
  assert.throws(() => validateSceneDocument({ ...base, seed: 1.5 }), /integer/);
  assert.throws(
    () => validateSceneDocument({ ...base, registries: { ...base.registries, assets: 'other@1' } }),
    /unsupported/,
  );
  assert.throws(
    () =>
      validateSceneDocument({
        ...base,
        camera: { ...base.camera, position: [...base.camera.target] },
      }),
    /must differ/,
  );
  assert.throws(
    () => validateSceneDocument({ ...base, camera: { ...base.camera, fovDegrees: 100 } }),
    /between/,
  );
  assert.throws(
    () => validateSceneDocument({ ...base, environment: { ...base.environment, timeOfDay: 24.1 } }),
    /between/,
  );
  assert.throws(() => validateSceneDocument({ ...base, objects: [bench(), bench()] }), /unique/);
  assert.throws(() => validateSceneDocument({ ...base, objects: new Array(1) }), /sparse arrays/);
  assert.equal(SCENE_LIMITS.maxObjects, 256);
  assert.equal(SCENE_LIMITS.maxOperations, 32);
});

test('validator enforces finite transforms and registered asset/material compatibility', () => {
  const base = createDefaultScene();
  assert.doesNotThrow(() => validateSceneDocument({ ...base, objects: [bench()] }));
  assert.throws(
    () => validateSceneDocument({ ...base, objects: [{ ...bench(), materialId: 'glass.clear' }] }),
    /not compatible/,
  );
  assert.throws(
    () =>
      validateSceneDocument({
        ...base,
        objects: [{ ...bench(), transform: { ...bench().transform, position: [201, 0, 0] } }],
      }),
    /between/,
  );
  assert.throws(
    () =>
      validateSceneDocument({
        ...base,
        objects: [{ ...bench(), transform: { ...bench().transform, rotation: [Infinity, 0, 0] } }],
      }),
    /finite/,
  );
  assert.throws(
    () =>
      validateSceneDocument({
        ...base,
        templateOverrides: [
          { targetId: 'pavilion.roof', materialSlot: 'surface', materialId: 'glass.frosted' },
        ],
      }),
    /not compatible/,
  );
  assert.throws(
    () =>
      validateSceneDocument({
        ...base,
        templateOverrides: [
          { targetId: 'pavilion.unknown', materialSlot: 'surface', materialId: 'plaster.ivory' },
        ],
      }),
    /not an editable template target/,
  );
});

test('operation batches support all allowlisted edits and are atomic', () => {
  const scene = createDefaultScene();
  const next = applyOperations(scene, [
    { op: 'add_object', ...bench() },
    {
      op: 'move_object',
      objectId: 'obj_bench_1',
      transform: { position: [3, 0, 4], rotation: [0, 1, 0], scale: [1.2, 1.2, 1.2] },
    },
    {
      op: 'set_material',
      target: { kind: 'object', objectId: 'obj_bench_1' },
      materialId: 'metal.graphite',
    },
    { op: 'set_environment', patch: { skyPreset: 'dusk', doorState: 'open' } },
    { op: 'set_camera', camera: { position: [8, 8, 8], target: [0, 1, 0], fovDegrees: 45 } },
    {
      op: 'set_material',
      target: { kind: 'template', targetId: 'pavilion.glass', materialSlot: 'surface' },
      materialId: 'glass.frosted',
    },
  ]);

  assert.equal(scene.objects.length, 0);
  assert.equal(scene.environment.skyPreset, 'soft-afternoon');
  assert.equal(next.objects[0].materialId, 'metal.graphite');
  assert.deepEqual(next.objects[0].transform.position, [3, 0, 4]);
  assert.equal(next.environment.doorState, 'open');
  assert.equal(next.camera.fovDegrees, 45);
  assert.deepEqual(next.templateOverrides, [
    { targetId: 'pavilion.glass', materialSlot: 'surface', materialId: 'glass.frosted' },
  ]);

  const removed = applyOperations(next, [{ op: 'remove_object', objectId: 'obj_bench_1' }]);
  assert.equal(removed.objects.length, 0);
  assert.equal(next.objects.length, 1);

  assert.throws(
    () =>
      applyOperations(scene, [
        { op: 'add_object', ...bench() },
        { op: 'move_object', objectId: 'obj_missing', transform: bench().transform },
      ]),
    /does not reference a personal object/,
  );
  assert.deepEqual(scene.objects, []);
});

test('operation batches reject incompatible targets, duplicate IDs, unknown fields, and overflow', () => {
  const scene = createDefaultScene();
  assert.throws(
    () =>
      applyOperations(scene, [{ op: 'add_object', ...{ ...bench(), materialId: 'glass.clear' } }]),
    /not compatible/,
  );
  assert.throws(
    () =>
      applyOperations(scene, [
        { op: 'add_object', ...bench() },
        { op: 'add_object', ...bench() },
      ]),
    /already exists/,
  );
  assert.throws(
    () =>
      applyOperations(scene, [
        {
          op: 'set_material',
          target: { kind: 'template', targetId: 'pavilion.roof', materialSlot: 'surface' },
          materialId: 'glass.frosted',
        },
      ]),
    /not compatible/,
  );
  assert.throws(
    () => applyOperations(scene, [{ op: 'set_environment', patch: { temperature: 12 } }]),
    /unknown field/,
  );
  assert.throws(() => applyOperations(scene, [{ op: 'clear_scene' }]), /allowlisted/);
  assert.throws(
    () =>
      applyOperations(
        scene,
        Array.from({ length: 33 }, () => ({ op: 'set_environment', patch: { doorState: 'open' } })),
      ),
    /at most 32/,
  );
});

test('operation parser rejects accessors before reading discriminant fields', () => {
  let getterCalled = false;
  const operation = {};
  Object.defineProperty(operation, 'op', {
    enumerable: true,
    get() {
      getterCalled = true;
      return 'set_environment';
    },
  });
  assert.throws(() => applyOperations(createDefaultScene(), [operation]), /data property/);
  assert.equal(getterCalled, false);
});
