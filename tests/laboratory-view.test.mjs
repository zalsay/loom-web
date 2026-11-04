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

const THREE = await import('three');
const { createPavilion } = await import('../web/scene/model.js');
const { createLaboratoryView } = await import('../web/scene/laboratory-view.js');
const { APPLE_STORE_NAME } = await import('../web/scene/apple-store.js');
const { GLASS_ROOM, PAVILION } = await import('../web/scene/pavilion-dimensions.js');
const { bendPoint } = await import('../web/scene/site-layout.js');

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

function descendants(root, predicate = () => true) {
  const result = [];
  root.traverse((object) => {
    if (predicate(object)) result.push(object);
  });
  return result;
}

function visibility(root) {
  return new Map(descendants(root).map((object) => [object, object.visible]));
}

function dispose(root) {
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
  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
}

function allVisible(root) {
  const names = [];
  root.traverseVisible((object) => names.push(object.name));
  return names;
}

test('pavilion keeps a complete exterior while its bent glass room is one furnished laboratory group', () => {
  const model = createPavilion();
  try {
    const lab = model.root.getObjectByName('织界实验室');
    assert.ok(lab);
    assert.equal(model.laboratory, lab, 'model exposes the final bent laboratory instance');
    assert.equal(lab.parent, model.building);
    assert.equal(lab.userData.laboratory, true);
    assert.equal(model.building.visible, true);
    assert.ok(model.building.getObjectByName('弧形屋面与白色檐口'));
    assert.ok(model.building.getObjectByName('屋面顶板与金属压边'));
    assert.ok(
      descendants(model.building, (object) => object.name.startsWith('前侧 W 形斜柱')).length > 0,
    );
    assert.equal(lab.getObjectByName('弧形屋面与白色檐口'), undefined);
    assert.equal(lab.getObjectByName('前侧 W 形斜柱 1.4'), undefined);

    for (const name of [
      '玻璃房室内地坪',
      '玻璃房正面固定玻璃立面',
      '玻璃房侧面玻璃',
      '玻璃竖向接缝',
      '玻璃底部轨道',
      '玻璃顶部轨道',
      '端面玻璃',
      '端面玻璃接缝',
      '白色栅格围合区',
      '栅格前方玻璃房入口',
      APPLE_STORE_NAME,
      '店内柔和照明 1',
      '店内柔和照明 2',
    ])
      assert.ok(lab.getObjectByName(name), `${name} is inside the laboratory group`);

    const store = lab.getObjectByName(APPLE_STORE_NAME);
    assert.equal(descendants(store, (object) => object.userData.storeTable === true).length, 2);
    assert.equal(
      descendants(store, (object) => typeof object.userData.device === 'string').length,
      6,
    );
    assert.equal(descendants(store, (object) => object.userData.wallDisplay).length, 2);
    assert.equal(descendants(lab, (object) => object.userData.doorLeaf).length, 2);
    assert.equal(descendants(lab, (object) => object.userData.exteriorLogo === true).length, 2);
    assert.ok(
      model.editableTargets['pavilion.glass'].materials.includes(model.materials['淡绿玻璃']),
    );
    const glassTargets = descendants(
      lab,
      (object) => object.userData.templateTargetId === 'pavilion.glass',
    );
    assert.ok(glassTargets.length > 0, 'editable material target metadata remains on lab glazing');

    model.root.updateMatrixWorld(true);
    const floor = lab.getObjectByName('玻璃房室内地坪');
    const expectedEdgeVertex = bendPoint(
      new THREE.Vector3(GLASS_ROOM.centerX, 0.085, GLASS_ROOM.width / 2),
    );
    const positions = floor.geometry.getAttribute('position');
    let closestFloorVertex = Infinity;
    for (let i = 0; i < positions.count; i++)
      closestFloorVertex = Math.min(
        closestFloorVertex,
        new THREE.Vector3().fromBufferAttribute(positions, i).distanceTo(expectedEdgeVertex),
      );
    assert.ok(closestFloorVertex < 0.03, 'room floor retains its measured bent world position');
    const frontFacade = lab.getObjectByName('玻璃房正面固定玻璃立面');
    const frontPane = frontFacade.getObjectByName('正面固定玻璃');
    assert.ok(frontPane.geometry.attributes.position.count > 0);
    assert.equal(frontFacade.parent, lab);
    assert.equal(frontPane.userData.templateTargetId, 'pavilion.glass');
    assert.equal(model.building.getObjectByName('玻璃房正面固定玻璃立面'), frontFacade);
  } finally {
    dispose(model.root);
  }
});

