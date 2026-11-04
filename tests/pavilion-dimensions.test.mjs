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
const { GLASS_ROOM, PAVILION, LOUVER, ENTRANCE } = await import(
  '../web/scene/pavilion-dimensions.js'
);
const { SITE, mapPoint, bendPoint } = await import('../web/scene/site-layout.js');

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

function meshVertices(mesh) {
  mesh.updateWorldMatrix(true, false);
  const position = mesh.geometry.getAttribute('position');
  const vertices = [];
  for (let i = 0; i < position.count; i++)
    vertices.push(
      new THREE.Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld),
    );
  return vertices;
}

function meshBounds(mesh) {
  const bounds = new THREE.Box3();
  for (const point of meshVertices(mesh)) bounds.expandByPoint(point);
  return bounds;
}

function subtreeVertices(root) {
  const vertices = [];
  root.traverse((object) => {
    if (object.isMesh) vertices.push(...meshVertices(object));
  });
  return vertices;
}

const arcAnchor = mapPoint(...SITE.canopyCurvePixels[0]);
const arcTangent = mapPoint(...SITE.canopyCurvePixels[1])
  .sub(arcAnchor)
  .normalize();
const arcNormal = new THREE.Vector3(-arcTangent.z, 0, arcTangent.x);
const arcCenter = arcAnchor.clone().addScaledVector(arcNormal, -GLASS_ROOM.centerRadius);

function canonicalPlan(point) {
  const delta = point.clone().setY(0).sub(arcCenter);
  const along = delta.dot(arcTangent);
  const across = delta.dot(arcNormal);
  const radius = Math.hypot(along, across);
  return {
    x: PAVILION.startX + Math.atan2(along, across) * GLASS_ROOM.centerRadius,
    z: radius - GLASS_ROOM.centerRadius,
  };
}

function projectedExtent(points, axis) {
  const projections = points.map((point) => point.dot(axis));
  return Math.max(...projections) - Math.min(...projections);
}

function pointMean(points) {
  return points
    .reduce((mean, point) => mean.add(point), new THREE.Vector3())
    .divideScalar(points.length);
}

function subtreeBounds(object) {
  object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(object);
}

function pointKey(point) {
  return point
    .toArray()
    .map((value) => Math.round(value * 100000))
    .join(',');
}

function floorBoundary(mesh) {
  const vertices = meshVertices(mesh);
  const position = mesh.geometry.getAttribute('position');
  const index = mesh.geometry.index;
  const vertexAt = (triangle, corner) =>
    vertices[index ? index.getX(triangle * 3 + corner) : triangle * 3 + corner];
  const topY = Math.max(...vertices.map((point) => point.y));
  const topEdges = new Map();
  const points = new Map();
  const triangleCount = (index?.count ?? position.count) / 3;
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const face = [vertexAt(triangle, 0), vertexAt(triangle, 1), vertexAt(triangle, 2)];
    if (!face.every((point) => Math.abs(point.y - topY) < 1e-4)) continue;
    for (let corner = 0; corner < 3; corner++) {
      const a = face[corner];
      const b = face[(corner + 1) % 3];
      const aKey = pointKey(a);
      const bKey = pointKey(b);
      points.set(aKey, a);
      points.set(bKey, b);
      const key = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
      topEdges.set(key, (topEdges.get(key) || 0) + 1);
    }
  }

  const boundaryEdges = [...topEdges]
    .filter(([, count]) => count === 1)
    .map(([key]) => key.split('|'));
  const adjacency = new Map();
  for (const [a, b] of boundaryEdges) {
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a).push(b);
    adjacency.get(b).push(a);
  }
  assert.ok(adjacency.size > 8, 'the structural floor top has a sampled boundary');
  assert.ok(
    [...adjacency.values()].every((neighbors) => neighbors.length === 2),
    'the top-surface boundary is one closed, unbranched mesh contour',
  );

  const start = adjacency.keys().next().value;
  const path = [start];
  let previous = null;
  let current = start;
  for (let step = 0; step <= adjacency.size; step++) {
    const next = adjacency.get(current).find((key) => key !== previous);
    assert.ok(next, 'boundary contour remains connected');
    if (next === start) break;
    path.push(next);
    previous = current;
    current = next;
  }
  assert.ok(path.length === adjacency.size, 'all top boundary vertices belong to the contour');

  const contour = path.map((key) => points.get(key));
  const lengths = contour.map((point, index) =>
    point.distanceTo(contour[(index + 1) % contour.length]),
  );
  return { topY, contour, lengths };
}

