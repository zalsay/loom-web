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
const { createLaboratoryTableExhibits } = await import('../web/scene/laboratory-exhibits.js');

const DEVICE_KINDS = ['brick-robot-dog', 'development-board', 'tool-kit', 'quadcopter'];

function descendants(root, predicate) {
  const matches = [];
  root.traverse((object) => {
    if (predicate(object)) matches.push(object);
  });
  return matches;
}

function meshBounds(root) {
  root.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3();
  root.traverse((object) => {
    if (object.isMesh) bounds.expandByObject(object);
  });
  return bounds;
}

function resources(root) {
  const geometries = new Set();
  const materials = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    for (const mat of Array.isArray(object.material) ? object.material || [] : [object.material])
      if (mat) materials.add(mat);
  });
  return { geometries, materials };
}

function dispose(root) {
  const used = resources(root);
  for (const geometry of used.geometries) geometry.dispose();
  for (const material of used.materials) material.dispose();
}

function triangleCount(root) {
  return descendants(root, (object) => object.isMesh).reduce((total, object) => {
    const geometry = object.geometry;
    const count = geometry.index
      ? geometry.index.count
      : geometry.getAttribute('position')?.count || 0;
    return total + count / 3;
  }, 0);
}

function assertFinitePositiveTransforms(root) {
  root.traverse((object) => {
    for (const component of [
      object.position.x,
      object.position.y,
      object.position.z,
      object.rotation.x,
      object.rotation.y,
      object.rotation.z,
      object.scale.x,
      object.scale.y,
      object.scale.z,
    ])
      assert.ok(Number.isFinite(component), `${object.name} has a finite transform`);
    assert.ok(object.scale.x > 0 && object.scale.y > 0 && object.scale.z > 0);
  });
}

for (const variant of [0, 1]) {
  test(`variant ${variant} contains three contained, tabletop-seated laboratory exhibits`, () => {
    const assembly = createLaboratoryTableExhibits({ variant });
    try {
      assert.equal(assembly.userData.rigidAssembly, true);
      assert.equal(assembly.userData.variant, variant);
      assert.equal(assembly.children.length, 3);
      const kinds = assembly.children.map((item) => item.userData.device);
      assert.deepEqual(
        kinds,
        variant === 0
          ? ['brick-robot-dog', 'development-board', 'tool-kit']
          : ['quadcopter', 'tool-kit', 'development-board'],
      );
      assert.ok(
        kinds.every((kind, index) => assembly.children[index].userData.laboratoryExhibit === kind),
      );

      const groupBounds = [];
      for (const exhibit of assembly.children) {
        const bounds = meshBounds(exhibit);
        groupBounds.push(bounds);
        assert.ok(bounds.min.x >= -1.14 - 1e-6 && bounds.max.x <= 1.14 + 1e-6);
        assert.ok(bounds.min.z >= -0.47 - 1e-6 && bounds.max.z <= 0.47 + 1e-6);
        assert.ok(bounds.min.y >= -1e-6, `${exhibit.name} has no geometry below the tabletop`);
        assert.ok(bounds.min.y <= 0.001, `${exhibit.name} touches the tabletop at y=0`);
        assert.ok(bounds.max.y <= 0.55 + 1e-6);
        assertFinitePositiveTransforms(exhibit);
      }
      for (let first = 0; first < groupBounds.length; first++) {
        for (let second = first + 1; second < groupBounds.length; second++)
          assert.equal(groupBounds[first].intersectsBox(groupBounds[second]), false);
      }

      const allMeshes = descendants(assembly, (object) => object.isMesh);
      assert.ok(
        allMeshes.length <= 240,
        `uses ${allMeshes.length} meshes, within the 240-mesh budget`,
      );
      assert.ok(
        triangleCount(assembly) <= 6500,
        'combined exhibit geometry stays within 6500 triangles',
      );
      assert.equal(
        descendants(assembly, (object) => /apple|iphone|macbook|ipad|苹果/i.test(object.name))
          .length,
        0,
      );
    } finally {
      dispose(assembly);
    }
  });
}

test('the two table variants cover all four intended device kinds', () => {
  const first = createLaboratoryTableExhibits({ variant: 0 });
  const second = createLaboratoryTableExhibits({ variant: 1 });
  try {
    assert.deepEqual(
      new Set([...first.children, ...second.children].map((item) => item.userData.device)),
      new Set(DEVICE_KINDS),
    );
  } finally {
    dispose(first);
    dispose(second);
  }
});

test('both variants combined stay within the exhibit mesh and triangle budgets', () => {
  const assemblies = [0, 1].map((variant) => createLaboratoryTableExhibits({ variant }));
  try {
    const meshTotal = assemblies.reduce(
      (total, assembly) => total + descendants(assembly, (object) => object.isMesh).length,
      0,
    );
    const triangleTotal = assemblies.reduce(
      (total, assembly) => total + triangleCount(assembly),
      0,
    );
    assert.ok(
      meshTotal <= 240,
      `both variants use ${meshTotal} meshes, within the 240-mesh budget`,
    );
    assert.ok(
      triangleTotal <= 6500,
      `both variants use ${triangleTotal} triangles, within the 6500-triangle budget`,
    );
  } finally {
    for (const assembly of assemblies) dispose(assembly);
  }
});

