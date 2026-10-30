import * as THREE from 'three';
import { SITE, mapPoint, bendGroup, addSiteGround, nearCanopy } from './site-layout.js';
import { createFacetedPanda } from './panda-faceted.js';

// Video-based proportions, in estimated metres. No survey dimensions are available.
export const PARAMETERS = {
  length: 35.0,
  width: 7.8,
  eaveHeight: 4.55,
  columnDepth: 0.48,
  archSpan: 7.4,
};
export const centerline = (x) => 0.0038 * (x + 4) ** 2 - 0.35;

function randomGenerator(seed = 4917) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
const rand = randomGenerator();
const materials = {};
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
function mat(name, options) {
  const m = new THREE.MeshStandardMaterial(options);
  m.name = name;
  materials[name] = m;
  return m;
}
function box(parent, name, x, y, z, sx, sy, sz, m) {
  const o = new THREE.Mesh(boxGeo, m);
  o.name = name;
  o.position.set(x, y, z);
  o.scale.set(sx, sy, sz);
  o.castShadow = true;
  o.receiveShadow = true;
  parent.add(o);
  return o;
}
function rod(parent, a, b, r, m, name = '构件') {
  const d = new THREE.Vector3().subVectors(b, a);
  const o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 6), m);
  o.position.copy(a).add(b).multiplyScalar(0.5);
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
  o.name = name;
  o.castShadow = true;
  parent.add(o);
  return o;
}
function canvasTexture(kind) {
  const size = kind === 'grass' ? 1024 : 512,
    c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const im = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let i = (y * size + x) * 4,
        n = rand() - 0.5,
        p =
          Math.sin(x * 0.038 + Math.sin(y * 0.019) * 3) * Math.cos(y * 0.028) * 0.5 +
          Math.sin(x * 0.007 + y * 0.012) * 0.5;
      let base = kind === 'grass' ? [105, 120, 69] : [110, 115, 112];
      let amp = kind === 'grass' ? 31 : 22;
      let v = n * amp + p * (kind === 'grass' ? 16 : 2);
      for (let k = 0; k < 3; k++) im.data[i + k] = base[k] + v;
      im.data[i + 3] = 255;
    }
  ctx.putImageData(im, 0, 0);
  if (kind === 'grass') {
    for (let i = 0; i < 50000; i++) {
      let x = rand() * size,
        y = rand() * size;
      ctx.strokeStyle = rand() > 0.5 ? 'rgba(192,185,118,.12)' : 'rgba(40,63,26,.16)';
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rand() - 0.5) * 5, y - rand() * 6);
      ctx.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(kind === 'grass' ? 12 : 7, kind === 'grass' ? 10 : 3);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
