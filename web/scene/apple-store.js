import * as THREE from 'three';
import { createZhiJieSign } from './zhi-jie-sign.js';
import { createLiftingTable } from './lifting-table.js';
import { createToolPegboard, createBrickWallPanel } from './workshop-wall-panels.js';
import { createLaboratoryTableExhibits } from './laboratory-exhibits.js';

// Keep the existing factory/export API while furnishing the room as a maker lab.
// Everything is local geometry; no remote models, fonts or image requests.
export const APPLE_STORE_NAME = '玻璃房 · 织界创客实验室';

function grainTexture() {
  const width = 256,
    height = 128;
  const bytes = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const grain =
        Math.sin(y * 0.65 + Math.sin(x * 0.035) * 1.6) * 4 +
        Math.sin(y * 2.7 + x * 0.018) * 1.8 +
        Math.sin(y * 0.17 + Math.sin(x * 0.012) * 2) * 2.4;
      const i = (y * width + x) * 4;
      bytes.set([202 + grain, 172 + grain, 132 + grain, 255], i);
    }
  }
  const texture = new THREE.DataTexture(bytes, width, height);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

// Small physical edge radii, inset before extrusion so the original footprint is unchanged.
function bevelBox(width, height, depth, radius) {
  const x = width / 2 - radius,
    y = height / 2 - radius;
  const r = Math.min(radius, x / 3, y / 3);
  const shape = new THREE.Shape();
  shape.moveTo(-x + r, -y);
  shape.lineTo(x - r, -y);
  shape.quadraticCurveTo(x, -y, x, -y + r);
  shape.lineTo(x, y - r);
  shape.quadraticCurveTo(x, y, x - r, y);
  shape.lineTo(-x + r, y);
  shape.quadraticCurveTo(-x, y, -x, y - r);
  shape.lineTo(-x, -y + r);
  shape.quadraticCurveTo(-x, -y, -x + r, -y);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: depth - radius * 2,
    bevelEnabled: true,
    bevelSize: radius,
    bevelThickness: radius,
    bevelSegments: 2,
    curveSegments: 3,
    steps: 1,
  });
  geometry.translate(0, 0, -depth / 2 + radius);
  return geometry;
}

