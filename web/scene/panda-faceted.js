import * as THREE from 'three';
import { createPanda } from './panda/model.js';

// Body parts that become low-poly faceted panels. Eyes, nose, pupils, the belly emblem and
// the inner ears keep their own materials so the marks stay crisp.
const FACETED =
  /^(head|tail|arm-(left|right)|leg-(left|right)|foot-(left|right)|paw-(left|right)|ear-(left|right))$/;

// Matte only: their flat parts sit on other surfaces, so faceting would bury the marks.
const MATTE_ONLY = /^(torso|belly|tuft|eye-patch-(left|right))$/;
const FLAT_FACE = /^(eye-|pupil-|catchlight|nose$)/;
const FACET_SEGMENTS = [24, 16];

function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

// Rebuilds a part as a coarse sphere whose vertices are pushed out along each direction to
// the original surface. Flat shading then gives large, clean triangular panels, like a folded
// paper sculpture. The radius is boosted by the chord error, so flat panels stay on the surface.
function lowPolyGeometry(source, rand) {
  const box = new THREE.Box3().setFromBufferAttribute(source.getAttribute('position'));
  const center = box.getCenter(new THREE.Vector3());
  const fallback = box.getSize(new THREE.Vector3()).length() * 0.15;
  const probe = new THREE.Mesh(source, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const raycaster = new THREE.Raycaster();
  const sphere = new THREE.SphereGeometry(1, FACET_SEGMENTS[0], FACET_SEGMENTS[1]);
  const sp = sphere.getAttribute('position');
  const boost = 1 / Math.cos(Math.PI / FACET_SEGMENTS[0]);
  const dir = new THREE.Vector3();
  for (let i = 0; i < sp.count; i++) {
    dir.fromBufferAttribute(sp, i).normalize();
    raycaster.set(center, dir);
    const hits = raycaster.intersectObject(probe, false);
    const radius = hits.length ? hits[hits.length - 1].distance * boost : fallback;
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

/** The same procedural panda, with low-poly faceted geometry and a matte surface. */
export function createFacetedPanda() {
  const panda = createPanda();
  const rand = seeded(20261030);

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
    const low = lowPolyGeometry(mesh.geometry, rand);
    mesh.geometry.dispose();
    mesh.geometry = low;
  }
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