function circleThrough(a, b, c) {
  const [ax, az] = [a.x, a.z];
  const [bx, bz] = [b.x, b.z];
  const [cx, cz] = [c.x, c.z];
  const determinant = 2 * (ax * (bz - cz) + bx * (cz - az) + cx * (az - bz));
  assert.ok(Math.abs(determinant) > 1e-8, 'arc samples define a measurable circle');
  const a2 = ax * ax + az * az;
  const b2 = bx * bx + bz * bz;
  const c2 = cx * cx + cz * cz;
  const x = (a2 * (bz - cz) + b2 * (cz - az) + c2 * (az - bz)) / determinant;
  const z = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / determinant;
  return { center: new THREE.Vector2(x, z), radius: Math.hypot(x - ax, z - az) };
}

function arcSections({ contour, lengths }) {
  const crossEdges = lengths
    .map((length, index) => ({ length, index }))
    .filter(({ length }) => length > GLASS_ROOM.width * 0.8);
  assert.equal(crossEdges.length, 2, 'the floor has two cross-room sides and two curved sides');
  for (const { length } of crossEdges)
    assert.ok(Math.abs(length - GLASS_ROOM.width) < 0.02, `measured room width: ${length}`);

  return crossEdges.map(({ index: start }) => {
    let edgeIndex = (start + 1) % lengths.length;
    const points = [contour[edgeIndex]];
    let length = 0;
    while (lengths[edgeIndex] <= GLASS_ROOM.width * 0.8) {
      length += lengths[edgeIndex];
      edgeIndex = (edgeIndex + 1) % lengths.length;
      points.push(contour[edgeIndex]);
      if (points.length > contour.length) assert.fail('arc traversal did not reach the next end');
    }
    assert.ok(Math.abs(lengths[edgeIndex] - GLASS_ROOM.width) < 0.02);
    const circle = circleThrough(points[0], points[Math.floor(points.length / 2)], points.at(-1));
    return { length, points, circle };
  });
}

function boundsY(object) {
  return subtreeBounds(object);
}

test('measured glass-room floor mesh has 7m width and 7.6m/6.5m concentric boundary arcs', () => {
  assert.equal(GLASS_ROOM.pandaSideLength, 7.6);
  assert.equal(GLASS_ROOM.oppositeSideLength, 6.5);
  assert.equal(GLASS_ROOM.width, 7);
  const model = createPavilion();
  try {
    model.root.updateMatrixWorld(true);
    const floor = model.building.getObjectByName('玻璃房室内地坪');
    assert.ok(floor);
    const { topY, contour, lengths } = floorBoundary(floor);
    const arcs = arcSections({ contour, lengths });
    const byRadius = [...arcs].sort((a, b) => a.circle.radius - b.circle.radius);
    assert.ok(Math.abs(topY - 0.085) < 0.002, `structural floor top is measured at ${topY}`);
    assert.ok(Math.abs(byRadius[0].length - GLASS_ROOM.oppositeSideLength) < 0.025);
    assert.ok(Math.abs(byRadius[1].length - GLASS_ROOM.pandaSideLength) < 0.025);
    assert.ok(
      Math.abs((byRadius[0].length + byRadius[1].length) / 2 - GLASS_ROOM.centerlineLength) < 0.025,
      'the measured footprint includes the entrance and does not append another entry length',
    );
    assert.ok(Math.abs(byRadius[0].circle.center.distanceTo(byRadius[1].circle.center)) < 0.04);
    assert.ok(
      Math.abs(byRadius[1].circle.radius - byRadius[0].circle.radius - GLASS_ROOM.width) < 0.04,
    );
    assert.ok(
      Math.abs((byRadius[1].length - byRadius[0].length) / GLASS_ROOM.width - GLASS_ROOM.angle) <
        0.006,
      'measured arc-length differential agrees with the concentric curve angle',
    );
    assert.equal(model.building.userData.glassRoom.interpretation, 'concentric-internal-arcs');
  } finally {
    dispose(model.root);
  }
});

