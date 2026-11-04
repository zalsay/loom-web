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
const { createBrickWallPanel, createToolPegboard } = await import(
  '../web/scene/workshop-wall-panels.js'
);

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

function localBounds(root) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3();
  for (const mesh of meshes(root)) bounds.expandByObject(mesh);
  return bounds;
}

function assertFiniteGeometry(mesh) {
  const position = mesh.geometry.getAttribute('position');
  assert.ok(position?.count > 0, `${mesh.name} must have real vertex geometry`);
  for (const attributeName of Object.keys(mesh.geometry.attributes)) {
    const attribute = mesh.geometry.getAttribute(attributeName);
    for (const value of attribute.array)
      assert.ok(Number.isFinite(value), `${mesh.name} ${attributeName} has non-finite data`);
  }
}

function triangleCount(root) {
  return meshes(root).reduce((total, mesh) => {
    const geometry = mesh.geometry;
    const index = geometry.index;
    return total + (index ? index.count : geometry.getAttribute('position').count) / 3;
  }, 0);
}

function allTools(root) {
  const found = [];
  root.traverse((object) => {
    if (object.userData.wallTool) found.push(object);
  });
  return found;
}

function castAt(mesh, x, y) {
  mesh.updateWorldMatrix(true, false);
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(x, y, 1),
    new THREE.Vector3(0, 0, -1),
    0,
    2,
  );
  return raycaster.intersectObject(mesh, false).length > 0;
}

test('framed pegboard fits the niche and its perforated extrusion has open through-holes', () => {
  const panel = createToolPegboard();
  try {
    const board = meshes(panel).find((mesh) => mesh.userData.pegboard);
    const bounds = localBounds(panel);
    assert.equal(panel.name, '洞洞板工具墙');
    assert.equal(panel.userData.rigidPlan, true);
    assert.equal(panel.userData.wallDisplay, 'tool-pegboard');
    assert.equal(board.geometry.type, 'ExtrudeGeometry');
    assert.equal(board.userData.holeCount, 221);
    assert.equal(board.geometry.parameters.shapes.holes.length, 221);
    assert.ok(bounds.min.x >= -0.575 && bounds.max.x <= 0.575);
    assert.ok(bounds.min.y >= -0.74 && bounds.max.y <= 0.74);
    assert.ok(bounds.min.z >= 0 && bounds.max.z <= 0.29);
    const holeX = -6 * 0.075;
    const holeY = 8 * 0.075;
    assert.equal(castAt(board, holeX, holeY), false, 'ray passes through a genuine board hole');
    assert.equal(castAt(board, holeX + 0.021, holeY), true, 'neighboring ray hits solid board');
  } finally {
    dispose(panel);
  }
});

test('pegboard has six distinct, hooked hand-tool silhouettes with geometry', () => {
  const panel = createToolPegboard();
  try {
    const tools = allTools(panel);
    const hooks = [];
    panel.traverse((object) => {
      if (object.userData.pegHook) hooks.push(object);
    });
    const toolTypes = new Set(tools.map((tool) => tool.userData.toolType));
    const toolMeshes = meshes(panel).filter((mesh) => {
      let parent = mesh.parent;
      while (parent && !parent.userData.wallTool) parent = parent.parent;
      return Boolean(parent);
    });
    assert.equal(tools.length, 6);
    assert.equal(hooks.length, 6, 'each tool has its own bent, solid metal hook');
    panel.updateMatrixWorld(true);
    for (const hook of hooks) {
      const tool = tools.find((item) => item.userData.toolType === hook.userData.toolType);
      assert.ok(tool, 'hook and tool share the same peg column');
      const toolBounds = new THREE.Box3().setFromObject(tool);
      const hookBounds = new THREE.Box3().setFromObject(hook);
      assert.ok(
        Math.abs(hookBounds.min.y - toolBounds.max.y) <= 0.01,
        `${tool.userData.toolType}: tool top ${toolBounds.max.y}, hook position ${hook.position.y}, hook foot ${hookBounds.min.y}`,
      );
    }
    assert.deepEqual(
      [...toolTypes].sort(),
      ['hammer', 'hex-key', 'open-end-wrench', 'pliers', 'ruler', 'screwdriver'].sort(),
    );
    assert.ok(toolMeshes.length >= 20, 'tools are assembled from visible modeled parts');
    for (const mesh of toolMeshes) assertFiniteGeometry(mesh);
    assert.ok(meshes(panel).every((mesh) => mesh.geometry.type !== 'InstancedBufferGeometry'));
  } finally {
    dispose(panel);
  }
});

