import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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
const { createZhiJieSign } = await import('../web/scene/zhi-jie-sign.js');
const { ZHI_JIE_SOURCE_ELEMENT_COUNT, ZHI_JIE_SOURCE_ELEMENTS, ZHI_JIE_SOURCE_SHA256 } =
  await import('../web/scene/zhi-jie-logo-data.js');
const svg = await readFile(new URL('../web/assets/zhi-jie-logo.svg', import.meta.url), 'utf8');

function meshesOf(root) {
  const meshes = [];
  root.traverse((object) => {
    if (object.isMesh) meshes.push(object);
  });
  return meshes;
}

function emittersOf(root) {
  return meshesOf(root).filter((mesh) => mesh.userData.ledEmitter === true);
}

function halosOf(root) {
  return meshesOf(root).filter((mesh) => mesh.userData.ledHalo === true);
}

function emitterBounds(meshes) {
  const bounds = new THREE.Box3().makeEmpty();
  for (const mesh of meshes) bounds.expandByObject(mesh);
  return bounds;
}

function dispose(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material)
      ? object.material
      : object.material
        ? [object.material]
        : []) {
      materials.add(material);
      if (material.map) textures.add(material.map);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}

test('compiled vector data tracks every visible source path, rectangle, and circle', () => {
  assert.equal(ZHI_JIE_SOURCE_SHA256, createHash('sha256').update(svg).digest('hex'));
  assert.equal(ZHI_JIE_SOURCE_ELEMENT_COUNT, 28);
  assert.equal(ZHI_JIE_SOURCE_ELEMENTS.length, ZHI_JIE_SOURCE_ELEMENT_COUNT);
  assert.deepEqual(
    ZHI_JIE_SOURCE_ELEMENTS.reduce(
      (counts, element) => {
        counts[element.tag] += 1;
        return counts;
      },
      { path: 0, rect: 0, circle: 0 },
    ),
    { path: 12, rect: 4, circle: 12 },
  );
  assert.ok(svg.includes('transform="translate(118,18)"'));
  assert.ok(svg.includes('transform="translate(187,18)"'));
  assert.ok(ZHI_JIE_SOURCE_ELEMENTS.some((element) => element.transform[0] === 118));
  assert.ok(ZHI_JIE_SOURCE_ELEMENTS.some((element) => element.transform[0] === 187));
});

