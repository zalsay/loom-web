import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const vendorUrl = new URL('../web/vendor/', import.meta.url).href;
const loaderSource = `
  const vendor = ${JSON.stringify(vendorUrl)};
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === 'three') return { url: new URL('three.module.js', vendor).href, shortCircuit: true };
    if (specifier.startsWith('three/addons/')) return {
      url: new URL(specifier.slice('three/'.length), vendor).href,
      shortCircuit: true,
    };
    return nextResolve(specifier, context);
  }
`;
register(`data:text/javascript,${encodeURIComponent(loaderSource)}`, import.meta.url);
const { createPavilion } = await import('../web/scene/model.js');
const { createSpaceRenderer } = await import('../web/js/editor/renderer.js');

function canvasContext() {
  return {
    createImageData(width, height) {
      return { data: new Uint8ClampedArray(width * height * 4) };
    },
    putImageData() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    ellipse() {},
    fill() {},
  };
}

globalThis.document = {
  createElement(name) {
    assert.equal(name, 'canvas');
    const context = canvasContext();
    return { width: 0, height: 0, getContext: () => context };
  },
};

function resources(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material)
      ? object.material || []
      : [object.material]) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  return { geometries, materials, textures };
}

function dispose(root) {
  const used = resources(root);
  for (const geometry of used.geometries) geometry.dispose();
  for (const texture of used.textures) texture.dispose();
  for (const material of used.materials) material.dispose();
}

function grassSignature(model) {
  const grass = model.landscape.getObjectByName('细草叶');
  return Array.from(grass.instanceMatrix.array.slice(0, 192)).join(',');
}

test('createPavilion keeps the default model stable and isolates seed resources per instance', () => {
  const first = createPavilion();
  const second = createPavilion({ seed: 4917 });
  const differentSeed = createPavilion({ seed: 4918 });
  try {
    assert.equal(first.root.name, '视频还原 · 白色折柱廊亭');
    assert.equal(first.building.name, '建筑');
    assert.equal(first.ground.name, '地面与铺装');
    assert.equal(first.landscape.name, '草坪与园林');
    assert.equal(first.panda.name, 'LoomOS Panda');
    assert.deepEqual(Object.keys(first.editableTargets).sort(), [
      'pavilion.frame',
      'pavilion.glass',
      'pavilion.roof',
    ]);
    const doorLeaves = [];
    first.building.traverse((object) => {
      if (object.userData.doorLeaf) doorLeaves.push(object);
    });
    assert.equal(doorLeaves.length, 3);
    assert.equal(grassSignature(first), grassSignature(second));
    assert.notEqual(grassSignature(first), grassSignature(differentSeed));
    assert.notEqual(first.materials['白色哑光铝板'], second.materials['白色哑光铝板']);

    const firstResources = resources(first.root);
    const secondResources = resources(second.root);
    for (const kind of ['geometries', 'materials', 'textures']) {
      for (const resource of firstResources[kind]) {
        assert.equal(
          secondResources[kind].has(resource),
          false,
          `${kind} must not cross instances`,
        );
      }
    }
    for (const targetId of Object.keys(first.editableTargets)) {
      const targetMeshes = [];
      first.root.traverse((object) => {
        if (object.userData.templateTargetId === targetId) targetMeshes.push(object);
      });
      assert.ok(targetMeshes.length > 0, `${targetId} must resolve to stable template meshes`);
    }
  } finally {
    dispose(first.root);
    dispose(second.root);
    dispose(differentSeed.root);
  }
});

test('seed validation and renderer entrypoint are explicit', async () => {
  assert.throws(() => createPavilion({ seed: -1 }), /seed must be an unsigned 32-bit integer/);
  assert.equal(typeof createSpaceRenderer, 'function');
  await assert.rejects(createSpaceRenderer({}), /container must be a DOM element/);
});
