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
const { APPLE_STORE_NAME, addAppleStoreLighting, createAppleStore } = await import(
  '../web/scene/apple-store.js'
);
const { createPavilion } = await import('../web/scene/model.js');
const { GLASS_ROOM, PAVILION } = await import('../web/scene/pavilion-dimensions.js');
const { bendPoint } = await import('../web/scene/site-layout.js');
const { fallbackPlan } = await import('../web/scene/fallback-rules.js');

test('SVG compatibility omits only the LED alpha-map halo, not the physical wordmark', () => {
  assert.equal(fallbackPlan('织界 LED 柔光').hidden, true);
  assert.equal(fallbackPlan('织界外墙标志').hidden, false);
  for (let i = 0; i < 28; i++)
    assert.equal(fallbackPlan(`zhi-jie-element-${String(i).padStart(2, '0')}`).hidden, false);
});

function storeRoom() {
  return {
    roomX: GLASS_ROOM.storeCenterX,
    roomZ: 0,
    roomW: GLASS_ROOM.storeWidth,
    roomD: GLASS_ROOM.width,
    clearHeight: GLASS_ROOM.clearHeight,
    floorY: GLASS_ROOM.floorY,
  };
}

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

function isInExteriorLogo(object) {
  for (let current = object; current; current = current.parent)
    if (current.userData.exteriorLogo) return true;
  return false;
}

function meshBounds(root, { excludeExteriorLogos = false } = {}) {
  root.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3();
  root.traverse((object) => {
    if (!object.isMesh || (excludeExteriorLogos && isInExteriorLogo(object))) return;
    bounds.expandByObject(object);
  });
  return bounds;
}

function descendants(root, predicate) {
  const matches = [];
  root.traverse((object) => {
    if (predicate(object)) matches.push(object);
  });
  return matches;
}