test('factory builds a centered, full-color, finite 3D mesh sign in meters', () => {
  const sign = createZhiJieSign();
  sign.updateMatrixWorld(true);
  const bounds = emitterBounds(emittersOf(sign));
  const size = bounds.getSize(new THREE.Vector3());
  const meshes = emittersOf(sign);
  try {
    assert.equal(sign.name, '织界外墙标志');
    assert.equal(sign.userData.source, 'assets/zhi-jie-logo.svg');
    assert.equal(sign.userData.sourceSha256, ZHI_JIE_SOURCE_SHA256);
    assert.equal(
      sign.children.filter((child) => child.userData.sourceElementIndex !== undefined).length,
      ZHI_JIE_SOURCE_ELEMENT_COUNT,
    );
    assert.ok(Math.abs(size.x - 1.4) < 1e-5, `expected width 1.4m, got ${size.x}`);
    assert.ok(
      Math.abs(size.x / size.y - 2.7) < 0.18,
      `unexpected source aspect ratio ${size.x / size.y}`,
    );
    assert.ok(Math.abs(size.z - 0.025) < 1e-5, `expected 2.5cm depth, got ${size.z}`);
    assert.ok(Math.abs(bounds.getCenter(new THREE.Vector3()).x) < 1e-5);
    assert.ok(Math.abs(bounds.getCenter(new THREE.Vector3()).y) < 1e-5);
    assert.ok(bounds.min.z < 0 && bounds.max.z > 0, 'extrusion is centered around the sign origin');
    assert.equal(
      meshes.length,
      ZHI_JIE_SOURCE_ELEMENT_COUNT,
      'each source shape stays individually measurable',
    );
    assert.equal(meshes.filter((mesh) => mesh.userData.ledEmitter === true).length, 28);
    assert.equal(halosOf(sign).length, 1);
    assert.equal(halosOf(sign)[0].name, '织界 LED 柔光');
    assert.deepEqual(halosOf(sign)[0].userData, { ledHalo: true });

    const attributedElements = new Set();
    const sourceColors = new Set();
    let vertexZMin = Infinity;
    let vertexZMax = -Infinity;
    for (const mesh of meshes) {
      assert.equal(mesh.isMesh, true);
      assert.ok(mesh.geometry.isBufferGeometry);
      assert.equal(mesh.material.map, null, 'no image/texture planes are used');
      assert.ok(mesh.material.emissiveIntensity > 0.65 && mesh.material.emissiveIntensity < 1.1);
      assert.equal(mesh.material.toneMapped, false);
      assert.equal(typeof mesh.userData.sourceElementIndex, 'number');
      assert.equal(mesh.userData.sourceElementOrder, mesh.userData.sourceElementIndex);
      attributedElements.add(mesh.userData.sourceElementIndex);
      for (const color of mesh.userData.sourceColors) sourceColors.add(color);
      assert.ok(mesh.material.emissive.equals(new THREE.Color(mesh.userData.sourceColors[0])));
      const positions = mesh.geometry.getAttribute('position');
      for (let index = 0; index < positions.count; index += 1)
        for (const component of [
          positions.getX(index),
          positions.getY(index),
          positions.getZ(index),
        ])
          assert.ok(Number.isFinite(component));
      const vertexBounds = mesh.geometry.boundingBox ?? mesh.geometry.computeBoundingBox();
      vertexZMin = Math.min(vertexZMin, vertexBounds.min.z * mesh.scale.z + mesh.position.z);
      vertexZMax = Math.max(vertexZMax, vertexBounds.max.z * mesh.scale.z + mesh.position.z);
    }
    assert.equal(attributedElements.size, ZHI_JIE_SOURCE_ELEMENT_COUNT);
    assert.ok(Math.abs(vertexZMin + 0.0125) < 1e-5);
    assert.ok(Math.abs(vertexZMax - 0.0125) < 1e-5);
    for (const color of ['#ffc866', '#4ee5e0', '#a3fff7', '#f0fbff', '#e9ffff'])
      assert.ok(sourceColors.has(color), `missing original palette color ${color}`);

    const [halo] = halosOf(sign);
    const pixels = halo.material.map.image.data;
    const { width, height } = halo.material.map.image;
    assert.ok(width <= 512 && height <= 192, 'halo texture has a bounded resolution');
    assert.ok(width >= 256 && height >= 128, 'halo keeps enough resolution for contour softness');
    assert.equal(pixels.length, width * height * 4);
    const alphaValues = new Set();
    const colorsInHalo = new Set();
    let maxAlpha = 0;
    for (let pixel = 0; pixel < width * height; pixel += 1) {
      const offset = pixel * 4;
      const alpha = pixels[offset + 3];
      alphaValues.add(alpha);
      maxAlpha = Math.max(maxAlpha, alpha);
      if (alpha > 0)
        colorsInHalo.add(`${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]}`);
    }
    for (let x = 0; x < width; x += 1) {
      assert.equal(pixels[x * 4 + 3], 0, 'top and bottom edges fade to transparent');
      assert.equal(pixels[((height - 1) * width + x) * 4 + 3], 0);
    }
    for (let y = 0; y < height; y += 1) {
      assert.equal(pixels[y * width * 4 + 3], 0, 'left and right edges fade to transparent');
      assert.equal(pixels[(y * width + width - 1) * 4 + 3], 0);
    }
    assert.ok(maxAlpha > 0 && maxAlpha < 255, 'halo stays softly transparent');
    assert.ok(alphaValues.size > 4, 'halo alpha has a soft gradient rather than a hard edge');
    assert.ok(colorsInHalo.size > 4, 'halo retains nonuniform source colors');
    assert.equal(halo.material.blending, THREE.AdditiveBlending);
    assert.equal(halo.material.depthTest, true);
    assert.equal(halo.material.depthWrite, false);
    assert.equal(halo.userData.sourceElementIndex, undefined);
    assert.equal(halo.onBeforeRender, THREE.Object3D.prototype.onBeforeRender);
  } finally {
    dispose(sign);
  }
});

test('two signs own independent geometry and materials and honor dimensions', () => {
  const first = createZhiJieSign({ width: 1.6, depth: 0.04 });
  const second = createZhiJieSign({ width: 1.6, depth: 0.04 });
  first.updateMatrixWorld(true);
  second.updateMatrixWorld(true);
  const firstMeshes = emittersOf(first);
  const secondMeshes = emittersOf(second);
  const firstHalo = halosOf(first)[0];
  const secondHalo = halosOf(second)[0];
  try {
    assert.ok(Math.abs(emitterBounds(firstMeshes).getSize(new THREE.Vector3()).x - 1.6) < 1e-5);
    assert.ok(Math.abs(emitterBounds(firstMeshes).getSize(new THREE.Vector3()).z - 0.04) < 1e-5);
    assert.equal(firstMeshes.length, secondMeshes.length);
    assert.equal(
      firstMeshes.length,
      ZHI_JIE_SOURCE_ELEMENT_COUNT,
      'primitives are merged by SVG source element',
    );
    for (let index = 0; index < firstMeshes.length; index += 1) {
      assert.notEqual(firstMeshes[index].geometry, secondMeshes[index].geometry);
      assert.notEqual(firstMeshes[index].material, secondMeshes[index].material);
    }
    assert.notEqual(firstHalo.geometry, secondHalo.geometry);
    assert.notEqual(firstHalo.material, secondHalo.material);
    assert.notEqual(firstHalo.material.map, secondHalo.material.map);
    let textureDisposed = false;
    firstHalo.material.map.addEventListener('dispose', () => {
      textureDisposed = true;
    });
    dispose(first);
    assert.equal(textureDisposed, true, 'the per-sign halo texture is independently disposable');
    assert.throws(() => createZhiJieSign({ depth: 0.041 }), RangeError);
  } finally {
    dispose(first);
    dispose(second);
  }
});
