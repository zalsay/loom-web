import * as THREE from 'three';
import { SITE, mapPoint, bendPoint, bendGroup, addSiteGround, nearCanopy } from './site-layout.js';
import { createRooftopPanda } from './panda-rooftop.js';
import { createAppleStore, addAppleStoreLighting } from './apple-store.js';
import { GLASS_ROOM, PAVILION, LOUVER, ENTRANCE } from './pavilion-dimensions.js';

// Measured room, roof and facade modules share one calibrated circular plan.
export const PARAMETERS = {
  length: PAVILION.length,
  width: PAVILION.width,
  eaveHeight: PAVILION.roofBodyTop,
  columnDepth: PAVILION.columnDepth,
  archSpan: PAVILION.archSpan,
  glassRoom: GLASS_ROOM,
};
export const centerline = () => 0;

function randomGenerator(seed = 4917) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
function canvasTexture(kind, rand) {
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
      let base = kind === 'grass' ? [112, 156, 78] : [137, 145, 138];
      let amp = kind === 'grass' ? 9 : 8;
      // Broad meadow variation lives in world-space vertex colours, not a repeating tile.
      let v = n * amp + p * 0.7;
      for (let k = 0; k < 3; k++) im.data[i + k] = base[k] + v;
      im.data[i + 3] = 255;
    }
  ctx.putImageData(im, 0, 0);
  if (kind === 'grass') {
    for (let i = 0; i < 50000; i++) {
      let x = rand() * size,
        y = rand() * size;
      ctx.strokeStyle = rand() > 0.5 ? 'rgba(211,226,153,.10)' : 'rgba(66,106,46,.08)';
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
  const s = new THREE.Shape(),
    start = PAVILION.startX - 2,
    cap = PAVILION.capCenterX;
  s.moveTo(start, -5.7);
  s.lineTo(cap, -5.7);
  for (let i = 0; i <= 40; i++) {
    let a = (i / 40) * Math.PI;
    s.lineTo(cap + 5.7 * Math.sin(a), -5.7 * Math.cos(a));
  }
  s.lineTo(start, 5.7);
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
  const w = PAVILION.width / 2 - inset,
    s = new THREE.Shape();
  s.moveTo(PAVILION.startX + inset, -w);
  s.lineTo(PAVILION.capCenterX, -w);
  for (let i = 0; i <= 48; i++) {
    let a = (i / 48) * Math.PI;
    s.lineTo(PAVILION.capCenterX + w * Math.sin(a), -w * Math.cos(a));
  }
  s.lineTo(PAVILION.startX + inset, w);
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
function archGeometry(fraction = 1, span = PAVILION.archSpan, height = PAVILION.soffitY) {
  const h = height,
    a = span / 2,
    s = new THREE.Shape();
  s.moveTo(-a, 0.04);
  s.lineTo(-0.16, h);
  if (fraction === 1) {
    s.lineTo(0.16, h);
    s.lineTo(a, 0.04);
    s.lineTo(a - PAVILION.columnFootWidth, 0.04);
    s.lineTo(0.08, h - 0.65);
  } else {
    s.lineTo(0, h);
    s.lineTo(0, h - 0.65);
  }
  s.lineTo(-0.08, h - 0.65);
  s.lineTo(-a + PAVILION.columnFootWidth, 0.04);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, {
    depth: PARAMETERS.columnDepth,
    steps: 1,
    bevelEnabled: false,
    curveSegments: 12,
  });
}
function ribbonColumn(parent, cx, side, m, index, fraction = 1) {
  const g = archGeometry(fraction);
  let p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) + cx;
    p.setXYZ(
      i,
      x,
      p.getY(i),
      p.getZ(i) - PARAMETERS.columnDepth / 2 + side * PAVILION.columnOffset,
    );
  }
  g.computeVertexNormals();
  const o = new THREE.Mesh(g, m);
  o.name = `${side > 0 ? '前' : '后'}侧 W 形斜柱 ${cx.toFixed(1)}`;
  o.userData = { structuralModule: true, index, side, fraction };
  o.castShadow = true;
  o.receiveShadow = true;
  parent.add(o);
}
// Coherent field shared by the lawn and its short tufts; independent of texture UVs.
function meadowTone(x, z) {
  return THREE.MathUtils.clamp(
    0.5 +
      0.24 * Math.sin(x * 0.08 + 0.7 * Math.sin(z * 0.06)) +
      0.18 * Math.cos(z * 0.11 - x * 0.04) +
      0.08 * Math.sin((x + z) * 0.19),
    0,
    1,
  );
}