test('green brick panel has a real raised cylindrical stud lattice and snapped panda pieces', () => {
  const panel = createBrickWallPanel();
  try {
    const meshesInPanel = meshes(panel);
    const baseplate = meshesInPanel.find((mesh) => mesh.userData.brickBaseplate);
    const studBatches = meshesInPanel.filter((mesh) => mesh.userData.brickStuds);
    const baseplateStuds = studBatches.filter((mesh) => mesh.userData.baseplateStuds);
    const pieceStudBatches = studBatches.filter((mesh) => mesh.userData.brickPieceStuds);
    const pieces = meshesInPanel.filter((mesh) => mesh.userData.brickPiece);
    const pandaPixels = pieces.filter((mesh) => mesh.userData.mosaicPixel);
    const accents = pieces.filter((mesh) => mesh.userData.accentBrick);
    const bounds = localBounds(panel);
    assert.equal(panel.name, '乐高积木墙');
    assert.equal(panel.userData.rigidPlan, true);
    assert.equal(panel.userData.wallDisplay, 'brick-board');
    assert.ok(baseplate?.geometry.type === 'BoxGeometry');
    assert.equal(baseplateStuds.length, 1);
    assert.ok(pieceStudBatches.length >= 5, 'raised bricks have matching studs, batched per color');
    assert.equal(baseplateStuds[0].userData.studCount, 221);
    assert.equal(
      studBatches.reduce((total, mesh) => total + mesh.userData.studCount, 0),
      221 + panel.userData.brickPieceStudCount,
    );
    assert.equal(panel.userData.studRows, 17);
    assert.equal(panel.userData.studColumns, 13);
    assert.equal(panel.userData.studPitch, 0.075);
    assert.ok(baseplateStuds[0].geometry.getAttribute('position').count > 221 * 20);
    assert.ok(baseplateStuds[0].geometry.boundingBox.min.z >= 0.044);
    assert.ok(baseplateStuds[0].geometry.boundingBox.max.z <= 0.063);
    assert.ok(
      pieceStudBatches.every(
        (mesh) =>
          Math.abs(mesh.geometry.boundingBox.min.z - 0.082) <= 1e-6 &&
          Math.abs(mesh.geometry.boundingBox.max.z - 0.098) <= 1e-6 &&
          Math.abs(mesh.geometry.boundingBox.max.z - mesh.geometry.boundingBox.min.z - 0.016) <=
            1e-6,
      ),
      'round studs are raised above the colored brick faces',
    );
    assert.equal(pandaPixels.length, panel.userData.mosaicPixelCount);
    assert.ok(pandaPixels.length >= 50, 'black and white raised pieces form a panda pixel mosaic');
    assert.ok(accents.length >= 8, 'small primary-color bricks are confined to the lower edge');
    assert.ok(pandaPixels.some((mesh) => mesh.userData.pixelColor === 'black'));
    assert.ok(pandaPixels.some((mesh) => mesh.userData.pixelColor === 'white'));
    assert.ok(pandaPixels.every((mesh) => mesh.position.z > baseplate.position.z + 0.02));
    assert.ok(pandaPixels.every((mesh) => Number.isInteger(mesh.userData.gridColumn)));
    assert.ok(bounds.min.x >= -0.575 && bounds.max.x <= 0.575);
    assert.ok(bounds.min.y >= -0.74 && bounds.max.y <= 0.74);
    assert.ok(bounds.min.z >= 0 && bounds.max.z <= 0.29);
    for (const mesh of meshesInPanel) assertFiniteGeometry(mesh);
  } finally {
    dispose(panel);
  }
});

test('panels use isolated native resources, finite transforms, and no unsupported scene objects', () => {
  const first = [createToolPegboard(), createBrickWallPanel()];
  const second = [createToolPegboard(), createBrickWallPanel()];
  try {
    const firstResources = first.map(resources);
    const secondResources = second.map(resources);
    for (let i = 0; i < first.length; i++) {
      assert.ok(firstResources[i].geometries.size > 0);
      assert.ok(firstResources[i].materials.size > 0);
      for (const geometry of firstResources[i].geometries)
        assert.equal(secondResources[i].geometries.has(geometry), false);
      for (const mat of firstResources[i].materials)
        assert.equal(secondResources[i].materials.has(mat), false);
      for (const object of first[i].children) {
        assert.ok(object.position.toArray().every(Number.isFinite));
        assert.ok(object.scale.toArray().every(Number.isFinite));
      }
      first[i].traverse((object) => {
        assert.equal(object.isLight, undefined);
        assert.notEqual(object.type, 'InstancedMesh');
        assert.ok(object.position.toArray().every(Number.isFinite), `${object.name} position`);
        assert.ok(object.scale.toArray().every(Number.isFinite), `${object.name} scale`);
        assert.ok(object.quaternion.toArray().every(Number.isFinite), `${object.name} rotation`);
        if (object.isMesh) {
          assert.equal(object.material.map, null);
          assertFiniteGeometry(object);
        }
      });
    }
    assert.ok(
      meshes(first[0]).length + meshes(first[1]).length < 180,
      'batched board and per-color brick studs stay within scene budget',
    );
  } finally {
    for (const panel of [...first, ...second]) dispose(panel);
  }
});

test('combined panel geometry stays below the SVG-friendly triangle budget', () => {
  const pegboard = createToolPegboard();
  const brickPanel = createBrickWallPanel();
  try {
    const triangles = triangleCount(pegboard) + triangleCount(brickPanel);
    assert.ok(Number.isInteger(triangles));
    assert.ok(triangles <= 21_000, `combined mesh triangles: ${triangles}`);
  } finally {
    dispose(pegboard);
    dispose(brickPanel);
  }
});
