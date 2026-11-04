import * as THREE from 'three';
import { createPanda } from './panda/model.js';

// Body parts that become low-poly faceted panels. Eyes, nose, pupils, the belly emblem and
// the inner ears keep their own materials so the marks stay crisp.
const FACETED =
  /^(head|torso|tail|arm-(left|right)|leg-(left|right)|foot-(left|right)|paw-(left|right)|ear-(left|right))$/;

// Facial markings and belly are clipped to the new panels below.
const MATTE_ONLY = /^(belly|tuft|eye-patch-(left|right))$/;
const FLAT_FACE = /^(eye-(left|right)$|pupil-|catchlight|nose$)/;
const SURFACE_INSET = 0.995;
const BELLY = { cx: 0, cy: 1.29, rx: 0.85, ry: 0.86, segments: 48, lift: 0.009 };

function seeded(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

// Rebuilds a part as a coarse sphere whose vertices are projected to its original surface.
// Flat shading then gives large, clean triangular panels, like a folded paper sculpture.
function lowPolyGeometry(source, rand, radialBoost = 1.025, sculptHead = false) {
  const box = new THREE.Box3().setFromBufferAttribute(source.getAttribute('position'));
  const center = box.getCenter(new THREE.Vector3());
  const fallback = box.getSize(new THREE.Vector3()).length() * 0.15;
  const probe = new THREE.Mesh(source, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
  const raycaster = new THREE.Raycaster();
  // Geodesic triangles avoid the latitude bands and pinched poles of a UV sphere.
  const sphere = new THREE.IcosahedronGeometry(1, 3);
  sphere.rotateY(0.13).rotateZ(0.08);
  const sp = sphere.getAttribute('position');
  const dir = new THREE.Vector3();
  const radii = new Map();
  for (let i = 0; i < sp.count; i++) {
    dir.fromBufferAttribute(sp, i).normalize();
    if (sculptHead) {
      const x = dir.x * 1.35 * (1 + 0.06 * Math.exp(-(((dir.y + 0.35) / 0.5) ** 2)));
      const y = 3.04 + dir.y * 1.08;
      const muzzle = 0.3 * Math.exp(-((x / 0.68) ** 2 + ((y - 2.78) / 0.34) ** 2));
      sp.setXYZ(i, x, y, 0.035 + dir.z * 1.14 + muzzle * Math.max(0, dir.z) ** 0.35);
    } else {
      // Non-indexed geodesic faces repeat their corners. Project each direction once.
      const key = `${dir.x},${dir.y},${dir.z}`;
      let radius = radii.get(key);
      if (radius === undefined) {
        raycaster.set(center, dir);
        const hits = raycaster.intersectObject(probe, false);
        radius = hits.length ? hits[hits.length - 1].distance * radialBoost : fallback;
        radii.set(key, radius);
      }
      sp.setXYZ(i, center.x + dir.x * radius, center.y + dir.y * radius, center.z + dir.z * radius);
    }
  }
  probe.material.dispose();

  // Keep only non-degenerate triangles, one restrained pigment tone per panel.
  const flat = sphere.index ? sphere.toNonIndexed() : sphere.clone();
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
    const tone = 0.9 + rand() * 0.1;
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

function clipPolygon(polygon, distance) {
  if (!polygon.length) return [];
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
  return clipped;
}

// Split the existing panels at the shoulder boundary, keeping one continuous body
// surface instead of a second shell or a sawtooth edge made from whole triangles.
function paintShoulders(torso, ivory) {
  const source = torso.geometry.getAttribute('position');
  const tones = torso.geometry.getAttribute('color');
  const positions = [],
    colors = [];
  const normal = new THREE.Vector3(),
    edge = new THREE.Vector3();
  for (let i = 0; i < source.count; i += 3) {
    const triangle = [0, 1, 2].map((j) => new THREE.Vector3().fromBufferAttribute(source, i + j));
    for (const black of [false, true]) {
      const polygon = clipPolygon(triangle, (v) => (black ? v.y - 0.38 : 0.38 - v.y));
      const tone = tones.getX(i) * (black ? 0.022 : 1);
      for (let j = 1; j < polygon.length - 1; j++) {
        const vertices = [polygon[0], polygon[j], polygon[j + 1]];
        normal
          .subVectors(vertices[1], vertices[0])
          .cross(edge.subVectors(vertices[2], vertices[0]));
        if (normal.lengthSq() < 1e-12) continue;
        for (const v of vertices) {
          positions.push(v.x, v.y, v.z);
          colors.push(tone, tone * (black ? 1.08 : 1), tone * (black ? 1.16 : 1));
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  torso.geometry.dispose();
  torso.geometry = geometry;
  torso.material = torso.material.clone();
  torso.material.color.copy(ivory);
}

// Clip markings from the parent panels instead of floating smooth ovals over them.
// Interpolating XYZ keeps belly and eye markings on their actual surface planes.
function facetedPatch(parent, patch, boundarySpec = BELLY) {
  parent.updateMatrix();
  patch.updateMatrix();
  const transform = patch.matrix.clone().invert().multiply(parent.matrix);
  const source = parent.geometry.getAttribute('position');
  const tones = parent.geometry.getAttribute('color');
  const boundary = Array.from({ length: boundarySpec.segments }, (_, i) => {
    const angle = (i / boundarySpec.segments) * Math.PI * 2;
    const rotation = boundarySpec.rotation || 0;
    const dx = boundarySpec.rx * Math.cos(angle),
      dy = boundarySpec.ry * Math.sin(angle);
    return new THREE.Vector2(
      boundarySpec.cx + dx * Math.cos(rotation) - dy * Math.sin(rotation),
      boundarySpec.cy + dx * Math.sin(rotation) + dy * Math.cos(rotation),
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
      polygon = clipPolygon(polygon, distance);
    }
    for (let j = 1; j < polygon.length - 1; j++) {
      const triangle = [polygon[0], polygon[j], polygon[j + 1]];
      normal.subVectors(triangle[1], triangle[0]).cross(edge.subVectors(triangle[2], triangle[0]));
      if (normal.lengthSq() < 1e-12) continue;
      for (const vertex of triangle) {
        positions.push(vertex.x, vertex.y, vertex.z + boundarySpec.lift);
        const tone = tones.getX(i);
        colors.push(tone, tone, tone);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  patch.geometry.dispose();
  patch.geometry = geometry;
}

// Refit existing marks to the actual polygonal surface, rather than layering a second face.
function fitSculptureFace(panda) {
  const head = panda.getObjectByName('head');
  const ray = new THREE.Raycaster();
  const surface = (x, y) => {
    ray.set(new THREE.Vector3(x, y, 5), new THREE.Vector3(0, 0, -1));
    const hit = ray.intersectObject(head, false)[0];
    if (!hit) throw new RangeError('Facial mark falls outside the sculpture head');
    return hit.point.z;
  };
  for (const side of ['left', 'right']) {
    for (const [prefix, lift] of [
      ['eye', 0.04],
      ['pupil', 0.085],
      ['catchlight', 0.12],
      ['catchlight-small', 0.12],
    ]) {
      const mark = panda.getObjectByName(`${prefix}-${side}`);
      mark.position.x += (side === 'left' ? -1 : 1) * 0.195;
      mark.position.y += 0.12;
      mark.position.z = surface(mark.position.x, mark.position.y) + lift;
      if (prefix.startsWith('catchlight')) mark.scale.multiplyScalar(0.6);
    }
  }
  const nose = panda.getObjectByName('nose');
  // Replace the rounded heart-shaped nose with a broad, bevelled trapezoid.
  const shape = new THREE.Shape();
  shape.moveTo(-0.34, 0.075);
  shape.lineTo(-0.23, 0.16);
  shape.lineTo(0.23, 0.16);
  shape.lineTo(0.34, 0.075);
  shape.lineTo(0.2, -0.1);
  shape.lineTo(0, -0.14);
  shape.lineTo(-0.2, -0.1);
  shape.closePath();
  nose.geometry.dispose();
  nose.geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.1,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 1,
    bevelSize: 0.035,
    bevelThickness: 0.045,
    curveSegments: 1,
  });
  // Keep the named nose anchor at the muzzle for consumers of the existing rig.
  nose.position.set(0, 2.86, surface(0, 2.86));
  const noseVertices = nose.geometry.getAttribute('position');
  for (let i = 0; i < noseVertices.count; i++) {
    noseVertices.setZ(
      i,
      surface(noseVertices.getX(i), noseVertices.getY(i) + 2.86) -
        nose.position.z -
        0.025 +
        noseVertices.getZ(i),
    );
  }
  noseVertices.needsUpdate = true;
  nose.geometry.computeVertexNormals();
  const highlight = panda.getObjectByName('nose-soft-highlight');
  nose.updateMatrixWorld(true);
  ray.set(
    new THREE.Vector3(highlight.position.x, highlight.position.y, 5),
    new THREE.Vector3(0, 0, -1),
  );
  highlight.position.z = ray.intersectObject(nose, false)[0].point.z + 0.002;
  highlight.scale.multiplyScalar(0.5);
  const mouth = {
    philtrum: [
      [0, 2.76],
      [0, 2.69],
    ],
    'smile-left': [
      [0, 2.69],
      [-0.18, 2.64],
      [-0.38, 2.65],
    ],
    'smile-right': [
      [0, 2.69],
      [0.18, 2.64],
      [0.38, 2.65],
    ],
  };
  const crease = new THREE.MeshStandardMaterial({ color: '#a6a59c', roughness: 1 });
  for (const [name, points] of Object.entries(mouth)) {
    const mark = panda.getObjectByName(name);
    const curve = new THREE.CatmullRomCurve3(
      points.map(([x, y]) => new THREE.Vector3(x, y, surface(x, y) + 0.018)),
    );
    mark.geometry.dispose();
    mark.geometry = new THREE.TubeGeometry(curve, 24, 0.01, 5, false);
    mark.material = crease;
  }
  // The reference is a clean sculpture, not a furry mascot with whisker dots.
  // These details share geometry/materials with retained eyes and inner ears.
  for (const mark of [...panda.children]) {
    if (mark.name.startsWith('muzzle-pore-') || mark.name === 'smile-dimple')
      mark.removeFromParent();
  }
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
    // Keep limb dimensions stable for the climbing rig. Inset the torso to leave
    // room for its existing emblem; facial markings are fitted to the new head below.
    const low = lowPolyGeometry(
      mesh.geometry,
      mesh.name === 'torso' ? bodyRand : rand,
      mesh.name === 'torso' ? SURFACE_INSET : undefined,
      mesh.name === 'head',
    );
    mesh.geometry.dispose();
    mesh.geometry = low;
  }
  facetedPatch(panda.getObjectByName('torso'), panda.getObjectByName('belly'));
  const head = panda.getObjectByName('head');
  for (const sign of [-1, 1]) {
    const side = sign < 0 ? 'left' : 'right';
    facetedPatch(head, panda.getObjectByName(`eye-patch-${side}`), {
      cx: sign * 0.64,
      cy: 3.24,
      rx: 0.34,
      ry: 0.46,
      rotation: sign * 0.34,
      segments: 48,
      lift: 0.009,
    });
    const ear = panda.getObjectByName(`ear-${side}`);
    ear.position.set(sign * 0.99, 3.91, -0.03);
    ear.scale.set(0.32, 0.34, 0.27);
    const inner = panda.getObjectByName(`ear-inner-${side}`);
    inner.position.set(sign * 0.99, 3.92, 0.19);
    inner.scale.set(0.19, 0.21, 0.035);
  }
  // Colour the existing torso panels: a white rump below the black shoulder saddle.
  // Do this after fitting the belly so its white panels retain their original tones.
  paintShoulders(panda.getObjectByName('torso'), head.material.color);
  fitSculptureFace(panda);

  for (const original of replaced.keys()) original.dispose();

  // Eyes, pupils, catchlights and nose use diffuse Lambert shading. Their original physical
  // materials gave flat specular glints on the face, which read as stray reflections.
  const faceMaterials = new Set();
  panda.traverse((o) => {
    if (!o.isMesh || !FLAT_FACE.test(o.name)) return;
    const original = o.material;
    faceMaterials.add(original);
    o.material = new THREE.MeshLambertMaterial({
      color: /^eye-(left|right)$/.test(o.name) ? 0x20252a : original.color.clone(),
    });
  });
  for (const original of faceMaterials) original.dispose();

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
  const tuft = panda.getObjectByName('tuft');
  if (tuft) {
    tuft.geometry.dispose();
    tuft.removeFromParent();
  }
  return panda;
}