test('brick robot dog has four bent legs, studded brickwork, and a sensor head', () => {
  const assembly = createLaboratoryTableExhibits({ variant: 0 });
  try {
    const dog = assembly.children.find((item) => item.userData.device === 'brick-robot-dog');
    assert.equal(descendants(dog, (object) => object.userData.robotLeg === true).length, 4);
    assert.equal(descendants(dog, (object) => object.userData.robotFoot === true).length, 4);
    assert.equal(descendants(dog, (object) => object.userData.robotJoint === 'knee').length, 4);
    assert.equal(descendants(dog, (object) => object.userData.robotLimb === 'upper').length, 4);
    assert.equal(descendants(dog, (object) => object.userData.robotLimb === 'lower').length, 4);
    assert.equal(descendants(dog, (object) => object.userData.brickStud === true).length, 12);
    assert.ok(descendants(dog, (object) => object.userData.sensor === 'range-camera').length > 0);
    assert.ok(dog.getObjectByName('积木拼装躯干'));
    assert.ok(Math.abs(dog.rotation.y - Math.PI) < 1e-8);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(dog.quaternion);
    assert.ok(forward.z > 0.999, 'the robot dog sensor faces the +Z visitor side');
    assert.ok(dog.getObjectByName('传感器头部短颈连接块'));
    assert.ok(dog.getObjectByName('传感器头部短颈连接块').userData.neckConnector);
    assert.ok(meshBounds(dog).max.y <= 0.55);
  } finally {
    dispose(assembly);
  }
});

test('development boards expose PCB, chips, connector, and dense but readable header rows', () => {
  for (const variant of [0, 1]) {
    const assembly = createLaboratoryTableExhibits({ variant });
    try {
      const board = assembly.children.find((item) => item.userData.device === 'development-board');
      assert.equal(descendants(board, (object) => object.userData.pcbSubstrate === true).length, 1);
      assert.ok(
        descendants(board, (object) => object.userData.integratedCircuit === true).length >= 2,
      );
      assert.equal(descendants(board, (object) => object.userData.usbPort === true).length, 1);
      assert.ok(
        descendants(board, (object) => object.userData.headerHousing === true).length >= 19,
      );
      assert.ok(descendants(board, (object) => object.userData.headerPin === true).length >= 19);
    } finally {
      dispose(assembly);
    }
  }
});

test('tool trays contain distinct hand-tool silhouettes and a tray base', () => {
  for (const variant of [0, 1]) {
    const assembly = createLaboratoryTableExhibits({ variant });
    try {
      const tray = assembly.children.find((item) => item.userData.device === 'tool-kit');
      assert.equal(descendants(tray, (object) => object.userData.toolTray === true).length, 1);
      assert.deepEqual(
        new Set(
          descendants(tray, (object) => typeof object.userData.toolPiece === 'string').map(
            (tool) => tool.userData.toolPiece,
          ),
        ),
        new Set(['screwdriver', 'pliers', 'soldering-iron']),
      );
      assert.ok(tray.getObjectByName('尖嘴钳铰链'));
      assert.ok(tray.getObjectByName('烙铁金属发热杆'));
    } finally {
      dispose(assembly);
    }
  }
});

test('quadcopter is static with four rotor hubs, propellers, camera, and tabletop feet', () => {
  const assembly = createLaboratoryTableExhibits({ variant: 1 });
  try {
    const drone = assembly.children.find((item) => item.userData.device === 'quadcopter');
    assert.ok(Math.abs(drone.rotation.y - Math.PI) < 1e-8);
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(drone.quaternion);
    assert.ok(forward.z > 0.999, 'the drone camera faces the +Z visitor side');
    assert.equal(descendants(drone, (object) => object.userData.droneArm === true).length, 4);
    assert.equal(descendants(drone, (object) => object.userData.motorHub === true).length, 4);
    assert.equal(descendants(drone, (object) => object.userData.droneRotor === true).length, 4);
    assert.equal(
      descendants(drone, (object) => object.userData.droneRotorBlade === true).length,
      4,
    );
    assert.equal(descendants(drone, (object) => object.userData.camera === true).length, 1);
    assert.equal(descendants(drone, (object) => object.userData.cameraLens === true).length, 1);
    assert.equal(descendants(drone, (object) => object.userData.landingFoot === true).length, 4);
    assert.ok(descendants(drone, (object) => object.userData.landingGear === true).length >= 4);
    assert.ok(
      descendants(drone, (object) => object.isMesh && object.userData.animation).length === 0,
    );
  } finally {
    dispose(assembly);
  }
});

test('each factory call owns independent geometry and material resources', () => {
  const first = createLaboratoryTableExhibits({ variant: 0 });
  const second = createLaboratoryTableExhibits({ variant: 0 });
  try {
    const firstResources = resources(first);
    const secondResources = resources(second);
    for (const resource of firstResources.geometries)
      assert.equal(secondResources.geometries.has(resource), false);
    for (const resource of firstResources.materials)
      assert.equal(secondResources.materials.has(resource), false);
  } finally {
    dispose(first);
    dispose(second);
  }
});

test('only the two supported table variants are accepted', () => {
  assert.throws(() => createLaboratoryTableExhibits({ variant: 2 }), RangeError);
  assert.throws(() => createLaboratoryTableExhibits({ variant: -1 }), RangeError);
});

test('exhibit materials distinguish optical glass, plastics and conductive metals', () => {
  const assembly = createLaboratoryTableExhibits();
  try {
    const mats = [...resources(assembly).materials];
    const lens = mats.find((m) => m.name === '蓝黑传感器镜片');
    assert.equal(lens.isMeshPhysicalMaterial, true);
    assert.ok(lens.clearcoat > 0 && lens.roughness < 0.25);
    assert.ok(mats.find((m) => m.name === '黄铜触点').metalness >= 0.7);
    assert.ok(mats.find((m) => m.name === '安全黄积木').metalness <= 0.02);
  } finally {
    dispose(assembly);
  }
});