test('maker laboratory has contained workbench exhibits and locally extruded exterior marks', () => {
  const room = storeRoom();
  const store = createAppleStore(room);
  try {
    assert.equal(store.name, APPLE_STORE_NAME);
    assert.deepEqual(store.userData.room, {
      roomX: room.roomX,
      roomZ: room.roomZ,
      roomW: room.roomW,
      roomD: room.roomD,
    });
    assert.equal(store.userData.clearHeight, GLASS_ROOM.clearHeight);
    assert.equal(store.userData.floorY, GLASS_ROOM.floorY);

    const tables = descendants(store, (object) => object.userData.storeTable === true);
    assert.equal(tables.length, 2, 'two white rectangular lifting tables keep circulation open');
    const productTypes = new Set();
    const tableBounds = [];
    for (const table of tables) {
      assert.equal(table.userData.tableType, 'manual-lifting-table');
      assert.equal(table.userData.liftMechanism, 'screw-lock');
      assert.deepEqual(table.userData.footprint, [2.4, 1.05]);
      assert.equal(table.userData.rigidPlan, true);
      assert.equal(
        descendants(table, (part) => part.userData.tableFoot && !part.userData.floorContact).length,
        2,
      );
      assert.equal(descendants(table, (part) => part.userData.telescopicSegment).length, 8);
      assert.equal(descendants(table, (part) => part.userData.motorHousing).length, 0);
      assert.ok(table.getObjectByName('升降桌面承载组'));
      const tops = descendants(table, (object) => object.userData.tabletop);
      assert.equal(tops.length, 1);
      const topBounds = meshBounds(tops[0]);
      const topSize = topBounds.getSize(new THREE.Vector3());
      assert.ok(Math.abs(topSize.x - 2.4) < 0.001 && Math.abs(topSize.z - 1.05) < 0.001);
      assert.ok(Math.abs(topSize.y - 0.025) < 0.001, 'white top is thin like the reference');
      assert.ok(Math.abs(topBounds.max.y - (room.floorY + 0.82)) < 0.001);
      tableBounds.push(topBounds);
      const devices = descendants(table, (object) => typeof object.userData.device === 'string');
      assert.equal(
        devices.length,
        3,
        `${table.name} keeps three workbench exhibits on its carrier`,
      );
      for (const item of devices) {
        const deviceBounds = meshBounds(item);
        assert.ok(
          Math.abs(deviceBounds.min.y - topBounds.max.y) < 0.001,
          'each exhibit rests on the white tabletop without floating or sinking',
        );
        assert.ok(deviceBounds.max.y < room.floorY + room.clearHeight - 0.1);
        assert.ok(deviceBounds.min.x >= topBounds.min.x && deviceBounds.max.x <= topBounds.max.x);
        assert.ok(deviceBounds.min.z >= topBounds.min.z && deviceBounds.max.z <= topBounds.max.z);
        productTypes.add(item.userData.device);
        assert.ok(
          descendants(item, (object) => object.isMesh).length > 0,
          `${item.name} should contain modeled product meshes`,
        );
      }
    }
    tableBounds.sort((a, b) => a.min.z - b.min.z);
    assert.ok(
      tableBounds[1].min.z - tableBounds[0].max.z >= 1.64,
      'the slimmer tables leave at least 1.64m in the middle aisle',
    );
    const avenueBounds = meshBounds(store.getObjectByName('后墙产品陈列区'));
    assert.ok(
      tableBounds[0].min.z - avenueBounds.max.z >= 1.07,
      'rear display remains approachable',
    );
    assert.ok(
      room.roomZ + room.roomD / 2 - tableBounds[1].max.z >= 1.32,
      'front glass has a clear aisle',
    );
    assert.deepEqual(
      productTypes,
      new Set(['brick-robot-dog', 'development-board', 'tool-kit', 'quadcopter']),
      'workbenches show robotics, electronics, drones and tools rather than retail devices',
    );
    assert.equal(
      descendants(store, (object) => /iPhone|MacBook|iPad|主屏手机|主屏平板/.test(object.name))
        .length,
      0,
      'neither the desks nor the project screen retains Apple-device geometry',
    );
    assert.ok(store.getObjectByName('主屏实验室项目示意'));

    const floor = store.getObjectByName('店内浅灰石材地面');
    const stoneTiles = descendants(
      floor,
      (object) => object.isMesh && object.name === '大规格石材地板',
    );
    assert.ok(stoneTiles.length >= 4, 'stone finish is modeled as visible floor slabs');
    assert.ok(stoneTiles.every((tile) => tile.material.name.includes('浅灰石材')));

    const ceiling = store.getObjectByName('木质声学天花与柔光灯');
    assert.ok(ceiling);
    assert.ok(descendants(ceiling, (object) => object.name === '橡木声学顶条').length > 4);
    assert.ok(descendants(ceiling, (object) => object.name === '嵌入式柔光灯').length >= 2);

    const avenue = store.getObjectByName('后墙产品陈列区');
    assert.ok(avenue);
    assert.equal(descendants(avenue, (object) => object.name === '配件陈列样品').length, 0);
    assert.ok(avenue.getObjectByName('主展示屏画面'));
    assert.ok(avenue.getObjectByName('橡木储物柜'));
    const wallDisplays = descendants(avenue, (object) => !!object.userData.wallDisplay);
    assert.equal(wallDisplays.length, 2);
    const pegboard = avenue.getObjectByName('洞洞板工具墙');
    const brickBoard = avenue.getObjectByName('乐高积木墙');
    assert.ok(pegboard && brickBoard);
    assert.equal(pegboard.userData.wallDisplay, 'tool-pegboard');
    assert.equal(brickBoard.userData.wallDisplay, 'brick-board');
    assert.equal(pegboard.position.x, -1.95);
    assert.equal(brickBoard.position.x, 1.95);
    for (const panel of wallDisplays) {
      assert.equal(panel.userData.rigidPlan, true);
      const panelBounds = meshBounds(panel);
      assert.ok(panelBounds.min.y >= room.floorY + 0.7, 'wall panels clear the cabinet below');
      assert.ok(panelBounds.max.y <= room.floorY + room.clearHeight);
      assert.ok(panelBounds.max.z <= avenueBounds.max.z + 0.001);
      for (const tableBoundsItem of tableBounds)
        assert.equal(panelBounds.intersectsBox(tableBoundsItem), false);
    }
    const tools = descendants(pegboard, (object) => object.userData.wallTool);
    assert.ok(new Set(tools.map((tool) => tool.userData.toolType)).size >= 5);
    assert.ok(descendants(pegboard, (object) => object.userData.pegHook).length >= tools.length);
    assert.equal(descendants(brickBoard, (object) => object.userData.brickBaseplate).length, 1);
    assert.ok(descendants(brickBoard, (object) => object.userData.brickPiece).length >= 10);
    const lounge = store.getObjectByName('玻璃端景休息区');
    assert.ok(lounge?.getObjectByName('橡木端景长凳'));
    assert.ok(lounge?.getObjectByName('浅灰长凳坐垫'));

    const logos = descendants(store, (object) => object.userData.exteriorLogo === true);
    assert.equal(logos.length, 2, 'outside glass walls carry two physical Zhi Jie marks');
    for (const logo of logos) {
      assert.equal(logo.userData.brand, '织界');
      assert.equal(logo.userData.logoSource, 'assets/zhi-jie-logo.svg');
      const marks = descendants(logo, (object) => object.isMesh && !object.userData.ledHalo);
      assert.ok(marks.length > 1, 'complete symbol and Chinese wordmark are modeled');
      assert.ok(marks.every((mark) => mark.geometry.getAttribute('position').count > 0));
      assert.ok(
        marks.every((mark) => !mark.material.map),
        'logo uses native vector geometry',
      );
      assert.ok(
        marks.every((mark) => mark.material.emissiveIntensity > 0),
        'logo is illuminated',
      );
      const halos = descendants(logo, (object) => object.userData.ledHalo);
      assert.equal(halos.length, 1, 'each LED sign has one soft local glow');
      assert.equal(halos[0].material.depthWrite, false);
    }
    assert.equal(
      descendants(store, (object) => /Apple.*标志|Apple.*轮廓/.test(object.name)).length,
      0,
    );

    const bounds = meshBounds(store, { excludeExteriorLogos: true });
    const epsilon = 0.02;
    assert.ok(bounds.min.x >= room.roomX - room.roomW / 2 - epsilon);
    assert.ok(bounds.max.x <= room.roomX + room.roomW / 2 + epsilon);
    assert.ok(bounds.min.z >= room.roomZ - room.roomD / 2 - epsilon);
    assert.ok(bounds.max.z <= room.roomZ + room.roomD / 2 + epsilon);
  } finally {
    dispose(store);
  }
});

