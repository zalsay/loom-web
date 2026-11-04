import * as THREE from 'three';
import { createZhiJieSign } from './zhi-jie-sign.js';
import { createLiftingTable } from './lifting-table.js';
import { createToolPegboard, createBrickWallPanel } from './workshop-wall-panels.js';
import { createLaboratoryTableExhibits } from './laboratory-exhibits.js';

// Keep the existing factory/export API while furnishing the room as a maker lab.
// Everything is local geometry; no remote models, fonts or image requests.
export const APPLE_STORE_NAME = '玻璃房 · 织界创客实验室';

function grainTexture() {
  const width = 128,
    height = 32;
  const bytes = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const grain =
        Math.sin(y * 2.1 + Math.sin(x * 0.065) * 0.8) * 2 + Math.sin(y * 0.71 + x * 0.012) * 1.3;
      const i = (y * width + x) * 4;
      bytes.set([211 + grain, 179 + grain, 133 + grain, 255], i);
    }
  }
  const texture = new THREE.DataTexture(bytes, width, height);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
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
  const wood = standard('浅橡木 · 陈列柜与吊顶', { map: grainTexture(), roughness: 0.58 });
  const stone = standard('浅灰石材 · 店内地面', {
    color: 0xd5d4cf,
    roughness: 0.82,
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
  const felt = standard('休息区浅灰软垫', { color: 0xaaa89f, roughness: 1 });
  const porcelain = standard('花盆哑光石材', { color: 0xcecec4, roughness: 0.95 });
  const foliage = standard('室内植物叶片', { color: 0x4d6a3c, roughness: 0.9 });
  const bark = standard('室内植物枝干', { color: 0x76614b, roughness: 1 });
  const light = standard('柔光天花与标志', {
    color: 0xfffcf2,
    emissive: 0xfff2d6,
    emissiveIntensity: 0.85,
    roughness: 0.5,
  });
  const screens = [0x81b8c0, 0xd4a386, 0x7796ba, 0xa7b99b].map((color) => {
    const material = new THREE.MeshBasicMaterial({ color });
    material.name = '实验室项目屏幕';
    return material;
  });
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  function box(parent, name, x, y, z, sx, sy, sz, material) {
    const mesh = new THREE.Mesh(boxGeometry, material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
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
      );
    }

  const ceiling = group(store, '木质声学天花与柔光灯', 0, 0, 0);
  box(ceiling, '店内暖白天花', 0, ceilingY + 0.06, 0, floorW, 0.06, floorD, wall);
  for (let x = -floorW / 2 + 0.12; x < floorW / 2; x += 0.24)
    box(ceiling, '橡木声学顶条', x, ceilingY + 0.0225, 0, 0.13, 0.015, floorD - 0.1, wood);
  for (const x of [-1.22, 1.22])
    for (const z of [-1.28, 1.28])
      box(ceiling, '嵌入式柔光灯', x, ceilingY + 0.0125, z, 1.55, 0.025, 1.25, light);

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
  box(avenue, '橡木储物柜', 0, 0.49, 0.15, roomW - 0.62, 0.7, 0.34, wood);
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
  box(avenue, '主展示屏边框', 0, 1.65, 0.14, 2.36, 1.3, 0.055, graphite);
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
  box(lounge, '橡木端景长凳', 0, 0.52, 0, 0.52, 0.1, 1.5, wood);
  box(lounge, '浅灰长凳坐垫', 0.01, 0.59, 0, 0.48, 0.06, 1.38, felt);
  for (const z of [-0.52, 0.52]) box(lounge, '长凳板腿', 0, 0.33, z, 0.4, 0.37, 0.1, wood);

  const plant = group(store, '室内端景绿植', -roomW / 2 + 0.52, 0, roomD / 2 - 0.65);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.42, 16), porcelain);
  pot.name = '端景绿植花盆';
  pot.position.y = 0.34;
  plant.add(pot);
  box(plant, '端景绿植枝干', 0, 0.92, 0, 0.035, 0.95, 0.035, bark);
  const leafGeometry = new THREE.SphereGeometry(1, 7, 5);
  for (let i = 0; i < 9; i++) {
    const angle = i * 2.4;
    const leaf = new THREE.Mesh(leafGeometry, foliage);
    leaf.name = '端景绿植叶簇';
    leaf.position.set(Math.cos(angle) * 0.17, 1.18 + i * 0.065, Math.sin(angle) * 0.17);
    leaf.scale.set(0.27, 0.12, 0.18);
    leaf.rotation.z = Math.cos(angle) * 0.5;
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
  for (const [i, panel] of panels.filter((_, i) => i % 2 === 0).entries()) {
    panel.updateWorldMatrix(true, false);
    const center = new THREE.Box3().setFromObject(panel).getCenter(new THREE.Vector3());
    const light = new THREE.PointLight(0xfff1da, 7, 7, 2);
    light.name = `店内柔和照明 ${i + 1}`;
    light.position.copy(building.worldToLocal(center)).y -= 0.2;
    light.castShadow = false;
    building.add(light);
  }
}
