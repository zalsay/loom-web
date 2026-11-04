import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const vendorUrl = new URL('../web/vendor/', import.meta.url).href;
const loaderSource = `
  const vendor = ${JSON.stringify(vendorUrl)};
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === 'three') return { url: new URL('three.module.js', vendor).href, shortCircuit: true };
    return nextResolve(specifier, context);
  }
`;
register(`data:text/javascript,${encodeURIComponent(loaderSource)}`, import.meta.url);

const THREE = await import('three');
const { createLiftingTable } = await import('../web/scene/lifting-table.js');

function meshes(root) {
  const found = [];
  root.traverse((object) => {
    if (object.isMesh) found.push(object);
  });
  return found;
}

function resources(root) {
  const geometries = new Set();
  const materials = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material)
      ? object.material || []
      : [object.material])
      if (material) materials.add(material);
  });
  return { geometries, materials };
}

function dispose(root) {
  const owned = resources(root);
  for (const geometry of owned.geometries) geometry.dispose();
  for (const material of owned.materials) material.dispose();
}

function boundsOf(object) {
  object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(object);
}

test('thin white rectangular desktop has the requested dimensions and level top surface', () => {
  const table = createLiftingTable({ width: 2.4, depth: 1.05, height: 0.82, floorY: 0.13 });
  try {
    const carrier = table.getObjectByName('升降桌面承载组');
    const top = table.getObjectByName('白色圆角长方桌面');
    assert.ok(carrier?.userData.devicePlacementSurface);
    assert.equal(carrier.position.y, 0.95);
    assert.equal(carrier.userData.tabletopSurfaceY, 0);
    assert.equal(table.name, '白色手动升降长桌');
    assert.equal(table.userData.storeTable, true);
    assert.equal(table.userData.tableType, 'manual-lifting-table');
    assert.equal(table.userData.liftMechanism, 'screw-lock');
    assert.equal(table.userData.heightAboveFloor, 0.82);
    assert.deepEqual(table.userData.footprint, [2.4, 1.05]);
    assert.deepEqual(table.userData.heightRange, [0.65, 1]);
    assert.equal(table.userData.rigidPlan, true);
    assert.ok(top?.userData.tabletop);
    assert.equal(top.userData.thickness, 0.025);
    assert.equal(top.material.name, '白色哑光桌面');
    assert.equal(top.material.color.getHex(), 0xf3f3f0);

    const topBounds = boundsOf(top);
    const size = topBounds.getSize(new THREE.Vector3());
    assert.ok(Math.abs(size.x - 2.4) < 1e-6);
    assert.ok(Math.abs(size.z - 1.05) < 1e-6);
    assert.ok(Math.abs(size.y - 0.025) < 1e-6);
    assert.ok(Math.abs(topBounds.min.x + 1.2) < 1e-6);
    assert.ok(Math.abs(topBounds.max.x - 1.2) < 1e-6);
    assert.ok(Math.abs(topBounds.min.z + 0.525) < 1e-6);
    assert.ok(Math.abs(topBounds.max.z - 0.525) < 1e-6);
    assert.ok(Math.abs(topBounds.max.y - (0.13 + 0.82)) < 1e-6);
    assert.ok(Math.abs(topBounds.min.y - (0.13 + 0.82 - 0.025)) < 1e-6);
  } finally {
    dispose(table);
  }
});

test('two long end feet carry four independent double-stage columns with manual locks and locating holes', () => {
  const table = createLiftingTable();
  try {
    const carrier = table.getObjectByName('升降桌面承载组');
    const allMeshes = meshes(carrier);
    const feet = allMeshes.filter((mesh) => mesh.userData.tableFoot && !mesh.userData.floorContact);
    const pads = allMeshes.filter((mesh) => mesh.userData.floorContact);
    const columns = allMeshes.filter((mesh) => mesh.userData.telescopicSegment);
    const locks = allMeshes.filter((mesh) => mesh.userData.manualLock);
    const holes = allMeshes.filter((mesh) => mesh.userData.heightHole);
    const braces = allMeshes.filter((mesh) => mesh.userData.triangularBrace);

    assert.equal(feet.length, 2);
    assert.ok(feet.every((foot) => foot.geometry === feet[0].geometry));
    assert.ok(
      feet.every((foot) => foot.scale.z > 0.8),
      'base feet span nearly the tabletop depth',
    );
    assert.equal(pads.length, 4);
    assert.equal(columns.length, 8, 'four columns each have two sliding stages');
    assert.equal(new Set(columns.map((column) => column.userData.columnId)).size, 4);
    assert.equal(locks.filter((part) => part.userData.lockPart === 'collar').length, 4);
    assert.equal(locks.filter((part) => part.userData.lockPart === 'hand-screw').length, 4);
    assert.equal(locks.filter((part) => part.userData.lockPart === 'knob').length, 4);
    assert.equal(holes.length, 20);
    assert.equal(braces.length, 4);
    assert.equal(allMeshes.filter((mesh) => mesh.userData.motorHousing).length, 0);
    assert.equal(allMeshes.filter((mesh) => mesh.userData.physicalControl).length, 0);
    assert.equal(allMeshes.filter((mesh) => mesh.userData.cableTray).length, 0);

    table.updateMatrixWorld(true);
    for (const pad of pads) {
      const padBounds = new THREE.Box3().setFromObject(pad);
      assert.ok(Math.abs(padBounds.min.y - table.userData.floorY) < 1e-6);
      assert.ok(padBounds.min.x >= -1.2 && padBounds.max.x <= 1.2);
      assert.ok(padBounds.min.z >= -0.525 && padBounds.max.z <= 0.525);
    }
  } finally {
    dispose(table);
  }
});