test('separate Apple Store instances own disposable geometry, materials, and textures', () => {
  const room = storeRoom();
  const first = createAppleStore(room);
  const second = createAppleStore(room);
  try {
    const firstResources = resources(first);
    const secondResources = resources(second);
    for (const kind of ['geometries', 'materials', 'textures']) {
      assert.ok(firstResources[kind].size > 0, `${kind} are owned by each instance`);
      for (const resource of firstResources[kind])
        assert.equal(secondResources[kind].has(resource), false, `${kind} must not be shared`);
    }

    const secondDisposals = new Map();
    for (const kind of ['geometries', 'materials', 'textures'])
      for (const resource of secondResources[kind]) {
        secondDisposals.set(resource, 0);
        resource.addEventListener('dispose', () =>
          secondDisposals.set(resource, secondDisposals.get(resource) + 1),
        );
      }
    dispose(first);
    assert.ok(
      [...secondDisposals.values()].every((count) => count === 0),
      'disposing one store must not dispose the other instance resources',
    );
  } finally {
    dispose(first);
    dispose(second);
  }
});

test('Apple Store requires finite room dimensions of at least five by six metres and 2.4m clear', () => {
  const room = storeRoom();
  for (const patch of [
    { roomX: Number.NaN },
    { roomZ: Number.POSITIVE_INFINITY },
    { roomW: 4.99 },
    { roomD: 5.99 },
    { clearHeight: 2.39 },
    { floorY: Number.NaN },
  ]) {
    assert.throws(
      () => createAppleStore({ ...room, ...patch }),
      /finite room at least five metres wide, six deep and 2.4 high/,
    );
  }
});

