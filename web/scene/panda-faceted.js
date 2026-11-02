import * as THREE from 'three';
import { createPanda } from './panda/model.js';

// Body parts that become low-poly faceted panels. Eyes, nose, pupils, the belly emblem and
// the inner ears keep their own materials so the marks stay crisp.
const FACETED =
  /^(head|torso|tail|arm-(left|right)|leg-(left|right)|foot-(left|right)|paw-(left|right)|ear-(left|right))$/;

// Facial patches retain their original surfaces; the belly is rebuilt against the torso below.
const MATTE_ONLY = /^(belly|tuft|eye-patch-(left|right))$/;
const FLAT_FACE = /^(eye-|pupil-|catchlight|nose$)/;
const FACET_SEGMENTS = [24, 16];
const HEAD_RADIAL_SCALE = 0.995;
const BELLY = { cx: 0, cy: 1.29, rx: 0.85, ry: 0.86, segments: 48, lift: 0.009 };

function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

// Rebuilds a part as a coarse sphere whose vertices are projected to its original surface.
// Flat shading then gives large, clean triangular panels, like a folded paper sculpture.
function lowPolyGeometry(source, rand, radialBoost = 1 / Math.cos(Math.PI / FACET_SEGMENTS[0])) {
  const box = new THREE.Box3().setFromBufferAttribute(source.getAttribute('position'));
  const center = box.getCenter(new THREE.Vector3());
  const fallback = box.getSize(new THREE.Vector3()).length() * 0.15;
  const probe = new THREE.Mesh(source, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const raycaster = new THREE.Raycaster();
  const sphere = new THREE.SphereGeometry(1, FACET_SEGMENTS[0], FACET_SEGMENTS[1]);
  const sp = sphere.getAttribute('position');
  const dir = new THREE.Vector3();
  for (let i = 0; i < sp.count; i++) {
    dir.fromBufferAttribute(sp, i).normalize();
    raycaster.set(center, dir);
    const hits = raycaster.intersectObject(probe, false);
    const radius = hits.length ? hits[hits.length - 1].distance * radialBoost : fallback;
    sp.setXYZ(i, center.x + dir.x * radius, center.y + dir.y * radius, center.z + dir.z * radius);
  }
  probe.material.dispose();

  // Keep only non-degenerate triangles (sphere poles collapse), one tone per panel.
  const flat = sphere.toNonIndexed();
  const fp = flat.getAttribute('position');
  const positions = [];
  const colors = [];
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3(),
    ab = new THREE.Vector3(),
    ac = new THREE.Vector3();
  for (let f = 0; f < fp.count; f += 3) {
    a.fromBufferAttribute(fp, f);
    b.fromBufferAttribute(fp, f + 1);
    c.fromBufferAttribute(fp, f + 2);
    if (ab.subVectors(b, a).cross(ac.subVectors(c, a)).lengthSq() < 1e-12) continue;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
    const tone = 0.72 + rand() * 0.42;
    colors.push(tone, tone, tone, tone, tone, tone, tone, tone, tone);
  }
  sphere.dispose();
  flat.dispose();

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function matte(original) {
  const material = new THREE.MeshStandardMaterial({
    color: original.color.clone(),
    roughness: 0.85,
    metalness: 0,
    vertexColors: true,
    flatShading: true,
  });
  material.userData.faceted = true;
  return material;
}

// Cut the white patch out of the actual torso panels, rather than laying a smooth
// oval over a polygonal body. Clipping interpolates XYZ together, so every white
// triangle stays on its black parent panel (plus a small depth-safe lift).
function facetedBelly(torso, belly) {
  torso.updateMatrix();
  belly.updateMatrix();
  const transform = belly.matrix.clone().invert().multiply(torso.matrix);
  const source = torso.geometry.getAttribute('position');
  const tones = torso.geometry.getAttribute('color');
  const boundary = Array.from({ length: BELLY.segments }, (_, i) => {
    const angle = (i / BELLY.segments) * Math.PI * 2;
    return new THREE.Vector2(
      BELLY.cx + BELLY.rx * Math.cos(angle),
      BELLY.cy + BELLY.ry * Math.sin(angle),
    );
  });
  const positions = [],
    colors = [];
  const normal = new THREE.Vector3(),
    edge = new THREE.Vector3();
  for (let i = 0; i < source.count; i += 3) {
    let polygon = [0, 1, 2].map((offset) =>
      new THREE.Vector3().fromBufferAttribute(source, i + offset).applyMatrix4(transform),
    );
    normal.subVectors(polygon[1], polygon[0]).cross(edge.subVectors(polygon[2], polygon[0]));
    if (normal.z <= 1e-10) continue;
    for (let j = 0; j < boundary.length && polygon.length; j++) {
      const a = boundary[j],
        b = boundary[(j + 1) % boundary.length];
      const distance = (v) => (b.x - a.x) * (v.y - a.y) - (b.y - a.y) * (v.x - a.x);
      const clipped = [];
      let previous = polygon[polygon.length - 1],
        previousDistance = distance(previous);
      for (const current of polygon) {
        const currentDistance = distance(current);
        if (currentDistance >= 0 !== previousDistance >= 0)
          clipped.push(
            previous.clone().lerp(current, previousDistance / (previousDistance - currentDistance)),
          );
        if (currentDistance >= 0) clipped.push(current);
        previous = current;
        previousDistance = currentDistance;
      }
      polygon = clipped;
    }
    for (let j = 1; j < polygon.length - 1; j++) {
      const triangle = [polygon[0], polygon[j], polygon[j + 1]];
      normal.subVectors(triangle[1], triangle[0]).cross(edge.subVectors(triangle[2], triangle[0]));
      if (normal.lengthSq() < 1e-12) continue;
      for (const vertex of triangle) {
        positions.push(vertex.x, vertex.y, vertex.z + BELLY.lift);
        const tone = tones.getX(i);
        colors.push(tone, tone, tone);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  belly.geometry.dispose();
  belly.geometry = geometry;
}

/** The same procedural panda, with low-poly faceted geometry and a matte surface. */
export function createFacetedPanda() {
  const panda = createPanda();
  const rand = seeded(20261030);
  const bodyRand = seeded(20261102);

  const targets = [];
  panda.traverse((o) => {
    if (o.isMesh && (FACETED.test(o.name) || MATTE_ONLY.test(o.name))) targets.push(o);
  });
  const replaced = new Map();
  for (const mesh of targets) {
    const original = mesh.material;
    if (!replaced.has(original)) replaced.set(original, matte(original));
    mesh.material = replaced.get(original);
    if (!FACETED.test(mesh.name)) continue;
    // The chord-error expansion helps round limbs stay on their surfaces, but expands the
    // head through its smooth eye patches. Leave a tiny head inset so the facial marks retain
    // a positive overlap while the low-poly head remains visible around them. Inset the torso
    // too, keeping the emblem above its new panels; its belly is fitted separately below.
    const low = lowPolyGeometry(
      mesh.geometry,
      mesh.name === 'torso' ? bodyRand : rand,
      /^(head|torso)$/.test(mesh.name) ? HEAD_RADIAL_SCALE : undefined,
    );
    mesh.geometry.dispose();
    mesh.geometry = low;
  }
  facetedBelly(panda.getObjectByName('torso'), panda.getObjectByName('belly'));
  for (const original of replaced.keys()) original.dispose();

  // Eyes, pupils, catchlights and nose use unlit Lambert shading. Their original physical
  // materials gave flat specular glints on the face, which read as stray reflections.
  const flatFace = new Map();
  panda.traverse((o) => {
    if (!o.isMesh || !FLAT_FACE.test(o.name)) return;
    const original = o.material;
    if (!flatFace.has(original))
      flatFace.set(original, new THREE.MeshLambertMaterial({ color: original.color.clone() }));
    o.material = flatFace.get(original);
  });
  for (const original of flatFace.keys()) original.dispose();

  // Short fur would turn the faceted surface back into fuzz.
  const fur = panda.getObjectByName('short-fur');
  if (fur) {
    const instanced = [];
    fur.traverse((o) => {
      if (o.isInstancedMesh) instanced.push(o);
    });
    for (const mesh of instanced) {
      mesh.material.dispose();
      mesh.dispose();
    }
    instanced[0]?.geometry.dispose();
    fur.removeFromParent();
  }
  return panda;
}