function finishTexture(kind) {
  const size = 128,
    bytes = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const hash = Math.imul(x + 71, 374761393) ^ Math.imul(y + 19, 668265263);
      const noise = ((hash >>> 8) & 255) / 255 - 0.5;
      const weave = x % 4 < 2 === y % 4 < 2 ? 1 : -1;
      const tone = kind === 'stone' ? noise * 7 : noise * 3 + weave * 3;
      const base = kind === 'stone' ? [215, 213, 205] : [178, 175, 163];
      bytes.set([...base.map((v) => Math.round(v + tone)), 255], (y * size + x) * 4);
    }
  const texture = new THREE.DataTexture(bytes, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function plantLeafGeometry() {
  const positions = [],
    colors = [],
    indices = [];
  const dark = new THREE.Color('#38563b'),
    light = new THREE.Color('#799c5c');
  const color = new THREE.Color();
  for (let row = 0; row <= 8; row++) {
    const t = row / 8;
    const width = 0.072 * Math.sin(Math.PI * t) ** 0.8;
    for (let col = -1; col <= 1; col++) {
      positions.push(col * width, Math.sin(Math.PI * t) * (col === 0 ? 0.035 : 0.018), t * 0.38);
      color.copy(dark).lerp(light, t * 0.6 + (col === 0 ? 0.2 : 0));
      colors.push(color.r, color.g, color.b);
    }
  }
  for (let row = 0; row < 8; row++)
    for (let col = 0; col < 2; col++) {
      const a = row * 3 + col;
      if (row > 0) indices.push(a, a + 3, a + 1);
      if (row < 7) indices.push(a + 1, a + 3, a + 4);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  // Remove the unused endpoint vertices, whose zero normals are invalid in glTF.
  const result = geometry.toNonIndexed();
  geometry.dispose();
  return result;
}

export function createAppleStore({ roomX, roomZ, roomW, roomD, clearHeight = 2.5, floorY = 0.13 }) {
  if (
    ![roomX, roomZ, roomW, roomD, clearHeight, floorY].every(Number.isFinite) ||
    roomW < 5 ||
    roomD < 6 ||
    clearHeight < 2.4
  )
    throw new TypeError(
      'Laboratory requires a finite room at least five metres wide, six deep and 2.4 high',
    );
  const store = new THREE.Group();
  store.name = APPLE_STORE_NAME;
  store.position.set(roomX, 0, roomZ);
  store.userData = {
    concept: '织界创客实验室',
    room: { roomX, roomZ, roomW, roomD },
    clearHeight,
    floorY,
  };
  const ceilingY = floorY + clearHeight;
  const standard = (name, options) => {
    const material = new THREE.MeshStandardMaterial(options);
    material.name = name;
    return material;
  };
  const wood = standard('浅橡木 · 陈列柜与吊顶', { map: grainTexture(), roughness: 0.68 });
  const doorWood = wood.clone();
  doorWood.name = '竖向浅橡木柜门与顶条';
  doorWood.map = wood.map.clone();
  doorWood.map.center.set(0.5, 0.5);
  doorWood.map.rotation = Math.PI / 2;
  const trim = standard('柔光灯铝合金边框', { color: 0xc3c5be, roughness: 0.52, metalness: 0.4 });
  const stone = standard('浅灰石材 · 店内地面', {
    map: finishTexture('stone'),
    roughness: 0.88,
    emissive: 0xc8c5bb,
    emissiveIntensity: 0.045,
  });
  const grout = standard('石材细缝', { color: 0xa9aaa5, roughness: 0.95 });
  const wall = standard('暖白矿物墙面', {
    color: 0xe9e8e2,
    roughness: 0.85,
    emissive: 0xe9e8e2,
    emissiveIntensity: 0.08,
  });
  const graphite = standard('设备石墨色', { color: 0x242a2d, metalness: 0.28, roughness: 0.32 });
  const felt = standard('休息区浅灰软垫', { map: finishTexture('fabric'), roughness: 1 });
  const porcelain = standard('花盆哑光石材', { color: 0xcecec4, roughness: 0.95 });
  const foliage = standard('室内植物叶片', {
    color: 0xffffff,
    roughness: 0.86,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  const bark = standard('室内植物枝干', { color: 0x76614b, roughness: 1 });
  const light = standard('柔光天花与标志', {
    color: 0xfffcf2,
    emissive: 0xfff2d6,
    emissiveIntensity: 0.6,
    roughness: 0.5,
  });
  const screens = [0x81b8c0, 0xd4a386, 0x203a40, 0xa7b99b].map((color) => {
    const material = new THREE.MeshBasicMaterial({ color });
    material.name = '实验室项目屏幕';
    return material;
  });
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const bevelGeometries = new Map();
  function box(parent, name, x, y, z, sx, sy, sz, material, radius = 0) {
    const key = `${sx}:${sy}:${sz}:${radius}`;
    if (radius && !bevelGeometries.has(key)) bevelGeometries.set(key, bevelBox(sx, sy, sz, radius));
    const mesh = new THREE.Mesh(radius ? bevelGeometries.get(key) : boxGeometry, material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    if (!radius) mesh.scale.set(sx, sy, sz);
    mesh.castShadow = material !== light;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function group(parent, name, x, y, z) {
    const object = new THREE.Group();
    object.name = name;
    object.position.set(x, y, z);
    parent.add(object);
    return object;
  }
  // Six-by-six stone slabs with real, recessed joints. The original structural
  // floor remains below; the finish never changes the building envelope.
  const floorW = roomW - 0.1,
    floorD = roomD - 0.1;
  const floor = group(store, '店内浅灰石材地面', 0, 0, 0);
  box(floor, '石材地面基层', 0, floorY - 0.035, 0, floorW, 0.024, floorD, grout);
  for (let ix = 0; ix < 6; ix++)
    for (let iz = 0; iz < 6; iz++) {
      box(
        floor,
        '大规格石材地板',
        ((ix + 0.5) * floorW) / 6 - floorW / 2,
        floorY - 0.013,
        ((iz + 0.5) * floorD) / 6 - floorD / 2,
        floorW / 6 - 0.009,
        0.026,
        floorD / 6 - 0.009,
        stone,
        0.001,
      );
    }

  const ceiling = group(store, '木质声学天花与柔光灯', 0, 0, 0);
  box(ceiling, '店内暖白天花', 0, ceilingY + 0.06, 0, floorW, 0.06, floorD, wall);
  for (let x = -floorW / 2 + 0.12; x < floorW / 2; x += 0.24)
    box(ceiling, '橡木声学顶条', x, ceilingY + 0.0225, 0, 0.13, 0.015, floorD - 0.1, doorWood);
  for (const x of [-1.22, 1.22])
    for (const z of [-1.28, 1.28]) {
      // The same four fixtures: a shallow diffuser set inside its physical frame.
      box(ceiling, '嵌入式柔光灯', x, ceilingY + 0.0145, z, 1.51, 0.021, 1.21, light);
      for (const side of [-1, 1]) {
        box(
          ceiling,
          '柔光灯铝合金边框',
          x + side * 0.765,
          ceilingY + 0.008,
          z,
          0.02,
          0.016,
          1.25,
          trim,
        );
        box(
          ceiling,
          '柔光灯铝合金边框',
          x,
          ceilingY + 0.008,
          z + side * 0.615,
          1.51,
          0.016,
          0.02,
          trim,
        );
      }
    }

  const tablePositions = [
    [0.12, 1.65],
    [0.12, -1.05],
  ];
  for (const [i, [x, z]] of tablePositions.entries()) {
    const table = createLiftingTable({ width: 2.4, depth: 1.05, height: 0.82, floorY });
    table.name = `白色手动升降长桌 ${i + 1}`;
    table.position.set(x, 0, z);
    store.add(table);
    const surface = table.getObjectByName('升降桌面承载组');
    // One robotics/electronics station and one drone/tools station. Attaching
    // to the carrier keeps every exhibit seated on the adjustable tabletop.
    surface.add(createLaboratoryTableExhibits({ variant: i }));
  }

  // Keep the central screen and storage, with two distinct maker displays:
  // a tool pegboard on the left and a studded brick wall on the right.
  const avenue = group(store, '后墙产品陈列区', 0, 0, -roomD / 2 + 0.32);
  box(
    avenue,
    '暖白陈列背景墙',
    0,
    (floorY + ceilingY) / 2,
    0,
    roomW - 0.4,
    clearHeight,
    0.16,
    wall,
  );
  const cabinet = group(avenue, '橡木储物柜', 0, 0.49, 0.15);
  const cabinetW = roomW - 0.62;
  box(cabinet, '橡木柜顶收口', 0, 0.325, 0, cabinetW, 0.05, 0.34, wood, 0.002);
  box(cabinet, '柜体背板', 0, -0.01, -0.158, cabinetW - 0.04, 0.6, 0.024, wood);
  box(cabinet, '柜体底板', 0, -0.295, 0, cabinetW - 0.04, 0.035, 0.32, wood);
  box(cabinet, '内收柜脚', 0, -0.322, -0.025, cabinetW - 0.12, 0.056, 0.24, graphite);
  for (const side of [-1, 1])
    box(
      cabinet,
      '柜体侧板',
      side * (cabinetW / 2 - 0.014),
      -0.01,
      0,
      0.028,
      0.62,
      0.34,
      wood,
      0.001,
    );
  for (let i = 0; i < 6; i++) {
    const x = -cabinetW / 2 + ((i + 0.5) * cabinetW) / 6;
    const door = box(
      cabinet,
      '独立橡木柜门',
      x,
      -0.003,
      0.158,
      cabinetW / 6 - 0.004,
      0.57,
      0.024,
      doorWood,
      0.001,
    );
    door.userData.cabinetFront = true;
    box(cabinet, '柜门细拉手', x, 0.22, 0.172, 0.13, 0.008, 0.005, graphite, 0.001);
  }
  for (const [x, makePanel] of [
    [-1.95, createToolPegboard],
    [1.95, createBrickWallPanel],
  ]) {
    const panel = makePanel();
    // The background wall ends at z=.08: keep the recessed hole backing in
    // front of it, rather than burying it inside the wall's opaque surface.
    panel.position.set(x, 1.58, 0.095);
    avenue.add(panel);
  }
  box(avenue, '主展示屏边框', 0, 1.65, 0.14, 2.36, 1.3, 0.055, graphite, 0.008);
  box(avenue, '主展示屏画面', 0, 1.65, 0.174, 2.29, 1.23, 0.015, screens[2]);
  // A local project schematic echoes the real robot and PCB on the workbench,
  // rather than advertising phones/tablets inside the laboratory.
  const hero = group(avenue, '主屏实验室项目示意', 0, 1.65, 0.2);
  const yellow = new THREE.MeshBasicMaterial({ color: 0xe0bc52 });
  yellow.name = '机器狗示意 · 积木黄';
  const pcb = new THREE.MeshBasicMaterial({ color: 0x407569 });
  pcb.name = '电路示意 · 线路板绿';
  box(hero, '机器狗示意躯干', -0.43, 0.12, 0, 0.73, 0.22, 0.018, yellow);
  box(hero, '机器狗示意传感头', 0.02, 0.22, 0.008, 0.2, 0.15, 0.018, graphite);
  box(hero, '机器狗示意传感器', 0.12, 0.23, 0.021, 0.04, 0.06, 0.012, screens[0]);
  for (const [index, x] of [-0.66, -0.25].entries()) {
    const leg = box(hero, '机器狗示意大腿', x, -0.07, 0.012, 0.085, 0.29, 0.015, graphite);
    leg.rotation.z = index ? -0.32 : 0.32;
    const shin = box(
      hero,
      '机器狗示意弯曲小腿',
      x + 0.04,
      -0.29,
      0.018,
      0.065,
      0.23,
      0.012,
      yellow,
    );
    shin.rotation.z = -0.38;
    box(hero, '机器狗示意脚掌', x + 0.08, -0.4, 0.024, 0.17, 0.045, 0.012, graphite);
  }
  for (let i = 0; i < 5; i++)
    box(hero, '机器狗示意积木凸粒', -0.72 + i * 0.14, 0.25, 0.012, 0.065, 0.04, 0.015, yellow);
  box(hero, '开发板项目示意', 0.62, -0.02, 0, 0.56, 0.82, 0.018, pcb);
  box(hero, '开发板主控芯片示意', 0.62, -0.01, 0.014, 0.22, 0.25, 0.012, graphite);
  box(hero, '开发板接口示意', 0.62, 0.34, 0.015, 0.17, 0.12, 0.012, wall);
  for (const side of [-1, 1])
    for (let i = 0; i < 6; i++) {
      const y = 0.22 - i * 0.095;
      box(hero, '开发板排针示意', 0.62 + side * 0.23, y, 0.015, 0.035, 0.04, 0.012, yellow);
      box(hero, '开发板走线示意', 0.62 + side * 0.16, y, 0.014, 0.105, 0.012, 0.008, screens[0]);
    }

  const lounge = group(store, '玻璃端景休息区', -roomW / 2 + 0.48, 0, -0.05);
  box(lounge, '橡木端景长凳', 0, 0.52, 0, 0.52, 0.1, 1.5, wood, 0.006);
  box(lounge, '浅灰长凳坐垫', 0.01, 0.59, 0, 0.48, 0.06, 1.38, felt, 0.012);
  for (const z of [-0.52, 0.52]) box(lounge, '长凳板腿', 0, 0.33, z, 0.4, 0.37, 0.1, wood, 0.003);

  const plant = group(store, '室内端景绿植', -roomW / 2 + 0.52, 0, roomD / 2 - 0.65);
  // A potted plant is a rigid object, not part of the curved building shell.
  plant.userData.rigidPlan = true;
  const potProfile = [
    [0, -0.21],
    [0.18, -0.21],
    [0.22, 0.18],
    [0.22, 0.21],
    [0.198, 0.21],
    [0.195, 0.17],
    [0.16, -0.16],
    [0, -0.16],
  ];
  const pot = new THREE.Mesh(
    new THREE.LatheGeometry(
      potProfile.map(([r, y]) => new THREE.Vector2(r, y)),
      24,
    ),
    porcelain,
  );
  pot.name = '端景绿植花盆';
  pot.position.y = 0.34;
  pot.castShadow = true;
  pot.receiveShadow = true;
  plant.add(pot);
  const soilMaterial = standard('花盆土壤', { color: 0x514538, roughness: 1 });
  const soil = new THREE.Mesh(new THREE.CylinderGeometry(0.194, 0.19, 0.012, 24), soilMaterial);
  soil.name = '花盆内凹土面';
  soil.position.y = 0.5;
  plant.add(soil);
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.018, 0.99, 10), bark);
  stem.name = '端景绿植枝干';
  stem.position.y = 0.93;
  plant.add(stem);
  const leafGeometry = plantLeafGeometry();
  for (let i = 0; i < 9; i++) {
    const angle = i * 2.4;
    const leaf = new THREE.Mesh(leafGeometry, foliage);
    leaf.name = '端景绿植叶簇';
    leaf.position.set(0, 0.72 + i * 0.08, 0);
    leaf.rotation.set(-0.25 - (i % 3) * 0.12, angle, 0);
    leaf.scale.setScalar(1.1 - i * 0.025);
    leaf.castShadow = true;
    leaf.receiveShadow = true;
    plant.add(leaf);
  }

  for (const [name, x, z, yaw, width] of [
    ['正面玻璃外墙织界标志', -1.45, roomD / 2 + 0.035, 0, 1.4],
    ['端面玻璃外墙织界标志', -roomW / 2 - 0.048, 0.15, -Math.PI / 2, 1.6],
  ]) {
    const sign = group(store, name, x, ceilingY - 0.62, z);
    sign.rotation.y = yaw;
    sign.userData.exteriorLogo = true;
    sign.userData.brand = '织界';
    sign.userData.logoSource = 'assets/zhi-jie-logo.svg';
    sign.add(createZhiJieSign({ width }));
  }
  return store;
}

// bendGroup bakes meshes but intentionally does not bend lights. Place just two
// non-shadow lights afterwards using the real, bent luminous ceiling geometry.
export function addAppleStoreLighting(building) {
  const store = building.getObjectByName(APPLE_STORE_NAME);
  if (!store || building.getObjectByName('店内柔和照明 1')) return;
  const panels = [];
  store.traverse((object) => {
    if (object.name === '嵌入式柔光灯') panels.push(object);
  });
  // Average the front/rear panels on each side. The old even-index selection
  // put both lights on the rear row, leaving the entrance workbench underlit.
  for (let i = 0; i < panels.length; i += 2) {
    const pair = panels.slice(i, i + 2);
    const center = new THREE.Vector3();
    for (const panel of pair) {
      panel.updateWorldMatrix(true, false);
      center.add(new THREE.Box3().setFromObject(panel).getCenter(new THREE.Vector3()));
    }
    center.multiplyScalar(1 / pair.length);
    const light = new THREE.PointLight(0xfff5e6, 6.5, 7, 2);
    light.name = `店内柔和照明 ${i / 2 + 1}`;
    light.position.copy(building.worldToLocal(center)).y -= 0.2;
    light.castShadow = false;
    building.add(light);
  }
}