test('integrated store stays clear of the closed louver volume and preserves the glass entrance and rooftop panda', () => {
  const model = createPavilion();
  try {
    model.root.updateMatrixWorld(true);
    const store = model.building.getObjectByName(APPLE_STORE_NAME);
    assert.ok(store, 'store is attached to the bent building');
    const liftedTables = descendants(store, (object) => object.userData.storeTable);
    assert.equal(liftedTables.length, 2);
    for (const table of liftedTables) {
      const top = descendants(table, (object) => object.userData.tabletop)[0];
      assert.ok(top);
      const inTable = new THREE.Matrix4()
        .copy(table.matrixWorld)
        .invert()
        .multiply(top.matrixWorld);
      const bounds = new THREE.Box3();
      const vertices = top.geometry.getAttribute('position');
      for (let i = 0; i < vertices.count; i++)
        bounds.expandByPoint(
          new THREE.Vector3().fromBufferAttribute(vertices, i).applyMatrix4(inTable),
        );
      const size = bounds.getSize(new THREE.Vector3());
      assert.ok(
        Math.abs(size.x - 2.4) < 0.001 && Math.abs(size.z - 1.05) < 0.001,
        'rectangular furniture keeps its real dimensions after the building bends',
      );
      assert.ok(
        Math.abs(meshBounds(table).min.y - GLASS_ROOM.floorY) < 0.002,
        'the lifting-table feet rest on the finished floor',
      );
    }
    const wallDisplays = descendants(store, (object) => !!object.userData.wallDisplay);
    assert.equal(wallDisplays.length, 2);
    for (const panel of wallDisplays) {
      assert.equal(panel.userData.rigidPlan, true);
      const inverse = new THREE.Matrix4().copy(panel.matrixWorld).invert();
      const localBounds = new THREE.Box3();
      for (const mesh of descendants(panel, (object) => object.isMesh)) {
        const transform = new THREE.Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
        const vertices = mesh.geometry.getAttribute('position');
        for (let i = 0; i < vertices.count; i++)
          localBounds.expandByPoint(
            new THREE.Vector3().fromBufferAttribute(vertices, i).applyMatrix4(transform),
          );
      }
      const size = localBounds.getSize(new THREE.Vector3());
      assert.ok(size.x <= 1.151 && size.y <= 1.481 && size.z <= 0.291);
      assert.ok(size.x > 1 && size.y > 1.3, 'wall displays preserve their full rigid panel size');
    }
    const enclosure = model.building.getObjectByName('栅格区封闭内体');
    const doubleDoor = model.building.getObjectByName('栅格区前方双开玻璃门');
    assert.ok(enclosure && doubleDoor);
    const enclosureBounds = new THREE.Box3().setFromObject(enclosure);
    const doorBounds = new THREE.Box3().setFromObject(doubleDoor);
    const occupants = [
      ...descendants(store, (object) => object.userData.storeTable === true),
      store.getObjectByName('后墙产品陈列区'),
      store.getObjectByName('玻璃端景休息区'),
      store.getObjectByName('室内端景绿植'),
    ];
    assert.ok(occupants.every(Boolean));
    for (const occupant of occupants) {
      const bounds = new THREE.Box3().setFromObject(occupant);
      assert.equal(
        bounds.intersectsBox(enclosureBounds),
        false,
        `${occupant.name} must not invade the opaque closed louver volume`,
      );
      assert.equal(
        bounds.intersectsBox(doorBounds),
        false,
        `${occupant.name} must not block the existing double-door approach`,
      );
    }

    const doorLeaves = descendants(doubleDoor, (object) => object.userData.doorLeaf === true);
    assert.equal(doorLeaves.length, 2);
    assert.deepEqual(
      new Set(doorLeaves.map((door) => door.name)),
      new Set(['双开玻璃门左扇', '双开玻璃门右扇']),
    );
    const facade = model.building.getObjectByName('玻璃房正面固定玻璃立面');
    assert.ok(facade);
    const facadeNames = descendants(facade, () => true).map((object) => object.name);
    assert.ok(facadeNames.includes('正面固定玻璃'));
    assert.ok(facadeNames.every((name) => !/门|拉手|铰链/.test(name)));
    assert.equal(model.materials['淡绿玻璃'].transparent, true);
    assert.ok(model.materials['淡绿玻璃'].opacity <= 0.15);

    const sign = store.getObjectByName('正面玻璃外墙织界标志');
    assert.ok(sign);
    const members = descendants(
      model.building,
      (object) => object.userData.structuralModule && object.userData.side === 1,
    );
    const signX = PAVILION.moduleStartX + PAVILION.archSpan / 2;
    const outward = bendPoint(new THREE.Vector3(signX, 0, 1))
      .sub(bendPoint(new THREE.Vector3(signX, 0, 0)))
      .normalize();
    const ray = new THREE.Raycaster();
    ray.far = 1;
    let occludedVertices = 0;
    for (const mesh of descendants(sign, (object) => object.isMesh && !object.userData.ledHalo)) {
      const vertices = mesh.geometry.getAttribute('position');
      for (let i = 0; i < vertices.count; i++) {
        const vertex = new THREE.Vector3()
          .fromBufferAttribute(vertices, i)
          .applyMatrix4(mesh.matrixWorld);
        ray.set(vertex, outward);
        if (ray.intersectObjects(members, false).length) occludedVertices++;
      }
    }
    assert.equal(occludedVertices, 0, 'the complete wordmark clears the white facade diagonals');

    const pandas = descendants(
      model.root,
      (object) => object.userData.rooftopPose || object.name === 'LoomOS Panda',
    );
    assert.equal(pandas.length, 1);
    assert.equal(pandas[0], model.panda);
    assert.equal(pandas[0].name, 'LoomOS Rooftop Panda');

    const storeLights = descendants(
      model.building,
      (object) => object.isPointLight && object.name.startsWith('店内柔和照明 '),
    );
    assert.equal(storeLights.length, 2);
    assert.ok(storeLights.every((light) => light.castShadow === false));

    addAppleStoreLighting(model.building);
    addAppleStoreLighting(model.building);
    const lightsAfterRepeatedCalls = descendants(
      model.building,
      (object) => object.isPointLight && object.name.startsWith('店内柔和照明 '),
    );
    assert.equal(lightsAfterRepeatedCalls.length, storeLights.length);
    assert.ok(lightsAfterRepeatedCalls.every((light) => light.castShadow === false));
  } finally {
    dispose(model.root);
  }
});