test('finished stone floor, low fixtures, ceiling and roof meshes preserve measured clear height and layering', () => {
  const model = createPavilion();
  try {
    model.root.updateMatrixWorld(true);
    const store = model.building.getObjectByName('玻璃房 · 织界创客实验室');
    const tiles = [];
    store.traverse((object) => {
      if (object.isMesh && object.name === '大规格石材地板') tiles.push(object);
    });
    const entryStone = model.building.getObjectByName('入口浅灰石材地面');
    const entryCeiling = model.building.getObjectByName('入口完成吊顶');
    assert.ok(tiles.length > 20 && entryStone && entryCeiling);
    const finishedFloorY = Math.max(
      ...tiles.map((tile) => meshBounds(tile).max.y),
      meshBounds(entryStone).max.y,
    );
    assert.ok(Math.abs(finishedFloorY - GLASS_ROOM.floorY) < 0.002);
    const entryFloorBounds = meshBounds(entryStone);
    const entryCeilingBounds = meshBounds(entryCeiling);
    assert.ok(
      Math.abs(entryCeilingBounds.min.y - entryFloorBounds.max.y - GLASS_ROOM.clearHeight) < 0.002,
    );

    const ceiling = store.getObjectByName('木质声学天花与柔光灯');
    const ceilingParts = [];
    ceiling.traverse((object) => {
      if (object.isMesh && ['嵌入式柔光灯', '橡木声学顶条', '店内暖白天花'].includes(object.name))
        ceilingParts.push({ object, bounds: meshBounds(object) });
    });
    assert.ok(ceilingParts.length > 4);
    const lowestCeilingY = Math.min(...ceilingParts.map(({ bounds }) => bounds.min.y));
    const highestCeilingY = Math.max(...ceilingParts.map(({ bounds }) => bounds.max.y));
    assert.ok(Math.abs(lowestCeilingY - finishedFloorY - GLASS_ROOM.clearHeight) < 0.01);

    const roofBody = model.building.getObjectByName('弧形屋面与白色檐口');
    const roofCap = model.building.getObjectByName('屋面顶板与金属压边');
    assert.ok(roofBody && roofCap);
    const roofBodyBounds = meshBounds(roofBody);
    const roofCapBounds = meshBounds(roofCap);
    assert.ok(entryCeilingBounds.max.y <= roofBodyBounds.min.y);
    assert.ok(roofBodyBounds.min.y > highestCeilingY);
    assert.ok(Math.abs(roofBodyBounds.min.y - PAVILION.soffitY) < 0.01);
    assert.ok(Math.abs(roofBodyBounds.max.y - PAVILION.roofBodyTop) < 0.01);
    assert.ok(Math.abs(roofCapBounds.max.y - PAVILION.roofTop) < 0.002);
    assert.ok(Math.abs(roofCapBounds.max.y - roofBodyBounds.min.y - 0.7) < 0.002);
    assert.ok(roofCapBounds.max.y > roofBodyBounds.max.y);
    const roofBodyPlan = meshVertices(roofBody).map(canonicalPlan);
    const roofCapPlan = meshVertices(roofCap).map(canonicalPlan);
    for (const axis of ['x', 'z']) {
      const bodyMin = Math.min(...roofBodyPlan.map((point) => point[axis]));
      const bodyMax = Math.max(...roofBodyPlan.map((point) => point[axis]));
      const capMin = Math.min(...roofCapPlan.map((point) => point[axis]));
      const capMax = Math.max(...roofCapPlan.map((point) => point[axis]));
      assert.ok(Math.abs(capMin - bodyMin) < 0.01 && Math.abs(capMax - bodyMax) < 0.01);
    }
  } finally {
    dispose(model.root);
  }
});

