import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const vendor = new URL('../web/vendor/three.module.js', import.meta.url).href;
register(
  `data:text/javascript,${encodeURIComponent(`
  export async function resolve(specifier, context, next) {
    return specifier === 'three' ? { url: ${JSON.stringify(vendor)}, shortCircuit: true } : next(specifier, context);
  }
`)}`,
  import.meta.url,
);

// Only text-label drawing needs a DOM; geometry and raycasting use real Three.js.
globalThis.document = {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      fillRect() {},
      fillText() {},
      strokeRect() {},
      beginPath() {},
      arc() {},
      fill() {},
    }),
  }),
};
const THREE = await import('three');
const { createFarmScene, FARM_CONFIG } = await import('../web/scene/farm-scene.js');

function dispose(farm) {
  const resources = new Set(Object.values(farm.materials));
  farm.group.traverse((o) => {
    if (o.geometry) resources.add(o.geometry);
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    for (const material of materials) if (material) resources.add(material);
  });
  for (const resource of resources) {
    for (const value of Object.values(resource)) if (value?.isTexture) resources.add(value);
  }
  for (const resource of resources) resource.dispose();
}

test('farm refinements keep finite geometry and the vertex data required by every material', () => {
  const farm = createFarmScene();
  try {
    let meshes = 0,
      instances = 0;
    farm.group.traverse((o) => {
      if (!o.isMesh) return;
      meshes++;
      for (const attr of Object.values(o.geometry.attributes)) {
        assert.ok(
          attr.array.every(Number.isFinite),
          `${o.name || o.parent.name}: invalid ${o.geometry.type} ${JSON.stringify(o.geometry.parameters)}`,
        );
      }
      const materials = Array.isArray(o.material) ? o.material : [o.material];
      for (const material of materials) {
        if (material.vertexColors)
          assert.ok(o.geometry.getAttribute('color'), `${o.name}: missing vertex colors`);
        if (material.map)
          assert.ok(o.geometry.getAttribute('uv'), `${o.name}: missing texture coordinates`);
      }
      if (o.isInstancedMesh) {
        instances += o.count;
        assert.ok(o.instanceMatrix.array.every(Number.isFinite));
      }
    });
    assert.ok(instances > 1000, 'repeated fine detail must use instancing');
    assert.ok(meshes < 650, `draw objects grew unexpectedly: ${meshes}`);
  } finally {
    dispose(farm);
  }
});

test('all six refined crop groups remain raycastable with their original plot data', () => {
  const farm = createFarmScene();
  try {
    farm.group.updateMatrixWorld(true);
    for (const plot of FARM_CONFIG.plots) {
      const group = farm.group.getObjectByName(`Plot_${plot.id}`);
      assert.equal(group.userData.data, plot);
      assert.ok(farm.interactables.includes(group));
      const ray = new THREE.Raycaster(
        new THREE.Vector3(plot.x, 10, plot.z),
        new THREE.Vector3(0, -1, 0),
      );
      const hits = ray.intersectObjects(farm.interactables, true);
      assert.ok(hits.length);
      let selected = hits[0].object;
      while (selected && !selected.userData.type) selected = selected.parent;
      assert.equal(selected.userData.data.id, plot.id);
    }
    assert.equal(farm.interactables.filter((o) => o.userData.type === 'lego_rover').length, 2);
    farm.dripSystem.setVisible(false);
    assert.equal(farm.dripSystem.group.visible, false);
    farm.dripSystem.setVisible(true);
    assert.equal(farm.dripSystem.group.visible, true);
  } finally {
    dispose(farm);
  }
});