test('laboratory view hides the exterior, preserves interior visibility, and restores exact prior state', () => {
  const model = createPavilion();
  try {
    const lab = model.laboratory;
    const svgHalo = descendants(lab, (object) => object.name === '织界 LED 柔光')[0];
    const interiorFeature = lab.getObjectByName('店内暖白天花');
    const roof = model.building.getObjectByName('屋面顶板与金属压边');
    assert.ok(svgHalo && interiorFeature && roof);
    svgHalo.visible = false;
    interiorFeature.visible = false;
    roof.visible = false;
    model.landscape.visible = false;
    model.panda.visible = false;
    const before = visibility(model.root);
    const controller = createLaboratoryView(model);

    controller.setActive(true);
    assert.equal(controller.active, true);
    const shown = allVisible(model.root);
    assert.ok(shown.includes('织界实验室'));
    assert.ok(shown.includes(APPLE_STORE_NAME));
    assert.ok(shown.includes('栅格区前方双开玻璃门'));
    assert.ok(shown.includes('玻璃房正面固定玻璃立面'));
    assert.ok(!shown.includes('屋面顶板与金属压边'));
    assert.ok(!shown.some((name) => name.startsWith('前侧 W 形斜柱')));
    assert.ok(!shown.some((name) => name.startsWith('后侧 W 形斜柱')));
    assert.ok(!shown.includes('LoomOS Rooftop Panda'));
    assert.ok(!shown.includes('草坪地面'));
    assert.ok(!shown.includes('廊亭下沥青路面'));
    assert.equal(svgHalo.visible, false, 'SVG-only hidden halo remains hidden inside laboratory');
    assert.equal(interiorFeature.visible, false, 'originally hidden interior children stay hidden');
    assert.equal(
      descendants(lab, (object) => object.userData.exteriorLogo === true).every(
        (object) => !object.visible,
      ),
      true,
      'outside-facing wall marks do not turn inward with the room',
    );

    controller.setActive(true);
    assert.equal(controller.active, true);
    controller.setActive(false);
    assert.equal(controller.active, false);
    assert.deepEqual(
      visibility(model.root),
      before,
      'all controlled visibility values are restored',
    );
    controller.setActive(false);
    assert.deepEqual(visibility(model.root), before, 'repeated exit is idempotent');

    controller.setActive(true);
    controller.dispose();
    assert.equal(controller.active, false);
    assert.deepEqual(visibility(model.root), before, 'dispose exits and restores state');
    controller.dispose();
    assert.deepEqual(visibility(model.root), before, 'repeated dispose does not mutate visibility');
  } finally {
    dispose(model.root);
  }
});

test('laboratory view resolves cloned SVG-compatible roots and does not dispose shared model resources', () => {
  const model = createPavilion();
  const clone = model.root.clone(true);
  try {
    const cloneModel = { root: clone };
    const cloneLab = clone.getObjectByName('织界实验室');
    assert.ok(cloneLab && cloneLab.userData.laboratory);
    const view = createLaboratoryView(cloneModel);
    const sampleGeometry = model.laboratory.getObjectByName('玻璃房室内地坪').geometry;
    let disposeCount = 0;
    sampleGeometry.addEventListener('dispose', () => disposeCount++);
    view.setActive(true);
    assert.equal(clone.getObjectByName('建筑').visible, true);
    assert.equal(cloneLab.visible, true);
    view.dispose();
    assert.equal(disposeCount, 0, 'visibility controller never disposes model resources');
    assert.equal(model.laboratory.visible, true, 'cloned controller does not mutate source model');
    assert.equal(PAVILION.roofBodyTop > GLASS_ROOM.ceilingY, true);
  } finally {
    dispose(model.root);
  }
});