test('in-store furniture remains below the real low ceiling and outside the double-door opening', () => {
  const model = createPavilion();
  try {
    model.root.updateMatrixWorld(true);
    const store = model.building.getObjectByName('玻璃房 · 织界创客实验室');
    const door = model.building.getObjectByName('栅格区前方双开玻璃门');
    assert.ok(store && door);
    const doorBounds = subtreeBounds(door);
    const ceiling = store.getObjectByName('木质声学天花与柔光灯');
    const lowCeilingY = [];
    ceiling.traverse((object) => {
      if (object.isMesh && ['嵌入式柔光灯', '橡木声学顶条'].includes(object.name))
        lowCeilingY.push(meshBounds(object).min.y);
    });
    const lowestFixtureY = Math.min(...lowCeilingY);
    const furniture = [
      ...store.children.filter((object) => object.userData.storeTable === true),
      store.getObjectByName('玻璃端景休息区'),
      store.getObjectByName('室内端景绿植'),
    ];
    assert.ok(furniture.every(Boolean));
    for (const object of furniture) {
      const bounds = boundsY(object);
      assert.ok(
        bounds.max.y < lowestFixtureY - 0.1,
        `${object.name} should remain below the low ceiling/lights, got ${bounds.max.y}`,
      );
      assert.equal(
        bounds.intersectsBox(doorBounds),
        false,
        `${object.name} must not intrude into the double-door opening`,
      );
    }

    const avenue = store.getObjectByName('后墙产品陈列区');
    const wall = avenue.getObjectByName('暖白陈列背景墙');
    assert.ok(meshBounds(wall).max.y <= GLASS_ROOM.floorY + GLASS_ROOM.clearHeight + 0.002);
    const products = [];
    avenue.traverse((object) => {
      if (object.isMesh && object.name !== '暖白陈列背景墙') products.push(object);
    });
    assert.ok(products.every((object) => meshBounds(object).max.y < lowestFixtureY));
  } finally {
    dispose(model.root);
  }
});

test('rigid louver geometry measures 2.2m by 1.6m and every vertex stays inside the glass-room sector', () => {
  assert.equal(LOUVER.width, 2.2);
  assert.equal(LOUVER.depth, 1.6);
  const model = createPavilion();
  try {
    model.root.updateMatrixWorld(true);
    const louver = model.building.getObjectByName('白色栅格围合区');
    assert.ok(louver);
    const vertices = subtreeVertices(louver);
    assert.ok(vertices.length > 100);
    const localVertices = vertices.map((point) => louver.worldToLocal(point.clone()));
    const localX = localVertices.map((point) => point.x);
    const localZ = localVertices.map((point) => point.z);
    const localDepth = Math.max(...localX) - Math.min(...localX);
    const localWidth = Math.max(...localZ) - Math.min(...localZ);
    assert.ok(Math.abs(localDepth - LOUVER.depth) < 0.002, `measured rigid depth: ${localDepth}`);
    assert.ok(Math.abs(localWidth - LOUVER.width) < 0.002, `measured rigid width: ${localWidth}`);

    const canonical = vertices.map(canonicalPlan);

    const sectorTolerance = 0.002;
    for (const point of canonical) {
      assert.ok(
        point.x >= GLASS_ROOM.startX - sectorTolerance &&
          point.x <= GLASS_ROOM.endX + sectorTolerance,
        `louver vertex must remain within measured arc length: ${point.x}`,
      );
      assert.ok(
        point.z >= -GLASS_ROOM.width / 2 - sectorTolerance &&
          point.z <= GLASS_ROOM.width / 2 + sectorTolerance,
        `louver vertex must remain within measured radial walls: ${point.z}`,
      );
    }
  } finally {
    dispose(model.root);
  }
});

