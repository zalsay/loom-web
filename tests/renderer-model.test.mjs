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
    assert.equal(first.panda.name, 'LoomOS Rooftop Panda');
    assert.deepEqual(Object.keys(first.editableTargets).sort(), [
      'pavilion.frame',
      'pavilion.glass',
      'pavilion.roof',
    ]);
    const doorLeaves = [];
    first.building.traverse((object) => {
      if (object.userData.doorLeaf) doorLeaves.push(object);
    });
    assert.equal(doorLeaves.length, 2);
    assert.ok(doorLeaves.every((door) => door.parent.name === '栅格区前方双开玻璃门'));
    assert.deepEqual(
      new Set(doorLeaves.map((door) => door.name)),
      new Set(['双开玻璃门左扇', '双开玻璃门右扇']),
    );
    const frontFacade = first.building.getObjectByName('玻璃房正面固定玻璃立面');
    assert.ok(frontFacade);
    const frontObjectNames = [];
    frontFacade.traverse((object) => frontObjectNames.push(object.name));
    assert.ok(frontObjectNames.includes('正面固定玻璃'));
    assert.ok(frontObjectNames.includes('正面固定玻璃竖向接缝'));
    assert.ok(frontObjectNames.includes('正面固定玻璃底部轨道'));
    assert.ok(frontObjectNames.includes('正面固定玻璃顶部轨道'));
    assert.ok(
      frontObjectNames.every((name) => !/门|拉手|铰链/.test(name)),
      'the panda-facing front facade must remain fixed glazing without door hardware',
    );
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

const THREE = await import('three');
const { nearCanopy, addSiteGround } = await import('../web/scene/site-layout.js');
const { fallbackPlan } = await import('../web/scene/fallback-rules.js');

test('short lawn has grounded 5–10 cm tufts, terrain colour variation and no grass on paving', () => {
  const model = createPavilion();
  const ground = new THREE.Group();
  const asphalt = new THREE.MeshStandardMaterial();
  const curb = new THREE.MeshStandardMaterial();
  const line = new THREE.MeshStandardMaterial();
  const site = addSiteGround(ground, { asphalt, curb, line });
  try {
    const lawn = model.landscape.getObjectByName('草坪地面');
    const blades = model.landscape.getObjectByName('细草叶');
    assert.ok(
      lawn.geometry.getAttribute('color'),
      'ground retains meadow variation without textures',
    );
    assert.equal(lawn.material.vertexColors, true);
    assert.ok(blades.instanceColor, 'short tufts have coherent green variation');
    assert.ok(blades.count <= 24000, 'reuse the existing instance budget');
    const position = blades.geometry.getAttribute('position');
    assert.ok((position.count / 3) * blades.count <= 216000, 'bounded short-grass geometry budget');
    const matrix = new THREE.Matrix4();
    const v = new THREE.Vector3();
    for (let i = 0; i < blades.count; i++) {
      blades.getMatrixAt(i, matrix);
      const x = matrix.elements[12],
        z = matrix.elements[14];
      assert.equal(nearCanopy(x, z, 6) || site.isPaved(x, z), false);
      let min = Infinity,
        max = -Infinity;
      for (let j = 0; j < position.count; j++) {
        v.fromBufferAttribute(position, j).applyMatrix4(matrix);
        min = Math.min(min, v.y);
        max = Math.max(max, v.y);
      }
      assert.ok(Math.abs(min - lawn.position.y) <= 0.003, 'roots touch the lawn');
      assert.ok(max - min >= 0.049 && max - min <= 0.101, 'short lawn, not knee-high grass');
    }
  } finally {
    dispose(model.root);
    dispose(ground);
    asphalt.dispose();
    curb.dispose();
    line.dispose();
  }
});

test('near and distant trees have layered solid crowns, not alpha cards or bare fallback branches', () => {
  const model = createPavilion();
  try {
    const trees = model.landscape.children.filter((o) => o.name === '园林乔木');
    assert.ok(trees.length > 20);
    let triangles = 0;
    for (const tree of trees) {
      const crowns = tree.children.filter((o) => o.name === '树带树冠');
      assert.ok(crowns.length >= 3 && crowns.length <= 6, 'layered crown clusters on every tree');
      for (const crown of crowns) {
        assert.equal(fallbackPlan(crown.name).hidden, false);
        assert.equal(crown.material.alphaTest, 0);
        assert.equal(crown.material.map, null);
        assert.equal(crown.material.vertexColors, true);
        assert.ok(crown.geometry.getAttribute('color'));
        triangles +=
          (crown.geometry.index?.count ?? crown.geometry.getAttribute('position').count) / 3;
      }
      assert.equal(
        tree.children.some((o) => o.name === '疏朗树叶'),
        false,
      );
    }
    assert.ok(triangles < 20000, `keep SVG-friendly crown budget, got ${triangles}`);
  } finally {
    dispose(model.root);
  }
});

test('road tint no longer multiplies a dark texture by another dark asphalt colour', () => {
  const model = createPavilion();
  try {
    const road = model.ground.getObjectByName('右侧主路');
    assert.ok(road.material.color.r > 0.5, 'lighter neutral tint over the asphalt texture');
    assert.equal(road.material.roughness, 1);
    assert.ok(model.ground.getObjectByName('道路虚线'));
    assert.equal(fallbackPlan('草坪地面').flatColor.color, 0x709c4e);
  } finally {
    dispose(model.root);
  }
});