test('feet remain on the floor and both column stages stay nested and connected at height endpoints', () => {
  for (const height of [0.65, 0.82, 1]) {
    const table = createLiftingTable({ height });
    try {
      const carrier = table.getObjectByName('升降桌面承载组');
      const allMeshes = meshes(carrier);
      table.updateMatrixWorld(true);
      const columns = allMeshes.filter((mesh) => mesh.userData.telescopicSegment);
      const pads = allMeshes.filter((mesh) => mesh.userData.floorContact);
      assert.equal(columns.length, 8);
      assert.equal(pads.length, 4);
      for (const pad of pads) {
        const padBounds = new THREE.Box3().setFromObject(pad);
        assert.ok(Math.abs(padBounds.min.y - table.userData.floorY) < 1e-6);
      }

      const columnIds = new Set(columns.map((column) => column.userData.columnId));
      assert.equal(columnIds.size, 4);
      for (const columnId of columnIds) {
        const stages = columns
          .filter((mesh) => mesh.userData.columnId === columnId)
          .sort((a, b) => a.userData.stage - b.userData.stage);
        assert.deepEqual(
          stages.map((mesh) => mesh.userData.stage),
          [1, 2],
        );
        assert.ok(stages.every((mesh) => mesh.userData.upperY > mesh.userData.lowerY));
        assert.ok(stages.every((mesh) => Number.isFinite(mesh.position.y) && mesh.scale.y > 0));
        assert.ok(stages[0].userData.upperY >= stages[1].userData.lowerY);
        assert.ok(Math.abs(stages[0].userData.lowerY - (-height + 0.047)) < 1e-9);
        assert.ok(Math.abs(stages[1].userData.upperY - -0.025) < 1e-9);
      }
    } finally {
      dispose(table);
    }
  }
});

test('all frame, locks, and braces remain within the desktop footprint at supported minimum sizes', () => {
  for (const options of [
    { width: 1.4, depth: 0.7, height: 0.65 },
    { width: 3, depth: 1.4, height: 1 },
    {},
  ]) {
    const table = createLiftingTable(options);
    try {
      const [width, depth] = table.userData.footprint;
      const bounds = new THREE.Box3();
      for (const mesh of meshes(table)) bounds.expandByObject(mesh);
      assert.ok(
        bounds.min.x >= -width / 2 - 1e-6,
        `minimum x escaped for ${JSON.stringify(options)}`,
      );
      assert.ok(
        bounds.max.x <= width / 2 + 1e-6,
        `maximum x escaped for ${JSON.stringify(options)}`,
      );
      assert.ok(
        bounds.min.z >= -depth / 2 - 1e-6,
        `minimum z escaped for ${JSON.stringify(options)}`,
      );
      assert.ok(
        bounds.max.z <= depth / 2 + 1e-6,
        `maximum z escaped for ${JSON.stringify(options)}`,
      );
      for (const mesh of meshes(table)) {
        const values = [
          mesh.position.x,
          mesh.position.y,
          mesh.position.z,
          mesh.scale.x,
          mesh.scale.y,
          mesh.scale.z,
        ];
        assert.ok(values.every(Number.isFinite), `${mesh.name} contains non-finite transforms`);
      }
    } finally {
      dispose(table);
    }
  }
});

test('instances own independent native geometry and white/lock materials', () => {
  const first = createLiftingTable();
  const second = createLiftingTable();
  try {
    const firstResources = resources(first);
    const secondResources = resources(second);
    assert.ok(firstResources.geometries.size > 0);
    assert.ok(firstResources.materials.size > 0);
    for (const geometry of firstResources.geometries)
      assert.equal(secondResources.geometries.has(geometry), false);
    for (const material of firstResources.materials)
      assert.equal(secondResources.materials.has(material), false);
  } finally {
    dispose(first);
    dispose(second);
  }
});

test('dimensions, height, and floor position reject invalid values', () => {
  for (const options of [
    { width: 1.39 },
    { width: 3.01 },
    { width: Number.NaN },
    { width: Number.POSITIVE_INFINITY },
    { depth: 0.69 },
    { depth: 1.41 },
    { depth: Number.NaN },
    { depth: Number.NEGATIVE_INFINITY },
    { height: 0.649 },
    { height: 1.001 },
    { height: Number.NaN },
    { height: Number.NEGATIVE_INFINITY },
    { floorY: Number.NaN },
    { floorY: Number.POSITIVE_INFINITY },
  ])
    assert.throws(() => createLiftingTable(options), TypeError);

  const defaults = createLiftingTable();
  try {
    assert.deepEqual(defaults.userData.footprint, [2.4, 1.05]);
    assert.equal(defaults.userData.height, 0.82);
  } finally {
    dispose(defaults);
  }
});

test('desktop has a physical fine bevel without moving its device-placement plane', () => {
  const table = createLiftingTable();
  try {
    const top = table.getObjectByName('白色圆角长方桌面');
    assert.equal(top.geometry.parameters.options.bevelEnabled, true);
    assert.ok(top.geometry.parameters.options.bevelSize <= 0.002);
    assert.ok(
      Math.abs(boundsOf(top).max.y - table.getObjectByName('升降桌面承载组').position.y) < 1e-6,
    );
  } finally {
    dispose(table);
  }
});