test('public double-door opening measures 1.6m clear with 1.6m adjacent glazing on each side', () => {
  assert.equal(ENTRANCE.clearWidth, 1.6);
  const model = createPavilion();
  try {
    model.root.updateMatrixWorld(true);
    const entrance = model.building.getObjectByName('栅格前方玻璃房入口');
    const doors = model.building.getObjectByName('栅格区前方双开玻璃门');
    assert.ok(entrance && doors);
    const jambs = [];
    const outerFrames = [];
    doors.traverse((object) => {
      if (object.name === '门洞竖向门框') jambs.push(object);
      if (object.name === '玻璃入口外框') outerFrames.push(object);
    });
    assert.equal(jambs.length, 2);
    assert.equal(outerFrames.length, 2);
    const jambPoints = jambs.map((jamb) => meshVertices(jamb));
    const jambCenters = jambPoints.map(pointMean);
    const openingAxis = jambCenters[1].clone().sub(jambCenters[0]).normalize();
    const jambIntervals = jambPoints
      .map((points) => {
        const distances = points.map((point) => point.dot(openingAxis));
        return { min: Math.min(...distances), max: Math.max(...distances) };
      })
      .sort((a, b) => a.min - b.min);
    const frameSpacing = jambCenters[0].distanceTo(jambCenters[1]);
    const clearOpening = jambIntervals[1].min - jambIntervals[0].max;
    assert.ok(
      Math.abs(
        projectedExtent(jambPoints.flat(), openingAxis) - frameSpacing - ENTRANCE.jambWidth,
      ) < 0.005,
    );
    assert.ok(Math.abs(frameSpacing - ENTRANCE.clearWidth - ENTRANCE.jambWidth) < 0.005);
    assert.ok(
      Math.abs(clearOpening - ENTRANCE.clearWidth) < 0.005,
      `measured clear opening: ${clearOpening}`,
    );
    const frameCenters = outerFrames.map((frame) => pointMean(meshVertices(frame)));
    for (const frameCenter of frameCenters) {
      const nearestJamb = Math.min(...jambCenters.map((center) => center.distanceTo(frameCenter)));
      assert.ok(
        Math.abs(nearestJamb - ENTRANCE.oppositeOffset) < 0.025,
        `measured jamb-to-outer-frame spacing: ${nearestJamb}`,
      );
    }

    const fixedGlass = [];
    entrance.traverse((object) => {
      if (object.name === '门侧固定玻璃') fixedGlass.push(object);
    });
    assert.equal(fixedGlass.length, 2);
    for (const pane of fixedGlass) {
      const panePoints = meshVertices(pane);
      const center = pointMean(panePoints);
      const nearestJamb = Math.min(...jambCenters.map((jamb) => jamb.distanceTo(center)));
      assert.ok(Math.abs(nearestJamb - ENTRANCE.oppositeOffset / 2) < 0.04);
      const paneClearWidth = projectedExtent(panePoints, openingAxis);
      assert.ok(
        Math.abs(paneClearWidth - (ENTRANCE.oppositeOffset - 0.05)) < 0.04,
        `measured adjacent fixed-glass segment: ${paneClearWidth}`,
      );
    }
    const leaves = [];
    doors.traverse((object) => {
      if (object.userData.doorLeaf) leaves.push(object);
    });
    assert.equal(leaves.length, 2);
    const fixedFacade = model.building.getObjectByName('玻璃房正面固定玻璃立面');
    assert.ok(fixedFacade);
    const facadeHardware = [];
    fixedFacade.traverse((object) => facadeHardware.push(object.name));
    assert.ok(facadeHardware.every((name) => !/门|拉手|铰链/.test(name)));
  } finally {
    dispose(model.root);
  }
});

