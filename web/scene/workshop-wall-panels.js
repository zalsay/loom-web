import * as THREE from 'three';

const FRAME_W = 1.1;
const FRAME_H = 1.38;
const BOARD_W = 1.06;
const BOARD_H = 1.34;
const STUD_PITCH = 0.075;
const STUD_COLUMNS = 13;
const STUD_ROWS = 17;

function material(name, color, options = {}) {
  const result = new THREE.MeshStandardMaterial({ color, roughness: 0.78, ...options });
  result.name = name;
  return result;
}

function rootGroup(name, kind) {
  const root = new THREE.Group();
  root.name = name;
  root.userData = { rigidPlan: true, wallDisplay: kind, staticModel: true };
  return root;
}

function addBox(parent, geometry, mat, name, x, y, z, sx, sy, sz, data = {}) {
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.name = name;
  mesh.position.set(x, y, z);
  mesh.scale.set(sx, sy, sz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  Object.assign(mesh.userData, data);
  parent.add(mesh);
  return mesh;
}

function makeFrame(parent, boxGeometry, frameMaterial) {
  const rail = 0.035;
  const depth = 0.04;
  const z = 0.043;
  for (const x of [-FRAME_W / 2 + rail / 2, FRAME_W / 2 - rail / 2])
    addBox(parent, boxGeometry, frameMaterial, '浅橡木侧框', x, 0, z, rail, FRAME_H, depth);
  for (const y of [-FRAME_H / 2 + rail / 2, FRAME_H / 2 - rail / 2])
    addBox(parent, boxGeometry, frameMaterial, '浅橡木横框', 0, y, z, FRAME_W, rail, depth);
}

function mergeCylinderSegments(segments, sourceGeometry) {
  const sourcePositions = sourceGeometry.getAttribute('position');
  const sourceNormals = sourceGeometry.getAttribute('normal');
  const sourceIndex = sourceGeometry.index;
  const positions = [];
  const normals = [];
  const indices = [];
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const matrix = new THREE.Matrix4();
  const normalMatrix = new THREE.Matrix3();
  const rotation = new THREE.Quaternion();
  for (const { start, end, radiusScale = 1 } of segments) {
    const a = new THREE.Vector3(...start);
    const b = new THREE.Vector3(...end);
    const delta = new THREE.Vector3().subVectors(b, a);
    rotation.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
    matrix.compose(
      a.add(b).multiplyScalar(0.5),
      rotation,
      new THREE.Vector3(radiusScale, delta.length(), radiusScale),
    );
    normalMatrix.getNormalMatrix(matrix);
    const vertexOffset = positions.length / 3;
    for (let i = 0; i < sourcePositions.count; i++) {
      point.fromBufferAttribute(sourcePositions, i).applyMatrix4(matrix);
      normal.fromBufferAttribute(sourceNormals, i).applyMatrix3(normalMatrix).normalize();
      positions.push(point.x, point.y, point.z);
      normals.push(normal.x, normal.y, normal.z);
    }
    for (let i = 0; i < sourceIndex.count; i++) indices.push(sourceIndex.getX(i) + vertexOffset);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function addPegHook(parent, x, y, cylinderGeometry, metal, toolType) {
  const hook = new THREE.Group();
  hook.name = '镀锌工具挂钩';
  hook.position.set(x, y, 0);
  hook.userData = { pegHook: true, toolType };
  parent.add(hook);
  // The stem enters the board face; the return bend overlaps the suspended tool.
  const geometry = mergeCylinderSegments(
    [
      { start: [0, 0, 0.034], end: [0, 0, 0.099], radiusScale: 0.68 },
      { start: [0, 0, 0.099], end: [0, -0.018, 0.122], radiusScale: 0.68 },
      { start: [0, -0.018, 0.122], end: [0, -0.064, 0.122], radiusScale: 0.68 },
      { start: [0, -0.064, 0.122], end: [0, -0.076, 0.11], radiusScale: 0.68 },
    ],
    cylinderGeometry,
  );
  const mesh = new THREE.Mesh(geometry, metal);
  mesh.name = '弯折金属挂钩实体';
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  hook.add(mesh);
  return hook;
}

function toolRoot(parent, type, name, x, y) {
  const tool = new THREE.Group();
  tool.name = name;
  tool.position.set(x, y, 0);
  tool.userData = { wallTool: true, toolType: type };
  parent.add(tool);
  return tool;
}

function addWrenchShape(parent, silver) {
  const shape = new THREE.Shape();
  shape.moveTo(-0.018, -0.205);
  shape.lineTo(0.018, -0.205);
  shape.lineTo(0.025, 0.12);
  shape.lineTo(0.06, 0.16);
  shape.lineTo(0.067, 0.225);
  shape.lineTo(0.045, 0.252);
  shape.lineTo(0.015, 0.212);
  shape.lineTo(-0.015, 0.212);
  shape.lineTo(-0.046, 0.252);
  shape.lineTo(-0.068, 0.225);
  shape.lineTo(-0.06, 0.16);
  shape.lineTo(-0.025, 0.12);
  shape.closePath();
  const mesh = new THREE.Mesh(
    new THREE.ExtrudeGeometry(shape, { depth: 0.018, bevelEnabled: false }),
    silver,
  );
  mesh.name = '开口扳手锻钢轮廓';
  mesh.position.z = 0.094;
  mesh.castShadow = true;
  mesh.userData.toolPart = true;
  parent.add(mesh);
}

function addHexKey(parent, boxGeometry, steel) {
  addBox(parent, boxGeometry, steel, '内六角长臂', 0, -0.025, 0.105, 0.027, 0.34, 0.018, {
    toolPart: true,
  });
  addBox(parent, boxGeometry, steel, '内六角短臂', -0.048, -0.19, 0.105, 0.105, 0.027, 0.018, {
    toolPart: true,
  });
  addBox(parent, boxGeometry, steel, '内六角折弯肩', -0.022, -0.166, 0.105, 0.027, 0.05, 0.018, {
    toolPart: true,
  });
}

function pegboardGeometry() {
  const shape = new THREE.Shape();
  shape.moveTo(-BOARD_W / 2, -BOARD_H / 2);
  shape.lineTo(BOARD_W / 2, -BOARD_H / 2);
  shape.lineTo(BOARD_W / 2, BOARD_H / 2);
  shape.lineTo(-BOARD_W / 2, BOARD_H / 2);
  shape.closePath();
  const holeRadius = 0.008;
  const holeStartX = -((STUD_COLUMNS - 1) * STUD_PITCH) / 2;
  const holeStartY = ((STUD_ROWS - 1) * STUD_PITCH) / 2;
  for (let row = 0; row < STUD_ROWS; row++) {
    for (let column = 0; column < STUD_COLUMNS; column++) {
      const hole = new THREE.Path();
      hole.absellipse(
        holeStartX + column * STUD_PITCH,
        holeStartY - row * STUD_PITCH,
        holeRadius,
        holeRadius,
        0,
        Math.PI * 2,
        false,
        0,
      );
      shape.holes.push(hole);
    }
  }
  return new THREE.ExtrudeGeometry(shape, {
    depth: 0.026,
    bevelEnabled: false,
    curveSegments: 4,
    steps: 1,
  });
}

/** Build a warm framed, genuinely perforated tool wall with six suspended tools. */
export function createToolPegboard() {
  const root = rootGroup('洞洞板工具墙', 'tool-pegboard');
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const pegboardMat = material('暖灰洞洞板', 0xd9d6cd, { roughness: 0.88 });
  const backingMat = material('洞孔暗部衬板', 0x363a39, { roughness: 0.96 });
  const frameMat = material('浅橡木饰框', 0xc3a77e, { roughness: 0.75 });
  const steel = material('拉丝工具钢', 0x9da5a6, { metalness: 0.62, roughness: 0.38 });
  const darkSteel = material('深色工具钢', 0x34393a, { metalness: 0.48, roughness: 0.5 });
  const red = material('工具红色握柄', 0xb94638, { roughness: 0.7 });
  const yellow = material('工具安全黄色握柄', 0xe2b846, { roughness: 0.72 });
  const wood = material('锤柄浅木', 0xb88f61, { roughness: 0.82 });
  const cylinderGeometry = new THREE.CylinderGeometry(0.009, 0.009, 1, 10, 1);

  addBox(root, boxGeometry, backingMat, '洞洞板背后暗衬', 0, 0, 0.008, BOARD_W, BOARD_H, 0.008);
  const board = new THREE.Mesh(pegboardGeometry(), pegboardMat);
  board.name = '真实穿孔暖灰纤维板';
  board.position.z = 0.012;
  board.castShadow = true;
  board.receiveShadow = true;
  board.userData = { pegboard: true, holeCount: STUD_COLUMNS * STUD_ROWS, holeRadius: 0.008 };
  root.add(board);
  makeFrame(root, boxGeometry, frameMat);

  const tools = [
    { type: 'hammer', name: '羊角锤', x: -0.34, y: 0.3 },
    { type: 'open-end-wrench', name: '开口扳手', x: 0, y: 0.3 },
    { type: 'pliers', name: '组合钳', x: 0.34, y: 0.3 },
    { type: 'screwdriver', name: '十字螺丝刀', x: -0.34, y: -0.32 },
    { type: 'hex-key', name: '内六角扳手', x: 0, y: -0.32 },
    { type: 'ruler', name: '钢直尺', x: 0.34, y: -0.32 },
  ];
  const toolRoots = [];

  {
    const hammer = toolRoot(root, 'hammer', tools[0].name, tools[0].x, tools[0].y);
    toolRoots.push(hammer);
    addBox(hammer, boxGeometry, wood, '锤柄', 0, -0.055, 0.112, 0.052, 0.37, 0.035, {
      toolPart: true,
    });
    addBox(hammer, boxGeometry, red, '防滑锤柄尾套', 0, -0.2, 0.115, 0.06, 0.085, 0.038, {
      toolPart: true,
    });
    addBox(hammer, boxGeometry, steel, '锤头', 0, 0.19, 0.119, 0.24, 0.073, 0.06, {
      toolPart: true,
    });
    addBox(hammer, boxGeometry, steel, '羊角锤爪', -0.101, 0.218, 0.118, 0.065, 0.038, 0.052, {
      toolPart: true,
    }).rotation.z = -0.22;
    addBox(hammer, boxGeometry, darkSteel, '锤头颈部', 0, 0.135, 0.116, 0.075, 0.07, 0.048, {
      toolPart: true,
    });
  }
  {
    const wrench = toolRoot(root, 'open-end-wrench', tools[1].name, tools[1].x, tools[1].y);
    toolRoots.push(wrench);
    addWrenchShape(wrench, steel);
  }
  {
    const pliers = toolRoot(root, 'pliers', tools[2].name, tools[2].x, tools[2].y);
    toolRoots.push(pliers);
    const left = addBox(
      pliers,
      boxGeometry,
      red,
      '组合钳左握柄',
      -0.03,
      -0.112,
      0.112,
      0.052,
      0.23,
      0.035,
      { toolPart: true },
    );
    const right = addBox(
      pliers,
      boxGeometry,
      darkSteel,
      '组合钳右握柄',
      0.03,
      -0.112,
      0.112,
      0.052,
      0.23,
      0.035,
      { toolPart: true },
    );
    left.rotation.z = -0.14;
    right.rotation.z = 0.14;
    addBox(pliers, boxGeometry, steel, '钳口左臂', -0.027, 0.09, 0.114, 0.033, 0.24, 0.032, {
      toolPart: true,
    }).rotation.z = -0.24;
    addBox(pliers, boxGeometry, steel, '钳口右臂', 0.027, 0.09, 0.114, 0.033, 0.24, 0.032, {
      toolPart: true,
    }).rotation.z = 0.24;
    addBox(pliers, boxGeometry, darkSteel, '钳口咬合头', 0, 0.205, 0.115, 0.11, 0.08, 0.04, {
      toolPart: true,
    });
    const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.016, 12), steel);
    pivot.name = '组合钳铆钉';
    pivot.position.set(0, 0.015, 0.135);
    pivot.rotation.x = Math.PI / 2;
    pivot.userData.toolPart = true;
    pliers.add(pivot);
  }
  {
    const screwdriver = toolRoot(root, 'screwdriver', tools[3].name, tools[3].x, tools[3].y);
    toolRoots.push(screwdriver);
    addBox(screwdriver, boxGeometry, yellow, '螺丝刀握柄', 0, 0.12, 0.116, 0.078, 0.19, 0.056, {
      toolPart: true,
    });
    addBox(screwdriver, boxGeometry, darkSteel, '握柄尾帽', 0, 0.217, 0.116, 0.064, 0.035, 0.053, {
      toolPart: true,
    });
    addBox(screwdriver, boxGeometry, steel, '螺丝刀杆', 0, -0.105, 0.117, 0.023, 0.27, 0.022, {
      toolPart: true,
    });
    addBox(screwdriver, boxGeometry, darkSteel, '十字批头', 0, -0.257, 0.117, 0.042, 0.04, 0.027, {
      toolPart: true,
    });
  }
  {
    const hexKey = toolRoot(root, 'hex-key', tools[4].name, tools[4].x, tools[4].y);
    toolRoots.push(hexKey);
    addHexKey(hexKey, boxGeometry, darkSteel);
  }
  {
    const ruler = toolRoot(root, 'ruler', tools[5].name, tools[5].x, tools[5].y);
    toolRoots.push(ruler);
    addBox(ruler, boxGeometry, yellow, '钢直尺刻度底板', 0, -0.01, 0.108, 0.075, 0.48, 0.026, {
      toolPart: true,
    });
    addBox(ruler, boxGeometry, steel, '钢直尺金属芯', 0, -0.01, 0.124, 0.045, 0.46, 0.006, {
      toolPart: true,
    });
    for (let i = 0; i < 9; i++)
      addBox(
        ruler,
        boxGeometry,
        darkSteel,
        '直尺刻线',
        -0.016,
        0.19 - i * 0.05,
        0.129,
        i % 2 ? 0.023 : 0.035,
        0.005,
        0.003,
        { toolPart: true },
      );
  }

  root.updateMatrixWorld(true);
  for (const tool of toolRoots) {
    const bounds = new THREE.Box3().setFromObject(tool);
    addPegHook(
      root,
      tool.position.x,
      bounds.max.y + 0.083,
      cylinderGeometry,
      steel,
      tool.userData.toolType,
    );
  }
  cylinderGeometry.dispose();

  root.userData.holeCount = STUD_COLUMNS * STUD_ROWS;
  root.userData.toolTypes = tools.map(({ type }) => type);
  return root;
}

function mergedStudGeometry(rows, columns, pitch, sourceGeometry) {
  const sourcePositions = sourceGeometry.getAttribute('position');
  const sourceNormals = sourceGeometry.getAttribute('normal');
  const sourceIndex = sourceGeometry.index;
  const positions = [];
  const normals = [];
  const indices = [];
  const orientation = new THREE.Matrix4().makeRotationX(Math.PI / 2);
  const matrix = new THREE.Matrix4();
  const normalMatrix = new THREE.Matrix3();
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const x0 = -((columns - 1) * pitch) / 2;
  const y0 = ((rows - 1) * pitch) / 2;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      matrix.makeTranslation(x0 + column * pitch, y0 - row * pitch, 0.054);
      matrix.multiply(orientation);
      normalMatrix.getNormalMatrix(matrix);
      const vertexOffset = positions.length / 3;
      for (let i = 0; i < sourcePositions.count; i++) {
        point.fromBufferAttribute(sourcePositions, i).applyMatrix4(matrix);
        normal.fromBufferAttribute(sourceNormals, i).applyMatrix3(normalMatrix).normalize();
        positions.push(point.x, point.y, point.z);
        normals.push(normal.x, normal.y, normal.z);
      }
      for (let i = 0; i < sourceIndex.count; i++) indices.push(sourceIndex.getX(i) + vertexOffset);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function addBrick(parent, boxGeometry, mat, name, column, row, metadata = {}) {
  const x = -((STUD_COLUMNS - 1) * STUD_PITCH) / 2 + column * STUD_PITCH;
  const y = ((STUD_ROWS - 1) * STUD_PITCH) / 2 - row * STUD_PITCH;
  const mesh = addBox(parent, boxGeometry, mat, name, x, y, 0.064, 0.062, 0.062, 0.038, {
    brickPiece: true,
    gridColumn: column,
    gridRow: row,
    ...metadata,
  });
  return mesh;
}

/** Build a studded baseplate carrying a raised black/white pixel panda mosaic. */
export function createBrickWallPanel() {
  const root = rootGroup('乐高积木墙', 'brick-board');
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const frameMat = material('浅橡木积木框', 0xc3a77e, { roughness: 0.75 });
  const baseMat = material('中绿颗粒底板', 0x3d8057, { roughness: 0.72 });
  const studMat = material('绿色圆形凸粒', 0x4a9568, { roughness: 0.67 });
  const black = material('熊猫黑色积木', 0x252b2b, { roughness: 0.7 });
  const white = material('熊猫白色积木', 0xe8e6db, { roughness: 0.78 });
  const red = material('红色点缀积木', 0xc4473c, { roughness: 0.72 });
  const yellow = material('黄色点缀积木', 0xe2b846, { roughness: 0.72 });
  const blue = material('蓝色点缀积木', 0x347ea0, { roughness: 0.72 });

  addBox(root, boxGeometry, baseMat, '绿色有凸粒积木底板', 0, 0, 0.025, BOARD_W, BOARD_H, 0.04, {
    brickBaseplate: true,
  });
  makeFrame(root, boxGeometry, frameMat);

  const unitStud = new THREE.CylinderGeometry(0.017, 0.017, 0.016, 8, 1, false);
  const studsGeometry = mergedStudGeometry(STUD_ROWS, STUD_COLUMNS, STUD_PITCH, unitStud);
  unitStud.dispose();
  const studs = new THREE.Mesh(studsGeometry, studMat);
  studs.name = '原生合并圆柱凸粒阵列';
  studs.castShadow = true;
  studs.receiveShadow = true;
  studs.userData = {
    brickStuds: true,
    baseplateStuds: true,
    studCount: STUD_ROWS * STUD_COLUMNS,
  };
  root.add(studs);

  const panda = [
    '.BB...BB.',
    '.BWWWWWB.',
    'WWWWWWWWW',
    'WBBWWWBBW',
    'WBBWWWBBW',
    'WWWWBWWWW',
    '.WWBBBWW.',
    '..BWWWB..',
    '..BB.BB..',
  ];
  const pandaStartColumn = 2;
  const pandaStartRow = 3;
  const pandaPixels = [];
  const raisedBrickStuds = new Map();
  for (let row = 0; row < panda.length; row++) {
    for (let column = 0; column < panda[row].length; column++) {
      const pixel = panda[row][column];
      if (pixel === '.') continue;
      const gridColumn = pandaStartColumn + column;
      const gridRow = pandaStartRow + row;
      pandaPixels.push([gridColumn, gridRow, pixel]);
      const mat = pixel === 'W' ? white : black;
      const x = -((STUD_COLUMNS - 1) * STUD_PITCH) / 2 + gridColumn * STUD_PITCH;
      const y = ((STUD_ROWS - 1) * STUD_PITCH) / 2 - gridRow * STUD_PITCH;
      const colorKey = pixel === 'W' ? 'white' : 'black';
      if (!raisedBrickStuds.has(colorKey))
        raisedBrickStuds.set(colorKey, { material: mat, points: [] });
      raisedBrickStuds.get(colorKey).points.push([x, y]);
      addBrick(root, boxGeometry, mat, '熊猫像素砖', gridColumn, gridRow, {
        mosaicPixel: true,
        pixelColor: pixel === 'W' ? 'white' : 'black',
        pandaColumn: column,
        pandaRow: row,
      });
    }
  }

  const accents = [
    [1, 15, red],
    [2, 15, yellow],
    [3, 15, blue],
    [9, 15, yellow],
    [10, 15, red],
    [11, 15, blue],
    [4, 16, blue],
    [5, 16, red],
    [7, 16, yellow],
    [8, 16, blue],
  ];
  accents.forEach(([column, row, mat], index) => {
    addBrick(root, boxGeometry, mat, '彩色边缘积木', column, row, {
      accentBrick: true,
      accentIndex: index,
    });
    const x = -((STUD_COLUMNS - 1) * STUD_PITCH) / 2 + column * STUD_PITCH;
    const y = ((STUD_ROWS - 1) * STUD_PITCH) / 2 - row * STUD_PITCH;
    const key = mat.name;
    if (!raisedBrickStuds.has(key)) raisedBrickStuds.set(key, { material: mat, points: [] });
    raisedBrickStuds.get(key).points.push([x, y]);
  });

  const pieceStudGeometry = new THREE.CylinderGeometry(0.016, 0.016, 1, 8, 1, false);
  for (const [colorKey, { material: mat, points }] of raisedBrickStuds) {
    const geometry = mergeCylinderSegments(
      points.map(([x, y]) => ({ start: [x, y, 0.082], end: [x, y, 0.098] })),
      pieceStudGeometry,
    );
    const mesh = new THREE.Mesh(geometry, mat);
    mesh.name = `凸起${mat.name}积木的独立圆柱粒`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData = {
      brickStuds: true,
      brickPieceStuds: true,
      studColor: colorKey,
      studCount: points.length,
    };
    root.add(mesh);
  }
  pieceStudGeometry.dispose();

  root.userData.studPitch = STUD_PITCH;
  root.userData.studRows = STUD_ROWS;
  root.userData.studColumns = STUD_COLUMNS;
  root.userData.studCount = STUD_ROWS * STUD_COLUMNS;
  root.userData.brickPieceStudCount = [...raisedBrickStuds.values()].reduce(
    (total, entry) => total + entry.points.length,
    0,
  );
  root.userData.mosaicPixelCount = pandaPixels.length;
  return root;
}
