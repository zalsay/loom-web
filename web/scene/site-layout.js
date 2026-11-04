import * as THREE from 'three';
import { GLASS_ROOM, PAVILION } from './pavilion-dimensions.js';

// The supplied screenshot is a visual plan, not a survey. Image right is +X,
// image down is +Z. No true-north bearing or scale bar was supplied.
export const SITE = {
  metresPerPixel: 0.14,
  imageOrigin: [560, 455],
  imageSize: [1051, 945],
  videoStartPixel: [590, 554],
  videoTargetPixel: [531, 478],
  canopyCurvePixels: [
    [508, 482],
    [590, 478],
    [654, 396],
    [640, 308],
  ],
};
export function mapPoint(x, z, y = 0) {
  return new THREE.Vector3(
    (x - SITE.imageOrigin[0]) * SITE.metresPerPixel,
    y,
    (z - SITE.imageOrigin[1]) * SITE.metresPerPixel,
  );
}
const arcAnchor = mapPoint(...SITE.canopyCurvePixels[0]);
const arcTangent = mapPoint(...SITE.canopyCurvePixels[1])
  .sub(arcAnchor)
  .normalize();
const arcNormal = new THREE.Vector3(-arcTangent.z, 0, arcTangent.x);
// Canonical x is now true centreline arc distance, z is the radial offset. Do
// not apply the former parabola before the circular transform a second time.
export const oldCenterline = () => 0;
function curveAt(t) {
  return bendPoint(new THREE.Vector3(PAVILION.startX + t * PAVILION.length, 0, 0));
}
export function bendPoint(v) {
  const radius = GLASS_ROOM.centerRadius;
  const angle = (v.x - PAVILION.startX) / radius;
  const offset = v.z;
  const along = (radius + offset) * Math.sin(angle);
  const across = (radius + offset) * Math.cos(angle) - radius;
  return new THREE.Vector3(
    arcAnchor.x + arcTangent.x * along + arcNormal.x * across,
    v.y,
    arcAnchor.z + arcTangent.z * along + arcNormal.z * across,
  );
}
function bendGeometry(original, worldMatrix) {
  const g = original.index ? original.toNonIndexed() : original.clone();
  g.applyMatrix4(worldMatrix);
  const p = g.attributes.position,
    uv = g.attributes.uv,
    positions = [],
    uvs = [];
  function append(a, b, c, depth = 0) {
    const verts = [a, b, c],
      lengths = [Math.abs(a[0] - b[0]), Math.abs(b[0] - c[0]), Math.abs(c[0] - a[0])],
      longest = Math.max(...lengths);
    if (longest > 0.85 && depth < 10) {
      const e = lengths.indexOf(longest),
        i = e,
        j = (e + 1) % 3,
        k = (e + 2) % 3,
        mid = verts[i].map((x, n) => (x + verts[j][n]) / 2);
      append(verts[i], mid, verts[k], depth + 1);
      append(mid, verts[j], verts[k], depth + 1);
      return;
    }
    for (const a of verts) {
      const q = bendPoint(new THREE.Vector3(a[0], a[1], a[2]));
      positions.push(q.x, q.y, q.z);
      if (uv) uvs.push(a[3], a[4]);
    }
  }
  for (let i = 0; i < p.count; i += 3) {
    const a = [];
    for (let j = 0; j < 3; j++)
      a.push([
        p.getX(i + j),
        p.getY(i + j),
        p.getZ(i + j),
        uv?.getX(i + j) || 0,
        uv?.getY(i + j) || 0,
      ]);
    append(...a);
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  if (uv) result.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  result.computeVertexNormals();
  result.computeBoundingSphere();
  return result;
}
// Bake the nonlinear plan into static geometry. Articulated doors retain a rigid
// local frame and hinge, so opening them remains correct after the building bends.
export function bendGroup(source) {
  source.updateMatrixWorld(true);
  function copy(node) {
    if (node.userData.doorLeaf || node.userData.rigidPlan) {
      const oldP = new THREE.Vector3().setFromMatrixPosition(node.matrixWorld),
        oldX = new THREE.Vector3(1, 0, 0).applyMatrix4(node.matrixWorld);
      // Use a local differential, not a one-metre secant. Measured rigid boxes
      // keep their dimensions, and door hinges keep their radial orientation.
      const step = oldX.sub(oldP).normalize().multiplyScalar(0.0001);
      const p = bendPoint(oldP),
        dir = bendPoint(oldP.clone().add(step)).sub(p).normalize(),
        yaw = Math.atan2(-dir.z, dir.x),
        out = node.clone(true);
      out.position.copy(p);
      out.rotation.set(0, yaw, 0);
      out.scale.set(1, 1, 1);
      if (node.userData.doorLeaf) out.userData.closedAngle = yaw;
      return out;
    }
    if (node.isMesh) {
      const out = node.clone(false);
      out.geometry = bendGeometry(node.geometry, node.matrixWorld);
      out.position.set(0, 0, 0);
      out.rotation.set(0, 0, 0);
      out.scale.set(1, 1, 1);
      out.updateMatrix();
      return out;
    }
    if (node.isLine) {
      const a = node.geometry.attributes.position,
        points = [];
      for (let i = 0; i < a.count; i++)
        points.push(
          bendPoint(new THREE.Vector3().fromBufferAttribute(a, i).applyMatrix4(node.matrixWorld)),
        );
      const out = node.clone(false);
      out.geometry = new THREE.BufferGeometry().setFromPoints(points);
      out.position.set(0, 0, 0);
      out.rotation.set(0, 0, 0);
      out.scale.set(1, 1, 1);
      out.updateMatrix();
      return out;
    }
    const out = new THREE.Group();
    out.name = node.name;
    out.userData = structuredClone(node.userData);
    for (const child of node.children) out.add(copy(child));
    return out;
  }
  return copy(source);
}

export const ROAD_PATHS = {
  east: [
    [997, -65],
    [1004, 140],
    [1001, 375],
    [985, 625],
    [959, 850],
    [936, 1030],
  ],
  diagonal: [
    [-100, 618],
    [135, 714],
    [360, 815],
    [610, 933],
    [930, 1080],
  ],
  inner: [
    [573, -35],
    [563, 116],
    [523, 242],
    [425, 319],
    [308, 344],
    [208, 329],
    [143, 275],
  ],
  branch: [
    [205, 330],
    [265, 391],
    [349, 420],
    [426, 417],
    [491, 376],
    [544, 320],
    [605, 299],
  ],
  connector: [
    [305, 343],
    [318, 392],
    [391, 449],
    [465, 471],
    [511, 471],
  ],
  southern: [
    [364, 647],
    [466, 710],
    [548, 776],
    [648, 827],
    [759, 824],
    [853, 754],
  ],
};
function smooth(points) {
  return new THREE.CatmullRomCurve3(
    points.map((p) => mapPoint(...p)),
    false,
    'catmullrom',
    0.35,
  );
}
function flatMesh(parent, name, points, y, material) {
  const shape = new THREE.Shape();
  points.forEach((p, i) => {
    const v = mapPoint(...p);
    i ? shape.lineTo(v.x, v.z) : shape.moveTo(v.x, v.z);
  });
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, y, 0);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
export function addSiteGround(ground, materials) {
  const { asphalt, curb, line } = materials,
    paver = new THREE.MeshStandardMaterial({
      name: '浅灰园路砖',
      color: 0xc6c3ad,
      roughness: 0.95,
      side: THREE.DoubleSide,
    });
  const road = new THREE.MeshStandardMaterial({
    name: '市政道路沥青',
    color: 0xc6cbc5,
    map: asphalt.map,
    roughness: 1,
    side: THREE.DoubleSide,
  });
  const edge = new THREE.MeshStandardMaterial({
    name: '道路路缘石',
    color: 0xd7d4bf,
    roughness: 0.97,
    side: THREE.DoubleSide,
  });
  const roadMark = line.clone();
  roadMark.name = '道路白色标线';
  roadMark.polygonOffset = true;
  roadMark.polygonOffsetFactor = -1;
  roadMark.polygonOffsetUnits = -4;
  roadMark.depthWrite = false;
  const paths = [];
  function ribbon(name, pixels, width, material, y = 0.0, range = [-width / 2, width / 2]) {
    const curve = smooth(pixels),
      positions = [],
      uv = [],
      segments = 110;
    for (let i = 0; i <= segments; i++) {
      const t = i / segments,
        p = curve.getPoint(t),
        d = curve.getTangent(t),
        n = new THREE.Vector3(-d.z, 0, d.x).normalize();
      for (let j = 0; j < 2; j++) {
        const v = p.clone().addScaledVector(n, range[j]);
        positions.push(v.x, y, v.z);
        uv.push((i / segments) * 18, j);
      }
    }
    const indices = [];
    for (let i = 0; i < segments; i++) {
      let a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(indices);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, material);
    m.name = name;
    m.userData = { stripRange: [...range], elevation: y };
    m.receiveShadow = true;
    ground.add(m);
    return curve;
  }
  for (const [key, width] of [
    ['east', 13.5],
    ['diagonal', 13.0],
  ]) {
    const pixels = ROAD_PATHS[key],
      name = key === 'east' ? '右侧主路' : '下方斜向道路',
      half = width / 2;
    // Road, curbs and sidewalks occupy adjacent bands rather than stacked sheets.
    for (const sign of [-1, 1]) {
      const range = (a, b) => (sign < 0 ? [-b, -a] : [a, b]),
        side = sign < 0 ? '左' : '右';
      ribbon(name + side + '侧路缘', pixels, 0.2, edge, 0.045, range(half, half + 0.2));
      ribbon(name + side + '侧人行道', pixels, 2.55, paver, 0.06, range(half + 0.2, half + 2.75));
    }
    const curve = ribbon(name, pixels, width, road, 0.025);
    paths.push({ curve, width: width + 5.7 });
    for (let i = 0.015; i < 0.99; i += 0.032) {
      const a = curve.getPoint(i),
        b = curve.getPoint(Math.min(i + 0.014, 1)),
        d = b.clone().sub(a);
      const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.1, d.length()), roadMark);
      mark.rotation.x = -Math.PI / 2;
      mark.rotation.z = Math.atan2(d.x, d.z);
      mark.position.copy(a).add(b).multiplyScalar(0.5);
      mark.position.y = 0.045;
      mark.name = '道路虚线';
      ground.add(mark);
    }
  }
  for (const [key, width] of [
    ['inner', 1.6],
    ['branch', 1.5],
    ['connector', 2.0],
    ['southern', 1.5],
  ]) {
    const pixels = ROAD_PATHS[key],
      half = width / 2;
    for (const [side, range] of [
      ['左', [-half - 0.07, -half]],
      ['右', [half, half + 0.07]],
    ])
      ribbon('园内曲线路缘 ' + side + ' ' + key, pixels, 0.07, edge, 0.015, range);
    const curve = ribbon('浅灰园路 ' + key, pixels, width, paver, 0.015);
    paths.push({ curve, width: width + 0.3 });
  }
  const forecourt = [
    [276, 350],
    [350, 355],
    [420, 337],
    [472, 305],
    [538, 283],
    [585, 301],
    [572, 344],
    [533, 381],
    [494, 419],
    [450, 448],
    [380, 445],
    [336, 416],
    [280, 409],
  ];
  const plaza = flatMesh(ground, '内弧侧不规则铺装前场', forecourt, 0.018, paver);
  // Subtle joints, clipped visually within the irregular paved forecourt.
  for (const pixels of [
    [
      [329, 367],
      [381, 435],
    ],
    [
      [373, 357],
      [426, 442],
    ],
    [
      [420, 340],
      [468, 424],
    ],
    [
      [467, 316],
      [507, 390],
    ],
  ])
    ribbon(
      '前场铺装分缝',
      pixels,
      0.025,
      new THREE.MeshBasicMaterial({ color: 0xa9b19f, side: THREE.DoubleSide }),
      0.022,
    );
  const samplePoints = paths.flatMap((p) =>
    Array.from({ length: 90 }, (_, i) => ({ point: p.curve.getPoint(i / 89), half: p.width / 2 })),
  );
  function isPaved(x, z) {
    if (samplePoints.some((s) => (s.point.x - x) ** 2 + (s.point.z - z) ** 2 < (s.half + 0.2) ** 2))
      return true;
    let inside = false;
    const px = x / SITE.metresPerPixel + 560,
      pz = z / SITE.metresPerPixel + 455;
    for (let i = 0, j = forecourt.length - 1; i < forecourt.length; j = i++) {
      const a = forecourt[i],
        b = forecourt[j];
      if (a[1] > pz !== b[1] > pz && px < ((b[0] - a[0]) * (pz - a[1])) / (b[1] - a[1]) + a[0])
        inside = !inside;
    }
    return inside;
  }
  return { isPaved, paths, plaza };
}
export function nearCanopy(x, z, padding = 6) {
  for (let i = 0; i <= 48; i++) {
    const p = curveAt(i / 48);
    if ((p.x - x) ** 2 + (p.z - z) ** 2 < padding ** 2) return true;
  }
  return false;
}
export function localView(position, target) {
  return {
    position: bendPoint(new THREE.Vector3(...position)).toArray(),
    target: bendPoint(new THREE.Vector3(...target)).toArray(),
  };
}