test('roof arc meshes measure the stated chord and arc length and contain the triangular facade tips', () => {
  assert.equal(PAVILION.chordLength, 30);
  assert.equal(PAVILION.triangleClearBase, 4);
  assert.equal(PAVILION.columnFootWidth, 0.48);
  assert.equal(PAVILION.triangleCount, 5.5);
  const model = createPavilion();
  try {
    model.root.updateMatrixWorld(true);
    const roof = model.building.getObjectByName('弧形屋面与白色檐口');
    const cap = model.building.getObjectByName('屋面顶板与金属压边');
    assert.ok(roof && cap);
    const roofTopVertices = meshVertices(roof).filter(
      (point) => Math.abs(point.y - PAVILION.roofBodyTop) < 1e-4,
    );
    assert.ok(roofTopVertices.length > 1000, 'actual roof top mesh supplies sampled vertices');
    const raycaster = new THREE.Raycaster();
    const centerlineHits = [];
    for (let index = 0; index <= 120; index++) {
      const distance = 0.01 + ((PAVILION.length - 0.02) * index) / 120;
      const origin = bendPoint(
        new THREE.Vector3(PAVILION.startX + distance, PAVILION.roofTop + 0.2, 0),
      );
      raycaster.set(origin, new THREE.Vector3(0, -1, 0));
      raycaster.far = 1;
      const hit = raycaster.intersectObject(roof, false)[0];
      assert.ok(hit, `roof mesh covers centreline station ${distance.toFixed(3)}m`);
      centerlineHits.push(hit.point);
    }
    const measuredChord = centerlineHits[0].distanceTo(centerlineHits.at(-1));
    const sampledArc = centerlineHits
      .slice(1)
      .reduce((sum, point, index) => sum + point.distanceTo(centerlineHits[index]), 0);
    assert.ok(
      Math.abs(measuredChord - PAVILION.chordLength) < 0.02,
      `measured roof chord: ${measuredChord}`,
    );
    assert.ok(Math.abs(sampledArc - PAVILION.length) < 0.025, `measured roof arc: ${sampledArc}`);

    const modules = [];
    model.building.traverse((object) => {
      if (object.isMesh && object.userData.structuralModule) modules.push(object);
    });
    assert.equal(modules.length, 12);
    const capBounds = meshBounds(cap);
    const roofBodyBounds = meshBounds(roof);
    const roofPlan = meshVertices(roof).map(canonicalPlan);
    const roofStartX = Math.min(...roofPlan.map(({ x }) => x));
    const roofEndX = Math.max(...roofPlan.map(({ x }) => x));
    assert.ok(Math.abs(roofStartX - PAVILION.startX) < 0.01);
    assert.ok(Math.abs(roofEndX - PAVILION.endX) < 0.01);
    const roomFloor = model.building.getObjectByName('玻璃房室内地坪');
    assert.ok(roomFloor);
    const roomPlan = meshVertices(roomFloor).map(canonicalPlan);
    const roomStartX = Math.min(...roomPlan.map(({ x }) => x));
    const roomEndX = Math.max(...roomPlan.map(({ x }) => x));
    const roofRay = new THREE.Raycaster();
    const moduleIntervals = new Map();
    for (const side of [-1, 1]) {
      const sideModules = modules
        .filter((object) => object.userData.side === side)
        .sort((a, b) => a.userData.index - b.userData.index);
      assert.equal(sideModules.length, 6);
      assert.deepEqual(
        sideModules.map((object) => object.userData.fraction),
        [1, 1, 1, 1, 1, 0.5],
      );
      const intervals = [];
      for (const module of sideModules) {
        const worldVertices = meshVertices(module);
        const modulePlan = worldVertices.map(canonicalPlan);
        const moduleMinX = Math.min(...modulePlan.map(({ x }) => x));
        const moduleMaxX = Math.max(...modulePlan.map(({ x }) => x));
        const expectedSpan = PAVILION.archSpan * module.userData.fraction;
        assert.ok(Math.abs(moduleMaxX - moduleMinX - expectedSpan) < 0.015);
        const baseVertices = worldVertices
          .map((point) => ({ point, plan: canonicalPlan(point) }))
          .filter(
            ({ point, plan }) =>
              Math.abs(point.y - 0.04) < 1e-4 &&
              Math.abs(plan.z - side * (PAVILION.columnOffset + PAVILION.columnDepth / 2)) < 0.006,
          );
        assert.ok(
          baseVertices.length > 0,
          `module ${side}/${module.userData.index} has a measurable outer foot edge`,
        );
        const minX = Math.min(...baseVertices.map(({ plan }) => plan.x));
        const maxX = Math.max(...baseVertices.map(({ plan }) => plan.x));
        const isFullModule = module.userData.fraction === 1;
        const expectedBaseSpan = isFullModule ? PAVILION.archSpan : PAVILION.columnFootWidth;
        assert.ok(Math.abs(maxX - minX - expectedBaseSpan) < 0.015);
        const baseStations = [
          ...new Set(baseVertices.map(({ plan }) => Math.round(plan.x * 100000))),
        ]
          .map((x) => x / 100000)
          .sort((a, b) => a - b);
        if (!isFullModule) {
          assert.ok(
            baseStations.length >= 2 && baseStations.length < 4,
            'half module has only the two endpoints of one short foot',
          );
        } else {
          assert.ok(
            baseStations.length >= 4,
            'full module mesh exposes both inner foot edges and both outside ends',
          );
        }
        const endpointMean = (edgeX) => {
          const edgePoints = baseVertices
            .filter(({ plan }) => Math.abs(plan.x - edgeX) < 1e-4)
            .map(({ point }) => point);
          assert.ok(edgePoints.length > 0, 'each exposed foot end is represented by mesh vertices');
          return pointMean(edgePoints);
        };
        const endpoints = [endpointMean(minX), endpointMean(maxX)];
        const outerChord = endpoints[0].distanceTo(endpoints[1]);
        const clearChord = isFullModule
          ? endpointMean(baseStations[1]).distanceTo(endpointMean(baseStations.at(-2)))
          : null;
        intervals.push({ module, minX: moduleMinX, maxX: moduleMaxX, outerChord, clearChord });

        const highestY = Math.max(...worldVertices.map((point) => point.y));
        const apexes = worldVertices.filter((point) => Math.abs(point.y - highestY) < 1e-4);
        assert.ok(apexes.length > 0);
        for (const point of apexes) {
          const plan = canonicalPlan(point);
          const halfWidth =
            plan.x <= PAVILION.capCenterX
              ? PAVILION.width / 2
              : Math.sqrt(
                  Math.max(0, (PAVILION.width / 2) ** 2 - (plan.x - PAVILION.capCenterX) ** 2),
                );
          assert.ok(plan.x >= roofStartX - 0.01 && plan.x <= roofEndX + 0.01);
          assert.ok(
            Math.abs(plan.z) <= halfWidth + 0.02,
            'triangle peak footprint lies inside the roof outline',
          );
          assert.ok(point.y <= capBounds.max.y + 0.002, 'triangle tip is below the roof cap');
          assert.ok(
            Math.abs(point.y - roofBodyBounds.min.y) < 0.005,
            'triangle tip meets the roof soffit',
          );
          roofRay.set(
            new THREE.Vector3(point.x, capBounds.max.y + 0.1, point.z),
            new THREE.Vector3(0, -1, 0),
          );
          roofRay.far = capBounds.max.y + 0.2 - point.y;
          assert.ok(
            roofRay.intersectObject(cap, false).length > 0,
            'roof-cap surface covers the structural module tip',
          );
        }
      }
      for (let index = 0; index < intervals.length - 1; index++) {
        assert.ok(
          Math.abs(intervals[index].maxX - intervals[index + 1].minX) < 0.015,
          `adjacent ${side} facade modules meet without a hidden gap`,
        );
      }
      moduleIntervals.set(side, intervals);
    }

    const outer = moduleIntervals.get(1);
    const inner = moduleIntervals.get(-1);
    assert.ok(
      Math.abs(outer[0].minX - roomStartX) < 0.02,
      'first triangle starts at the actual glass-room floor start',
    );
    assert.ok(
      outer.slice(0, 2).every(({ minX, maxX }) => minX < roomEndX && maxX > roomStartX) &&
        outer[1].maxX > roomEndX,
      'the first two front columns overlap and cover the measured glass-room length',
    );
    assert.ok(
      inner.slice(0, 2).every(({ minX, maxX }) => minX < roomEndX && maxX > roomStartX) &&
        inner[0].minX >= roomStartX - 0.02,
      'the rear column row also begins with the glass room and overlaps its range',
    );
    const terminalGap = roofEndX - outer.at(-1).maxX;
    assert.ok(terminalGap > 4, `measured terminal roof bay remains open: ${terminalGap}`);
    assert.ok(
      Math.abs(terminalGap - 4.71) < 0.04,
      `measured terminal clear length: ${terminalGap}`,
    );
    for (let index = 0; index < outer.length; index++) {
      const a = outer[index];
      const b = inner[index];
      assert.ok(Math.abs(a.minX - b.minX) < 0.002 && Math.abs(a.maxX - b.maxX) < 0.002);
      if (a.module.userData.fraction === 1) {
        assert.ok(
          Math.abs(a.clearChord - 4) < 0.02,
          `measured outer clear base chord: ${a.clearChord}`,
        );
        assert.ok(
          a.outerChord > 4.5,
          `outer foot-to-foot chord includes the feet: ${a.outerChord}`,
        );
        assert.ok(
          b.clearChord < a.clearChord - 0.4,
          'rear clear chord is shorter at the same angular pitch',
        );
      } else {
        assert.ok(
          a.outerChord > 0.45 && a.outerChord < 0.6,
          'half module has only one short outer foot',
        );
      }
    }
  } finally {
    dispose(model.root);
  }
});