function groundShape() {
  const s = new THREE.Shape();
  s.moveTo(-19, -5.7 + centerline(-17));
  for (let x = -19; x <= 13; x += 1) s.lineTo(x, -5.7 + centerline(Math.max(-17, x)));
  for (let i = 0; i <= 40; i++) {
    let a = (i / 40) * Math.PI;
    s.lineTo(13 + 5.7 * Math.sin(a), centerline(13) - 5.7 * Math.cos(a));
  }
  for (let x = 13; x >= -19; x -= 1) s.lineTo(x, 5.7 + centerline(Math.max(-17, x)));
  s.closePath();
  return s;
}
function flatShape(parent, s, y, m, name) {
  const g = new THREE.ShapeGeometry(s, 80);
  g.rotateX(Math.PI / 2);
  const o = new THREE.Mesh(g, m);
  o.position.y = y;
  o.receiveShadow = true;
  o.name = name;
  parent.add(o);
  return o;
}
function roofShape(inset = 0) {
  const w = 3.9 - inset,
    s = new THREE.Shape();
  s.moveTo(-17 + inset, centerline(-17) - w);
  for (let x = -17 + inset; x <= 12; x += 0.5) s.lineTo(x, centerline(x) - w);
  for (let i = 0; i <= 48; i++) {
    let a = (i / 48) * Math.PI;
    s.lineTo(12 + w * Math.sin(a), centerline(12) - w * Math.cos(a));
  }
  for (let x = 12; x >= -17 + inset; x -= 0.5) s.lineTo(x, centerline(x) + w);
  s.closePath();
  return s;
}
function slab(parent, s, top, depth, m, name) {
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 64 });
  g.rotateX(Math.PI / 2);
  g.translate(0, top, 0);
  const o = new THREE.Mesh(g, m);
  o.name = name;
  o.castShadow = true;
  o.receiveShadow = true;
  parent.add(o);
  return o;
}
function archGeometry(span = 7.4, height = 4.22) {
  const h = height,
    a = span / 2,
    w = 0.79,
    s = new THREE.Shape();
  s.moveTo(-a - 0.32, 0.04);
  s.lineTo(-0.47, h);
  s.lineTo(0.47, h);
  s.lineTo(a + 0.32, 0.04);
  s.lineTo(a - 0.64, 0.04);
  s.lineTo(0.2, h - 1.04);
  s.quadraticCurveTo(0, h - 0.8, -0.2, h - 1.04);
  s.lineTo(-a + 0.64, 0.04);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, {
    depth: PARAMETERS.columnDepth,
    steps: 1,
    bevelEnabled: true,
    bevelSegments: 2,
    bevelSize: 0.015,
    bevelThickness: 0.015,
    curveSegments: 12,
  });
}
function ribbonColumn(parent, cx, side, m) {
  const g = archGeometry();
  let p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + cx;
    p.setXYZ(i, x, p.getY(i), p.getZ(i) - PARAMETERS.columnDepth / 2 + centerline(x) + side * 3.47);
  }
  g.computeVertexNormals();
  const o = new THREE.Mesh(g, m);
  o.name = `${side > 0 ? '前' : '后'}侧 W 形斜柱 ${cx.toFixed(1)}`;
  o.castShadow = true;
  o.receiveShadow = true;
  parent.add(o);
}
function leafTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const q = c.getContext('2d');
  for (let i = 0; i < 230; i++) {
    const a = rand() * Math.PI * 2,
      r = Math.sqrt(rand()) * 57,
      x = 64 + Math.cos(a) * r,
      y = 64 + Math.sin(a) * r;
    const light = Math.floor(35 + rand() * 45);
    q.fillStyle = `rgba(${light + 9},${light + 35},${light - 8},.95)`;
    q.beginPath();
    q.ellipse(x, y, 2 + rand() * 5, 1 + rand() * 2.8, rand() * 6, 0, Math.PI * 2);
    q.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createPavilion() {
  const root = new THREE.Group();
  root.name = '视频还原 · 白色折柱廊亭';
  let building = new THREE.Group();
  building.name = '建筑';
  root.add(building);
  let ground = new THREE.Group();
  ground.name = '地面与铺装';
  root.add(ground);
  const landscape = new THREE.Group();
  landscape.name = '草坪与园林';
  root.add(landscape);
  const white = mat('白色哑光铝板', { color: 0xe8e9e4, roughness: 0.72, metalness: 0.12 });
  const roofTop = mat('浅灰屋面', { color: 0xd4d8d3, roughness: 0.82, metalness: 0.12 });
  const trim = mat('金属收边', { color: 0xb6bfba, roughness: 0.55, metalness: 0.45 });
  const dark = mat('深灰网格吊顶', { color: 0x333d3b, roughness: 0.9 });
  const seam = mat('铝板接缝', { color: 0x9aa49e, roughness: 0.88 });
  const glass = mat('淡绿玻璃', {
    color: 0x9bbeb4,
    metalness: 0.2,
    roughness: 0.12,
    transparent: true,
    opacity: 0.23,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const steel = mat('窗框与门框', { color: 0xc5cfca, metalness: 0.65, roughness: 0.35 });
  const louver = mat('白色烤漆栅格', { color: 0xe8ebe6, metalness: 0.22, roughness: 0.63 });
  const louverRecess = mat('栅格内侧遮挡层', { color: 0x727b74, metalness: 0.05, roughness: 0.94 });
  const asphalt = mat('沥青铺地', {
    map: canvasTexture('asphalt'),
    roughness: 0.96,
    side: THREE.DoubleSide,
  });
  const grassMap = canvasTexture('grass');
  const grass = mat('自然草坪', { map: grassMap, roughness: 1 });
  const line = mat('白色地面标线', { color: 0xe7e4d5, roughness: 0.95, side: THREE.DoubleSide });
  const curb = mat('浅灰混凝土路缘', { color: 0xbfc3b3, roughness: 0.95, side: THREE.DoubleSide });
  const dirt = mat('树池土壤', { color: 0x736d4a, roughness: 1 });
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(180, 170, 12, 12), grass);
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.y = -0.055;
  lawn.name = '草坪地面';
  lawn.receiveShadow = true;
  landscape.add(lawn);
  // Asphalt matches the curved pavilion, with a slim exposed concrete perimeter.
  flatShape(ground, groundShape(), -0.015, curb, '弧形路缘');
  const paving = groundShape();
  flatShape(ground, paving, 0.002, asphalt, '廊亭下沥青路面').scale.set(0.99, 1, 0.98);
  // UV coordinates derived from world coordinates keep asphalt granularity consistent.
  for (const mesh of ground.children) {
    const a = mesh.geometry.attributes.position,
      uv = mesh.geometry.attributes.uv;
    for (let i = 0; i < a.count; i++) uv.setXY(i, (a.getX(i) + 22) / 43, (a.getZ(i) + 9) / 18);
    uv.needsUpdate = true;
  }
  for (const side of [-1, 1]) {
    const points = [];
    for (let x = -18.9; x <= 13; x += 0.3)
      points.push(new THREE.Vector3(x, 0.014, centerline(x) + side * 5.53));
    const strip = new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 110, 0.055, 4, false),
      line,
    );
    strip.name = '沿路缘白线';
    strip.scale.y = 0.025;
    strip.position.y = 0.018;
    ground.add(strip);
  }
  for (let x = -5.4; x <= 12; x += 4.65) {
    const z = centerline(x);
    const mark = box(ground, '停车分隔线', x, 0.018, z + 0.15, 0.075, 0.008, 9.2, line);
    mark.rotation.y = -Math.atan(0.0076 * (x + 4));
  }

  // Continuous curved roof, a thin cap, and the dark recessed soffit.
  slab(building, roofShape(), 4.57, 0.38, white, '弧形屋面与白色檐口');
  slab(building, roofShape(-0.025), 4.615, 0.055, roofTop, '屋面顶板与金属压边');
  slab(building, roofShape(0.22), 4.205, 0.06, dark, '内凹网格吊顶底板');
  // Dense open grid beneath the canopy: individual strips cast natural fine shadows.
  for (let x = -16.8; x <= 15.3; x += 0.36) {
    let half = 3.64;
    if (x > 12) half = Math.sqrt(Math.max(0, 3.64 ** 2 - (x - 12) ** 2));
    if (half < 0.2) continue;
    box(
      building,
      '横向吊顶格栅',
      x,
      4.155,
      centerline(Math.min(x, 12)),
      0.025,
      0.075,
      half * 2,
      dark,
    );
  }
  for (let zoff = -3.55; zoff <= 3.56; zoff += 0.36) {
    let end = 12 + Math.sqrt(Math.max(0, 3.64 ** 2 - zoff ** 2));
    const coords = [];
    for (let x = -16.8; x <= end; x += 0.4)
      coords.push(new THREE.Vector3(x, 4.135, centerline(Math.min(x, 12)) + zoff));
    const g = new THREE.BufferGeometry().setFromPoints(coords);
    const o = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x65716a }));
    o.name = '纵向吊顶格栅';
    building.add(o);
  }
  for (let side of [-1, 1])
    for (let cx of [-12.7, -5.3, 2.1, 9.5]) ribbonColumn(building, cx, side, white);
  // Curved return at the right end, with a crosswise diagonal support.
  const endGeo = archGeometry(5.7, 4.22);
  endGeo.rotateY(Math.PI / 2);
  endGeo.translate(14.35, 0, centerline(12));
  const endArch = new THREE.Mesh(endGeo, white);
  endArch.name = '端部横向折柱';
  endArch.castShadow = true;
  endArch.receiveShadow = true;
  building.add(endArch);
  // Subtle panel joints across the wide white diagonal members.
  for (let side of [-1, 1])
    for (let cx of [-12.7, -5.3, 2.1, 9.5]) {
      for (let sign of [-1, 1])
        for (let y of [1.25, 2.55]) {
          let x = cx + sign * (3.7 - y * 0.8);
          const o = box(
            building,
            '斜柱铝板拼缝',
            x,
            y,
            centerline(x) + side * (3.47 + 0.253),
            0.77,
            0.012,
            0.012,
            seam,
          );
          o.rotation.z = -sign * 0.035;
        }
    }
  for (let side of [-1, 1])
    for (let x = -16; x < 13; x += 1.65) {
      const seamline = box(
        building,
        '檐口分缝',
        x,
        4.38,
        centerline(x) + side * 3.905,
        0.012,
        0.3,
        0.008,
        seam,
      );
    }
  // Glazed enclosed room occupies the straight starting bay, as in the opening shot.
  const roomX = -13.45,
    roomW = 6.55,
    roomZ = centerline(roomX),
    roomD = 6.68;
  box(building, '玻璃房室内地坪', roomX, 0.045, roomZ, roomW, 0.08, roomD, curb);
  for (let side of [-1, 1]) {
    if (side > 0) continue; // The front long side is rebuilt below around a real side doorway.
    let z = roomZ + (side * roomD) / 2;
    box(building, '玻璃房侧面玻璃', roomX, 2.01, z, roomW, 3.92, 0.035, glass);
    for (let x = -16.72; x <= -10.12; x += 1.32)
      box(building, '玻璃竖向接缝', x, 2.02, z, 0.022, 3.96, 0.042, steel);
    box(building, '玻璃底部轨道', roomX, 0.12, z, roomW, 0.055, 0.065, steel);
    box(building, '玻璃顶部轨道', roomX, 4.0, z, roomW, 0.06, 0.055, steel);
  }
  box(building, '端面玻璃', -16.73, 2.03, roomZ, 0.035, 3.94, roomD, glass);
  for (let z = roomZ - roomD / 2; z <= roomZ + roomD / 2; z += 1.34)
    box(building, '端面玻璃接缝', -16.75, 2.03, z, 0.04, 3.95, 0.024, steel);
  // The user identifies the video start as the building's back: the rear third
  // is the outer-arc side facing that camera, not the inner-arc side. Keep the
  // remaining two thirds available for the double-door entrance opposite it.
  const enclosure = new THREE.Group();
  enclosure.name = '白色栅格围合区';
  building.add(enclosure);
  const screenStart = -10.18,
    screenEnd = -7.74,
    screenMid = (screenStart + screenEnd) / 2;
  const screenW = screenEnd - screenStart,
    screenD = roomD / 3,
    screenH = 4.1,
    screenBase = 0.075;
  const roomRear = roomZ - roomD / 2,
    roomFront = roomZ + roomD / 2;
  const screenZ = roomFront - screenD / 2,
    screenCenterY = screenBase + screenH / 2;
  const entryBack = roomRear,
    entryFront = roomFront - screenD,
    entryDepth = roomD - screenD,
    entryZ = (entryBack + entryFront) / 2;
  enclosure.userData = {
    access: 'closed',
    interiorUse: 'unspecified',
    source: 'user-confirmed layout',
    widthFraction: 1 / 3,
    glassRoomWidth: roomD,
    facing: 'video-start-side',
  };
  // Opaque inset walls and floor/top caps make this a genuinely enclosed volume.
  // The three visible louver skins stand proud of the backing for readable depth.
  box(
    enclosure,
    '栅格区封闭内体',
    screenMid,
    screenCenterY,
    screenZ,
    screenW - 0.16,
    screenH - 0.06,
    screenD - 0.18,
    louverRecess,
  );
  box(
    enclosure,
    '与玻璃房相邻的封闭侧墙',
    screenStart + 0.04,
    screenCenterY,
    screenZ,
    0.08,
    screenH,
    screenD,
    white,
  );
  box(
    enclosure,
    '栅格区独立基座',
    screenMid,
    0.07,
    screenZ,
    screenW + 0.06,
    0.14,
    screenD + 0.06,
    curb,
  );
  box(
    enclosure,
    '栅格区顶部封板',
    screenMid,
    screenBase + screenH - 0.035,
    screenZ,
    screenW,
    0.07,
    screenD,
    louver,
  );
  function louverSkin(name, cx, cz, width, rotation) {
    const face = new THREE.Group();
    face.name = name;
    face.position.set(cx, 0, cz);
    face.rotation.y = rotation;
    enclosure.add(face);
    for (let y = screenBase + 0.06; y < screenBase + screenH - 0.04; y += 0.095) {
      const blade = box(face, '白色水平栅格片', 0, y, 0, width, 0.057, 0.1, louver);
      blade.rotation.x = -0.16;
    }
    for (const x of [-width / 2, 0, width / 2])
      box(face, '栅格竖向收边', x, screenCenterY, 0.025, 0.045, screenH, 0.125, louver);
    box(face, '栅格底部收边', 0, screenBase + 0.025, 0.025, width, 0.05, 0.125, louver);
    box(face, '栅格顶部收边', 0, screenBase + screenH - 0.025, 0.025, width, 0.05, 0.125, louver);
  }
  louverSkin('视频起点侧白色栅格立面', screenMid, screenZ + screenD / 2, screenW, 0);
  louverSkin('入口一侧白色栅格立面', screenMid, screenZ - screenD / 2, screenW, Math.PI);
  louverSkin('朝开放廊道的白色栅格端面', screenEnd, screenZ, screenD, Math.PI / 2);
  // This floor joins the main glass room without a transverse blocking wall.
  const entry = new THREE.Group();
  entry.name = '栅格前方玻璃房入口';
  building.add(entry);
  entry.userData = { access: 'walk-in', widthFraction: 2 / 3 };
  box(entry, '与玻璃房连通的入口地坪', screenMid, 0.045, entryZ, screenW, 0.08, entryDepth, curb);
  function glazedEntrance(name, cx, cz, width, rotation, leafCount) {
    const face = new THREE.Group();
    face.name = name;
    face.position.set(cx, 0, cz);
    face.rotation.y = rotation;
    entry.add(face);
    const base = 0.09,
      totalH = 4.04,
      doorH = 2.7,
      doorW = leafCount === 2 ? Math.min(width - 0.14, 2.2) : 1.05;
    const fixedW = (width - doorW) / 2,
      leafW = doorW / leafCount;
    for (const sign of [-1, 1]) {
      box(
        face,
        '玻璃入口外框',
        (sign * width) / 2,
        base + totalH / 2,
        0,
        0.042,
        totalH,
        0.065,
        steel,
      );
      box(
        face,
        '门洞竖向门框',
        (sign * doorW) / 2,
        base + doorH / 2,
        0,
        0.037,
        doorH,
        0.065,
        steel,
      );
      if (fixedW > 0.06) {
        box(
          face,
          '门侧固定玻璃',
          (sign * (doorW + fixedW)) / 2,
          base + doorH / 2,
          0,
          fixedW - 0.025,
          doorH - 0.035,
          0.032,
          glass,
        );
        box(
          face,
          '固定玻璃底轨',
          (sign * (doorW + fixedW)) / 2,
          base + 0.012,
          0,
          fixedW,
          0.025,
          0.05,
          steel,
        );
      }
    }
    box(
      face,
      '门上固定玻璃',
      0,
      base + doorH + (totalH - doorH) / 2,
      0,
      width - 0.04,
      totalH - doorH - 0.04,
      0.032,
      glass,
    );
    box(face, '门洞上框', 0, base + doorH, 0, width, 0.04, 0.065, steel);
    box(face, '入口顶部收边', 0, base + totalH, 0, width, 0.04, 0.065, steel);
    // Each leaf has its own hinge; there is no stationary glazing across the doorway.
    for (let i = 0; i < leafCount; i++) {
      const right = leafCount === 2 && i === 1,
        dir = right ? -1 : 1;
      const hinge = new THREE.Group();
      hinge.name = leafCount === 2 ? `双开玻璃门${right ? '右' : '左'}扇` : '玻璃房侧门门扇';
      hinge.position.set(right ? doorW / 2 : -doorW / 2, 0, 0.025);
      hinge.userData = { doorLeaf: true, openAngle: right ? 1.45 : -1.45 };
      face.add(hinge);
      box(
        hinge,
        '可开启玻璃门扇',
        (dir * leafW) / 2,
        base + doorH / 2,
        0,
        leafW - 0.025,
        doorH - 0.045,
        0.035,
        glass,
      );
      for (const x of [dir * 0.018, dir * (leafW - 0.018)])
        box(hinge, '门扇细边框', x, base + doorH / 2, 0, 0.026, doorH, 0.043, steel);
      for (const y of [base + 0.018, base + doorH - 0.018])
        box(hinge, '门扇上下边框', (dir * leafW) / 2, y, 0, leafW, 0.028, 0.043, steel);
      const handleX = dir * (leafW - 0.16);
      for (const z of [-0.07, 0.07])
        box(hinge, '玻璃门竖向拉手', handleX, 1.18, z, 0.025, 0.4, 0.025, steel);
      for (const y of [0.58, 2.28])
        box(hinge, '玻璃门铰链', dir * 0.02, y, 0, 0.05, 0.075, 0.07, steel);
    }
  }
  // The louver occupies the video-facing rear side; the doors use the other side.
  // The separate side door is in the long glass facade, clear of the W-column foot.
  glazedEntrance('栅格区前方双开玻璃门', screenEnd, entryZ, entryDepth, Math.PI / 2, 2);
  glazedEntrance('玻璃房侧面独立入口', roomX, roomFront, roomW, 0, 1);
  box(entry, '入口内弧侧固定玻璃', screenMid, 2.07, roomRear, screenW, 3.95, 0.032, glass);
  for (const x of [screenStart, screenEnd])
    box(entry, '入口玻璃转角收边', x, 2.07, roomRear, 0.035, 4.02, 0.05, steel);
  box(entry, '入口固定玻璃底轨', screenMid, 0.105, roomRear, screenW, 0.035, 0.05, steel);
  // Restrained interior detail visible through the glazing.
  const furniture = mat('室内深灰金属', { color: 0x4e5c53, roughness: 0.82 });
  box(building, '室内长凳', -14.2, 0.52, roomZ - 1.6, 3.3, 0.11, 0.55, furniture);
  for (let x of [-15.35, -13.05])
    box(building, '长凳支脚', x, 0.27, roomZ - 1.6, 0.07, 0.46, 0.4, furniture);
  // Roof panel seams are shallow, visible mainly in the aerial view.
  for (let x = -15.5; x < 13; x += 2.2)
    box(building, '屋面板接缝', x, 4.618, centerline(x), 0.009, 0.003, 7.6, seam);
  // The supplied map corrects the whole plan, including the former almost-straight roof.
  const oldBuilding = building,
    oldGround = ground;
  building = bendGroup(oldBuilding);
  ground = bendGroup(oldGround);
  root.remove(oldBuilding, oldGround);
  root.add(building, ground);
  const siteGround = addSiteGround(ground, { asphalt, curb, line });
  root.userData = {
    reference: 'user-supplied satellite screenshot and video',
    planScale: 'estimated',
    imageTop: 'reference direction only',
    videoStartPixel: SITE.videoStartPixel,
  };
  // Landscape is a separate group and can be hidden for architectural inspection.
  const bark = mat('树干', { color: 0x716b57, roughness: 1 });
  const support = mat('绿色树木支架', { color: 0x3e684d, roughness: 0.82 });
  const leafMat = new THREE.MeshStandardMaterial({
    map: leafTexture(),
    alphaTest: 0.4,
    side: THREE.DoubleSide,
    roughness: 1,
    color: 0xaebc91,
  });
  leafMat.name = '疏朗树叶';
  const distantFoliage = mat('树带绿色树冠', { color: 0x6e8456, roughness: 1 });
  function tree(x, z, h = 6.7, seedAngle = 0, detailed = true) {
    const group = new THREE.Group();
    group.name = '园林乔木';
    group.position.set(x, 0, z);
    group.userData.detailed = detailed;
    landscape.add(group);
    const disk = new THREE.Mesh(new THREE.CircleGeometry(0.67, 20), dirt);
    disk.rotation.x = -Math.PI / 2;
    disk.position.y = -0.035;
    group.add(disk);
    if (!detailed) {
      rod(
        group,
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0.05, h * 0.7, 0),
        0.11,
        bark,
        '树带树干',
      );
      for (let i = 0; i < 2; i++) {
        const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1.65, 1), distantFoliage);
        crown.position.set(i * 0.65 - 0.3, h * 0.72 + i * 0.8, (i - 0.5) * 0.5);
        crown.scale.set(1.1, 0.9, 1.05);
        crown.castShadow = true;
        crown.name = '树带树冠';
        group.add(crown);
      }
      return;
    }
    rod(
      group,
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.13, h * 0.7, 0.1),
      0.105,
      bark,
      '树干',
    );
    for (let i = 0; i < 8; i++) {
      let a = seedAngle + i * 2.399,
        sy = h * (0.4 + rand() * 0.25),
        tip = new THREE.Vector3(
          Math.cos(a) * (1.1 + rand() * 0.8),
          h * (0.75 + rand() * 0.22),
          Math.sin(a) * (1.1 + rand() * 0.8),
        );
      rod(group, new THREE.Vector3(0.08, sy, 0), tip, 0.035, bark, '树枝');
      for (let j = 0; j < 3; j++) {
        const leaf = new THREE.Mesh(
          new THREE.PlaneGeometry(1.6 + rand() * 0.8, 1.4 + rand() * 0.8),
          leafMat,
        );
        leaf.position
          .copy(tip)
          .add(new THREE.Vector3((rand() - 0.5) * 1.3, (rand() - 0.5) * 0.7, (rand() - 0.5) * 1.3));
        leaf.rotation.set((rand() - 0.5) * 1.1, a + j * 1.1, rand() * 0.6);
        leaf.name = '疏朗树叶';
        leaf.castShadow = true;
        group.add(leaf);
      }
    }
    if (z > 7 && Math.abs(x) < 22) {
      for (let i = 0; i < 3; i++) {
        let a = (i / 3) * Math.PI * 2;
        rod(
          group,
          new THREE.Vector3(Math.cos(a) * 1.05, 0, Math.sin(a) * 1.05),
          new THREE.Vector3(0.06, 2.5, 0.03),
          0.025,
          support,
          '树木支撑杆',
        );
      }
    }
  }
  // Main tree belts follow the screenshot: northwest garden, southwest grove,
  // southern triangular island, and the sparse clumps by the eastern road.
  const treePixels = [];
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 5; col++)
      treePixels.push([65 + col * 63 + (row % 2) * 18, 20 + row * 64]);
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 6; col++)
      treePixels.push([75 + col * 61 + (row % 2) * 15, 475 + row * 62]);
  for (const p of [
    [605, 778],
    [657, 799],
    [710, 817],
    [755, 844],
    [681, 867],
    [731, 888],
    [783, 880],
    [810, 838],
    [624, 845],
    [575, 805],
    [842, 443],
    [817, 480],
    [857, 511],
    [830, 558],
    [866, 603],
    [798, 650],
    [776, 715],
  ])
    treePixels.push(p);
  for (const p of treePixels) {
    const v = mapPoint(...p);
    if (!siteGround.isPaved(v.x, v.z) && !nearCanopy(v.x, v.z, 8))
      tree(v.x, v.z, 5.6 + rand() * 2.0, rand() * 6, false);
  }
  for (const p of [
    [575, 573],
    [722, 451],
    [435, 543],
  ]) {
    const v = mapPoint(...p);
    tree(v.x, v.z, 6.4 + rand(), rand() * 6, true);
  }
  // Fine, distributed grass blades break up the plane without external textures.
  const bladeGeo = new THREE.BufferGeometry();
  bladeGeo.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([-0.018, 0, 0, 0.018, 0, 0, 0.008, 0.1, 0], 3),
  );
  bladeGeo.computeVertexNormals();
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0x7d8e4b,
    side: THREE.DoubleSide,
    roughness: 1,
  });
  bladeMat.name = '草叶';
  const count = 24000,
    blades = new THREE.InstancedMesh(bladeGeo, bladeMat, count),
    dummy = new THREE.Object3D();
  let k = 0;
  for (let i = 0; i < count * 2 && k < count; i++) {
    let x = (rand() - 0.5) * 155,
      z = (rand() - 0.5) * 143;
    if (nearCanopy(x, z, 6) || siteGround.isPaved(x, z)) continue;
    dummy.position.set(x, -0.025, z);
    dummy.rotation.y = rand() * Math.PI;
    dummy.scale.setScalar(0.5 + rand() * 1.3);
    dummy.updateMatrix();
    blades.setMatrixAt(k++, dummy.matrix);
  }
  blades.count = k;
  blades.name = '细草叶';
  blades.receiveShadow = true;
  landscape.add(blades);

  // The Loom OS panda stands in front of the glass-room entrance, facing the default views.
  // Its model is about 4.3 units tall; 0.42 makes it a 1.8 m statue.
  const panda = createFacetedPanda();
  panda.position.set(-1.5, 0, 9.5);
  panda.rotation.y = 0.85;
  panda.scale.setScalar(0.42);
  root.add(panda);
  return {
    root,
    building,
    ground,
    landscape,
    panda,
    materials,
    parameters: PARAMETERS,
    layout: SITE,
  };
}