function crownGeometry(detail) {
  const geometry = new THREE.IcosahedronGeometry(1, detail);
  const p = geometry.getAttribute('position');
  const colors = [];
  const shade = new THREE.Color('#315e38'),
    light = new THREE.Color('#88b95b');
  const color = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i),
      y = p.getY(i),
      z = p.getZ(i);
    const ripple = 1 + 0.17 * Math.sin(x * 8 + z * 3) * Math.cos(y * 6 - z * 5);
    p.setXYZ(i, x * ripple, y * ripple, z * ripple);
    color
      .copy(shade)
      .lerp(
        light,
        THREE.MathUtils.clamp(
          (y + 0.8) / 1.8 + 0.13 * Math.sin(x * 19 + z * 11) * Math.sin(y * 15 - z * 7),
          0,
          1,
        ),
      );
    colors.push(color.r, color.g, color.b);
  }
  // Retain the sphere's smooth normals: clumps should read as foliage, not faceted rock.
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingSphere();
  return geometry;
}

export function createPavilion({ seed = 4917 } = {}) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new TypeError('seed must be an unsigned 32-bit integer');
  }
  const rand = randomGenerator(seed);
  const materials = {};
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const mat = (name, options) => {
    const material = new THREE.MeshStandardMaterial(options);
    material.name = name;
    materials[name] = material;
    return material;
  };
  const box = (parent, name, x, y, z, sx, sy, sz, material) => {
    const object = new THREE.Mesh(boxGeo, material);
    object.name = name;
    object.position.set(x, y, z);
    object.scale.set(sx, sy, sz);
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  };
  const rod = (parent, a, b, radius, material, name = '构件') => {
    const direction = new THREE.Vector3().subVectors(b, a);
    const object = new THREE.Mesh(
      new THREE.CylinderGeometry(radius, radius, direction.length(), 6),
      material,
    );
    object.position.copy(a).add(b).multiplyScalar(0.5);
    object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    object.name = name;
    object.castShadow = true;
    parent.add(object);
    return object;
  };
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
  const roofSurface = mat('白色屋面', { color: 0xe8e9e4, roughness: 0.72, metalness: 0.12 });
  const roofTop = mat('浅灰屋面', { color: 0xd4d8d3, roughness: 0.82, metalness: 0.12 });
  const trim = mat('金属收边', { color: 0xb6bfba, roughness: 0.55, metalness: 0.45 });
  const dark = mat('深灰网格吊顶', { color: 0x333d3b, roughness: 0.9 });
  const seam = mat('铝板接缝', { color: 0x9aa49e, roughness: 0.88 });
  const glass = mat('淡绿玻璃', {
    color: 0xd6e5e4,
    metalness: 0.08,
    roughness: 0.06,
    transparent: true,
    opacity: 0.12,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const steel = mat('窗框与门框', { color: 0xc5cfca, metalness: 0.65, roughness: 0.35 });
  const louver = mat('白色烤漆栅格', { color: 0xe8ebe6, metalness: 0.22, roughness: 0.63 });
  const louverRecess = mat('栅格内侧遮挡层', { color: 0x727b74, metalness: 0.05, roughness: 0.94 });
  const asphalt = mat('沥青铺地', {
    map: canvasTexture('asphalt', rand),
    roughness: 0.96,
    side: THREE.DoubleSide,
  });
  const grassMap = canvasTexture('grass', rand);
  const grass = mat('自然草坪', { map: grassMap, roughness: 1, vertexColors: true });
  const line = mat('白色地面标线', { color: 0xe7e4d5, roughness: 0.95, side: THREE.DoubleSide });
  const curb = mat('浅灰混凝土路缘', { color: 0xd0ceba, roughness: 0.95, side: THREE.DoubleSide });
  const dirt = mat('树池土壤', { color: 0x736d4a, roughness: 1 });
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(180, 170, 30, 28), grass);
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.y = -0.055;
  lawn.name = '草坪地面';
  const lawnVertices = lawn.geometry.getAttribute('position');
  const lawnColors = [];
  const lawnShade = new THREE.Color('#d9e8bc'),
    lawnLight = new THREE.Color('#ffffff');
  const lawnColor = new THREE.Color();
  for (let i = 0; i < lawnVertices.count; i++) {
    lawnColor
      .copy(lawnShade)
      .lerp(lawnLight, meadowTone(lawnVertices.getX(i), -lawnVertices.getY(i)));
    lawnColors.push(lawnColor.r, lawnColor.g, lawnColor.b);
  }
  lawn.geometry.setAttribute('color', new THREE.Float32BufferAttribute(lawnColors, 3));
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
    for (let x = PAVILION.startX - 1.9; x <= PAVILION.capCenterX; x += 0.3)
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
  for (let x = GLASS_ROOM.endX + 1; x <= PAVILION.capCenterX; x += PAVILION.archSpan) {
    const z = centerline(x);
    const mark = box(ground, '停车分隔线', x, 0.018, z + 0.15, 0.075, 0.008, 9.2, line);
  }

  // Continuous curved roof, a thin cap, and the dark recessed soffit.
  slab(
    building,
    roofShape(),
    PAVILION.roofBodyTop,
    PAVILION.roofBodyDepth,
    roofSurface,
    '弧形屋面与白色檐口',
  );
  slab(building, roofShape(), PAVILION.roofTop, 0.055, roofTop, '屋面顶板与金属压边');
  slab(building, roofShape(0.22), PAVILION.soffitY + 0.015, 0.06, dark, '内凹网格吊顶底板');
  // Dense open grid beneath the canopy: individual strips cast natural fine shadows.
  for (let x = PAVILION.startX + 0.2; x <= PAVILION.endX - 0.26; x += 0.36) {
    let half = 3.64;
    if (x > PAVILION.capCenterX)
      half = Math.sqrt(Math.max(0, 3.64 ** 2 - (x - PAVILION.capCenterX) ** 2));
    if (half < 0.2) continue;
    box(building, '横向吊顶格栅', x, PAVILION.soffitY - 0.035, 0, 0.025, 0.075, half * 2, dark);
  }
  for (let zoff = -3.55; zoff <= 3.56; zoff += 0.36) {
    let end = PAVILION.capCenterX + Math.sqrt(Math.max(0, 3.64 ** 2 - zoff ** 2));
    const coords = [];
    for (let x = PAVILION.startX + 0.2; x <= end; x += 0.4)
      coords.push(new THREE.Vector3(x, PAVILION.soffitY - 0.055, zoff));
    const g = new THREE.BufferGeometry().setFromPoints(coords);
    const o = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x65716a }));
    o.name = '纵向吊顶格栅';
    building.add(o);
  }
  // Start the five full triangles and rising half triangle at the glass room,
  // not after it. Leave the measured roof's remaining end bay open; do not
  // stretch the clear openings or add another triangle to fill the round end.
  for (const side of [-1, 1])
    for (let index = 0; index < Math.ceil(PAVILION.triangleCount); index++) {
      const fraction = Math.min(1, PAVILION.triangleCount - index);
      const cx = PAVILION.moduleStartX + (index + 0.5) * PAVILION.archSpan;
      ribbonColumn(building, cx, side, white, index, fraction);
    }
  for (let side of [-1, 1])
    for (let x = PAVILION.startX + 1; x < PAVILION.capCenterX; x += 1.65) {
      const seamline = box(
        building,
        '檐口分缝',
        x,
        PAVILION.soffitY + PAVILION.roofThickness / 2,
        centerline(x) + side * 3.905,
        0.012,
        PAVILION.roofThickness - 0.1,
        0.008,
        seam,
      );
    }
  // The measured footprint includes the end entrance and louver bay: do not
  // append them outside the 7.6/6.5 m envelope. Only the shop occupies this span.
  const roomX = GLASS_ROOM.storeCenterX,
    roomW = GLASS_ROOM.storeWidth,
    roomZ = 0,
    roomD = GLASS_ROOM.width;
  const roomBase = GLASS_ROOM.floorY,
    roomTop = GLASS_ROOM.ceilingY,
    paneH = roomTop - roomBase,
    paneY = (roomTop + roomBase) / 2;
  const laboratory = new THREE.Group();
  laboratory.name = '织界实验室';
  laboratory.userData.laboratory = true;
  building.add(laboratory);
  building.userData.glassRoom = { ...GLASS_ROOM, interpretation: 'concentric-internal-arcs' };
  box(
    laboratory,
    '玻璃房室内地坪',
    GLASS_ROOM.centerX,
    0.0425,
    0,
    GLASS_ROOM.centerlineLength,
    0.085,
    roomD,
    curb,
  );
  for (let side of [-1, 1]) {
    let z = roomZ + side * (roomD / 2 + 0.0175);
    if (side > 0) {
      const facade = new THREE.Group();
      facade.name = '玻璃房正面固定玻璃立面';
      facade.position.set(roomX, 0, z);
      laboratory.add(facade);
      box(facade, '正面固定玻璃', 0, paneY, 0, roomW, paneH, 0.035, glass);
      const bays = Math.ceil(roomW / 1.32);
      for (let i = 0; i <= bays; i++)
        box(
          facade,
          '正面固定玻璃竖向接缝',
          -roomW / 2 + (i * roomW) / bays,
          paneY,
          0.022,
          0.022,
          paneH,
          0.042,
          steel,
        );
      box(facade, '正面固定玻璃底部轨道', 0, 0.12, 0, roomW, 0.055, 0.065, steel);
      box(facade, '正面固定玻璃顶部轨道', 0, roomTop + 0.03, 0, roomW, 0.06, 0.055, steel);
    } else {
      box(laboratory, '玻璃房侧面玻璃', roomX, paneY, z, roomW, paneH, 0.035, glass);
      const bays = Math.ceil(roomW / 1.32);
      for (let i = 0; i <= bays; i++)
        box(
          laboratory,
          '玻璃竖向接缝',
          GLASS_ROOM.startX + (i * roomW) / bays,
          paneY,
          z,
          0.022,
          paneH,
          0.042,
          steel,
        );
      box(laboratory, '玻璃底部轨道', roomX, 0.12, z, roomW, 0.055, 0.065, steel);
      box(laboratory, '玻璃顶部轨道', roomX, roomTop + 0.03, z, roomW, 0.06, 0.055, steel);
    }
  }
  box(laboratory, '端面玻璃', GLASS_ROOM.startX - 0.0175, paneY, roomZ, 0.035, paneH, roomD, glass);
  for (let z = roomZ - roomD / 2; z <= roomZ + roomD / 2; z += 1.34)
    box(laboratory, '端面玻璃接缝', GLASS_ROOM.startX - 0.02, paneY, z, 0.04, paneH, 0.024, steel);
  // A measured, rigid 2.2 m x 1.6 m enclosure sits fully inside the curved room.
  const enclosure = new THREE.Group();
  enclosure.name = '白色栅格围合区';
  laboratory.add(enclosure);
  const screenStart = GLASS_ROOM.partitionX,
    screenEnd = GLASS_ROOM.endX,
    screenMid = LOUVER.centerX,
    entryLength = screenEnd - screenStart;
  const screenW = LOUVER.depth,
    screenD = LOUVER.width,
    screenH = PAVILION.soffitY - 0.075,
    screenBase = 0.075;
  const roomRear = roomZ - roomD / 2,
    roomFront = roomZ + roomD / 2;
  const screenZ = LOUVER.centerZ,
    screenCenterY = screenBase + screenH / 2;
  const entryBack = roomRear,
    entryFront = roomFront - screenD,
    entryDepth = roomD - screenD,
    entryZ = (entryBack + entryFront) / 2;
  enclosure.userData = {
    access: 'closed',
    interiorUse: 'unspecified',
    source: 'user-confirmed layout',
    widthFraction: screenD / roomD,
    width: screenD,
    depth: screenW,
    rigidPlan: true,
    glassRoomWidth: roomD,
    facing: 'video-start-side',
  };
  enclosure.position.set(screenMid, 0, screenZ);
  // Opaque inset walls and floor/top caps make this a genuinely enclosed volume.
  // The three visible louver skins stand proud of the backing for readable depth.
  box(
    enclosure,
    '栅格区封闭内体',
    0,
    screenCenterY,
    0,
    screenW - 0.16,
    screenH - 0.06,
    screenD - 0.18,
    louverRecess,
  );
  box(
    enclosure,
    '与玻璃房相邻的封闭侧墙',
    -screenW / 2 + 0.04,
    screenCenterY,
    0,
    0.08,
    screenH,
    screenD,
    white,
  );
  box(enclosure, '栅格区独立基座', 0, 0.07, 0, screenW, 0.14, screenD, curb);
  box(
    enclosure,
    '栅格区顶部封板',
    0,
    screenBase + screenH - 0.035,
    0,
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
  louverSkin('视频起点侧白色栅格立面', 0, screenD / 2 - 0.09, screenW - 0.05, 0);
  louverSkin('入口一侧白色栅格立面', 0, -screenD / 2 + 0.09, screenW - 0.05, Math.PI);
  louverSkin('朝开放廊道的白色栅格端面', screenW / 2 - 0.09, 0, screenD - 0.05, Math.PI / 2);
  // This floor joins the main glass room without a transverse blocking wall.
  const entry = new THREE.Group();
  entry.name = '栅格前方玻璃房入口';
  laboratory.add(entry);
  entry.userData = {
    access: 'walk-in',
    widthFraction: entryDepth / roomD,
    clearWidth: ENTRANCE.clearWidth,
  };
  box(
    entry,
    '与玻璃房连通的入口地坪',
    screenMid,
    0.045,
    entryZ,
    entryLength,
    0.08,
    entryDepth,
    curb,
  );
  box(
    entry,
    '入口浅灰石材地面',
    screenMid,
    roomBase - 0.0225,
    entryZ,
    entryLength,
    0.045,
    entryDepth,
    curb,
  );
  box(
    entry,
    '入口完成吊顶',
    screenMid,
    roomTop + 0.03,
    entryZ,
    entryLength,
    0.06,
    entryDepth,
    white,
  );
  function glazedEntrance(name, cx, cz, width, rotation, leafCount) {
    const face = new THREE.Group();
    face.name = name;
    face.position.set(cx, 0, cz);
    face.rotation.y = rotation;
    entry.add(face);
    const base = 0.09,
      totalH = roomTop - base,
      doorH = 2.2,
      doorW = ENTRANCE.clearWidth + ENTRANCE.jambWidth;
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
        ENTRANCE.jambWidth,
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
      for (const y of [0.48, 1.95])
        box(hinge, '玻璃门铰链', dir * 0.02, y, 0, 0.05, 0.075, 0.07, steel);
    }
  }
  // The louver occupies the video-facing rear side; the doors use the other side.
  glazedEntrance('栅格区前方双开玻璃门', screenEnd + 0.0325, entryZ, entryDepth, Math.PI / 2, 2);
  box(
    entry,
    '入口内弧侧固定玻璃',
    screenMid,
    paneY,
    roomRear - 0.016,
    entryLength,
    paneH,
    0.032,
    glass,
  );
  for (const x of [screenStart, screenEnd])
    box(entry, '入口玻璃转角收边', x, paneY, roomRear, 0.035, paneH, 0.05, steel);
  box(entry, '入口固定玻璃底轨', screenMid, 0.105, roomRear, entryLength, 0.035, 0.05, steel);
  // The shop is one independent component, contained in the existing glass room.
  // Add before bending so the floor, displays and exterior signs follow the plan.
  const store = createAppleStore({
    roomX,
    roomZ,
    roomW,
    roomD,
    clearHeight: GLASS_ROOM.clearHeight,
    floorY: GLASS_ROOM.floorY,
  });
  // Restored diagonals cross the glass facade. Keep the existing sign within
  // the first clear triangle instead of leaving it buried in a white member.
  const frontSign = store.getObjectByName('正面玻璃外墙织界标志');
  frontSign.position.x = PAVILION.moduleStartX + PAVILION.archSpan / 2 - roomX;
  frontSign.position.y = GLASS_ROOM.floorY + 0.95;
  laboratory.add(store);
  // Roof panel seams are shallow, visible mainly in the aerial view.
  for (let x = PAVILION.startX + 1.5; x < PAVILION.capCenterX; x += 2.2)
    box(
      building,
      '屋面板接缝',
      x,
      PAVILION.roofTop + 0.003,
      centerline(x),
      0.009,
      0.003,
      7.6,
      seam,
    );
  // The supplied map corrects the whole plan, including the former almost-straight roof.
  const oldBuilding = building,
    oldGround = ground;
  building = bendGroup(oldBuilding);
  ground = bendGroup(oldGround);
  const bentLaboratory = building.getObjectByName(laboratory.name);
  root.remove(oldBuilding, oldGround);
  root.add(building, ground);
  addAppleStoreLighting(bentLaboratory);
  const siteGround = addSiteGround(ground, { asphalt, curb, line });
  root.userData = {
    reference: 'user-measured pavilion with reference-image site context',
    planScale: 'measured room, roof depth, overall chord and facade modules; estimated site',
    curveInterpretation:
      'room sides are concentric arcs; overall length and outward triangle clear openings are chords',
    imageTop: 'reference direction only',
    videoStartPixel: SITE.videoStartPixel,
  };
  // Landscape is a separate group and can be hidden for architectural inspection.
  const bark = mat('树干', { color: 0x7d7052, roughness: 1 });
  const support = mat('绿色树木支架', { color: 0x3e684d, roughness: 0.82 });
  const foliage = mat('树带绿色树冠', { color: 0xffffff, roughness: 1, vertexColors: true });
  // Share native geometries inside this pavilion, but never across model instances.
  const farCrown = crownGeometry(1),
    nearCrown = crownGeometry(3);
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
    rod(
      group,
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.13, h * 0.67, 0.1),
      detailed ? 0.14 : 0.12,
      bark,
      detailed ? '树干' : '树带树干',
    );
    const count = detailed ? 5 : 3;
    for (let i = 0; i < count; i++) {
      const angle = seedAngle + i * 2.399;
      const spread = i === count - 1 ? 0.25 : 0.95;
      const tip = new THREE.Vector3(
        Math.cos(angle) * spread,
        h * (i === count - 1 ? 0.88 : 0.7 + (i % 2) * 0.07),
        Math.sin(angle) * spread,
      );
      if (detailed) rod(group, new THREE.Vector3(0.08, h * 0.46, 0), tip, 0.045, bark, '树枝');
      const crown = new THREE.Mesh(detailed ? nearCrown : farCrown, foliage);
      crown.name = '树带树冠';
      crown.position.copy(tip);
      const radius = (h / 6.7) * (1.48 + 0.12 * Math.sin(seedAngle + i));
      crown.scale.set(radius * 1.15, radius * (i === count - 1 ? 0.94 : 0.85), radius);
      crown.rotation.set(0.12 * Math.sin(angle), angle, 0.1 * Math.cos(angle));
      crown.castShadow = true;
      crown.receiveShadow = true;
      group.add(crown);
    }
    if (detailed && z > 7 && Math.abs(x) < 22) {
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
  const bladePositions = [],
    bladeColors = [];
  // Three narrow bent blades per instance, rather than wide triangular spikes.
  for (let blade = 0; blade < 3; blade++) {
    const angle = blade * 2.399,
      h = 0.1 * (1 - blade * 0.12);
    const c = Math.cos(angle),
      s = Math.sin(angle);
    const points = [
      [-0.006, 0, 0],
      [0.006, 0, 0],
      [0.004, h * 0.62, 0.012],
      [0.011, h * 0.62, 0.012],
      [0.023, h, 0.026],
    ];
    for (const i of [0, 1, 2, 1, 3, 2, 2, 3, 4]) {
      const [x, y, z] = points[i];
      bladePositions.push(x * c - z * s + c * 0.018, y, x * s + z * c + s * 0.018);
      const t = y / h;
      bladeColors.push(0.82 + 0.18 * t, 0.9 + 0.1 * t, 0.68 + 0.2 * t);
    }
  }
  bladeGeo.setAttribute('position', new THREE.Float32BufferAttribute(bladePositions, 3));
  bladeGeo.setAttribute('color', new THREE.Float32BufferAttribute(bladeColors, 3));
  bladeGeo.computeVertexNormals();
  const bladeMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 1,
  });
  bladeMat.name = '草叶';
  materials[bladeMat.name] = bladeMat;
  const count = 24000,
    blades = new THREE.InstancedMesh(bladeGeo, bladeMat, count),
    dummy = new THREE.Object3D();
  const tuftShade = new THREE.Color('#789e48'),
    tuftLight = new THREE.Color('#98b45c');
  const tuftColor = new THREE.Color();
  let k = 0;
  for (let i = 0; i < count * 2 && k < count; i++) {
    // Spend the existing instance budget around the walkable garden; distant lawn
    // gets its detail from the same ground texture instead of more geometry.
    const near = i % 4 !== 0;
    let x = (rand() - 0.5) * (near ? 110 : 155),
      z = (rand() - 0.5) * (near ? 90 : 143);
    if (nearCanopy(x, z, 6) || siteGround.isPaved(x, z)) continue;
    dummy.position.set(x, lawn.position.y + 0.002, z);
    dummy.rotation.y = rand() * Math.PI;
    const height = 0.5 + rand() * 0.5;
    dummy.scale.set(0.8 + height * 0.4, height, 0.8 + height * 0.4);
    dummy.updateMatrix();
    blades.setMatrixAt(k, dummy.matrix);
    blades.setColorAt(k++, tuftColor.copy(tuftShade).lerp(tuftLight, meadowTone(x, z)));
  }
  blades.count = k;
  blades.name = '细草叶';
  blades.receiveShadow = true;
  landscape.add(blades);

  // Center the climber over the left louver column, not the open structural bay.
  // Pose against the already-bent facade so both hind soles reach real blades.
  const rooftopPandaX = screenMid;
  const rooftopPandaZ = centerline(rooftopPandaX) + 3.9;
  const rooftopEave = bendPoint(new THREE.Vector3(rooftopPandaX, PAVILION.roofTop, rooftopPandaZ));
  const eaveBase = bendPoint(new THREE.Vector3(rooftopPandaX, 0, rooftopPandaZ));
  const outside = bendPoint(new THREE.Vector3(rooftopPandaX, 0, rooftopPandaZ + 0.1)).sub(eaveBase);
  const panda = createRooftopPanda({
    eavePosition: rooftopEave,
    outwardDirection: outside,
    footSupport: building.getObjectByName('视频起点侧白色栅格立面'),
  });
  root.add(panda);
  const editableTargets = {
    'pavilion.frame': { materialSlot: 'surface', materials: [white] },
    'pavilion.roof': { materialSlot: 'surface', materials: [roofSurface, roofTop] },
    'pavilion.glass': { materialSlot: 'surface', materials: [glass] },
  };
  for (const [targetId, target] of Object.entries(editableTargets)) {
    const targetMaterials = new Set(target.materials);
    root.traverse((object) => {
      if (object.isMesh && targetMaterials.has(object.material)) {
        object.userData.templateTargetId = targetId;
      }
    });
  }
  return {
    root,
    building,
    laboratory: bentLaboratory,
    ground,
    landscape,
    panda,
    materials,
    editableTargets,
    seed,
    parameters: PARAMETERS,
    layout: SITE,
  };
}
