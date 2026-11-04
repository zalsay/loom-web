import * as THREE from 'three';

const PALETTE = Object.freeze({
  graphite: 0x30363a,
  dark: 0x1d2428,
  white: 0xe5e7e2,
  warmWhite: 0xf3f1e9,
  yellow: 0xf2bd24,
  orange: 0xe77732,
  pcb: 0x477d62,
  brass: 0xc39b4c,
  steel: 0x899397,
  lens: 0x314f61,
});

function material(color, name, { metalness = 0, roughness = 0.68 } = {}) {
  const result = new THREE.MeshStandardMaterial({ color, metalness, roughness });
  result.name = name;
  return result;
}

function createBuilder() {
  const materials = {
    graphite: material(PALETTE.graphite, '哑光石墨聚合物'),
    dark: material(PALETTE.dark, '深色结构聚合物'),
    white: material(PALETTE.white, '暖白哑光外壳'),
    warmWhite: material(PALETTE.warmWhite, '象牙白积木'),
    yellow: material(PALETTE.yellow, '安全黄积木'),
    orange: material(PALETTE.orange, '安全橙识别件'),
    pcb: material(PALETTE.pcb, '哑光绿色电路板', { roughness: 0.84 }),
    brass: material(PALETTE.brass, '黄铜触点', { metalness: 0.78, roughness: 0.3 }),
    steel: material(PALETTE.steel, '喷砂金属', { metalness: 0.68, roughness: 0.36 }),
    lens: new THREE.MeshPhysicalMaterial({
      color: PALETTE.lens,
      metalness: 0.02,
      roughness: 0.18,
      clearcoat: 0.45,
      clearcoatRoughness: 0.16,
    }),
  };
  materials.lens.name = '蓝黑传感器镜片';
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const sphereGeometry = new THREE.SphereGeometry(1, 10, 8);
  const cylinderGeometries = new Map();

  function cylinderGeometry(radius, length, segments = 10) {
    const key = `${radius}:${length}:${segments}`;
    if (!cylinderGeometries.has(key))
      cylinderGeometries.set(key, new THREE.CylinderGeometry(radius, radius, length, segments, 1));
    return cylinderGeometries.get(key);
  }

  function mesh(parent, name, geometry, mat, position, scale, metadata = {}) {
    const result = new THREE.Mesh(geometry, mat);
    result.name = name;
    result.position.set(...position);
    result.scale.set(...scale);
    result.castShadow = true;
    result.receiveShadow = true;
    Object.assign(result.userData, metadata);
    parent.add(result);
    return result;
  }

  function box(parent, name, position, size, mat, metadata = {}) {
    return mesh(parent, name, boxGeometry, mat, position, size, metadata);
  }

  function cylinder(parent, name, position, radius, length, mat, axis = 'y', metadata = {}) {
    const result = mesh(
      parent,
      name,
      cylinderGeometry(radius, length),
      mat,
      position,
      [1, 1, 1],
      metadata,
    );
    if (axis === 'x') result.rotation.z = Math.PI / 2;
    if (axis === 'z') result.rotation.x = Math.PI / 2;
    return result;
  }

  function sphere(parent, name, position, radius, mat, metadata = {}) {
    return mesh(parent, name, sphereGeometry, mat, position, [radius, radius, radius], metadata);
  }

  function beamBetween(parent, name, start, end, width, depth, mat, metadata = {}) {
    const a = new THREE.Vector3(...start);
    const b = new THREE.Vector3(...end);
    const direction = b.clone().sub(a);
    const result = box(
      parent,
      name,
      a.clone().add(b).multiplyScalar(0.5).toArray(),
      [width, direction.length(), depth],
      mat,
      metadata,
    );
    result.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    return result;
  }

  return { box, beamBetween, cylinder, materials, sphere };
}

function exhibitGroup(name, kind, position) {
  const group = new THREE.Group();
  group.name = name;
  group.position.set(...position);
  group.userData = { device: kind, laboratoryExhibit: kind };
  return group;
}

function addBrickRobotDog(root, builder) {
  const { box, beamBetween, cylinder, materials, sphere } = builder;
  const dog = exhibitGroup('乐高式模块机器狗', 'brick-robot-dog', [-0.5, 0, 0]);
  const chassis = new THREE.Group();
  chassis.name = '积木拼装躯干';
  dog.add(chassis);

  box(chassis, '白色砖块底盘', [0, 0.245, 0.015], [0.43, 0.12, 0.27], materials.warmWhite, {
    brickModule: true,
  });
  box(chassis, '黄色模块化背板', [0, 0.335, 0.025], [0.31, 0.075, 0.235], materials.yellow, {
    brickModule: true,
  });
  box(chassis, '石墨色电池砖', [0, 0.381, 0.025], [0.19, 0.028, 0.17], materials.graphite, {
    brickModule: true,
  });
  box(chassis, '传感器头部短颈连接块', [0, 0.348, -0.105], [0.095, 0.078, 0.1], materials.white, {
    neckConnector: true,
    brickModule: true,
  });

  // A restrained 4-by-3 stud grid reads as interlocking construction bricks
  // without turning the model into a field of repetitive tiny cylinders.
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 4; column++) {
      const x = (column - 1.5) * 0.052;
      const z = 0.025 + (row - 1) * 0.052;
      cylinder(
        chassis,
        `背部积木圆凸钉 ${row + 1}-${column + 1}`,
        [x, 0.403, z],
        0.014,
        0.016,
        (row + column) % 3 === 0 ? materials.warmWhite : materials.yellow,
        'y',
        { brickStud: true },
      );
    }
  }

  const head = new THREE.Group();
  head.name = '前置传感器头部';
  dog.add(head);
  box(head, '积木式传感器头壳', [0, 0.375, -0.2], [0.19, 0.13, 0.16], materials.white, {
    brickModule: true,
    sensorHead: true,
  });
  box(head, '传感器黄色额块', [0, 0.438, -0.2], [0.12, 0.026, 0.1], materials.yellow, {
    brickModule: true,
  });
  cylinder(head, '前向测距镜头', [0, 0.382, -0.285], 0.031, 0.018, materials.lens, 'z', {
    sensor: 'range-camera',
  });
  for (const side of [-1, 1]) {
    cylinder(
      head,
      `侧向避障传感器 ${side < 0 ? '左' : '右'}`,
      [side * 0.075, 0.373, -0.275],
      0.018,
      0.014,
      materials.steel,
      'z',
      { sensor: 'proximity' },
    );
  }

  for (const sideX of [-1, 1]) {
    for (const sideZ of [-1, 1]) {
      const leg = new THREE.Group();
      leg.name = `关节弯折积木腿 ${sideX < 0 ? '左' : '右'}-${sideZ < 0 ? '前' : '后'}`;
      leg.userData.robotLeg = true;
      dog.add(leg);
      const shoulder = [sideX * 0.16, 0.245, sideZ * 0.105];
      const knee = [sideX * 0.2, 0.135, sideZ * 0.14];
      const ankle = [sideX * 0.17, 0.064, sideZ * 0.176];
      cylinder(leg, '肩部旋转关节', shoulder, 0.039, 0.038, materials.graphite, 'x', {
        robotJoint: 'shoulder',
      });
      beamBetween(leg, '上段积木腿节', shoulder, knee, 0.072, 0.073, materials.yellow, {
        robotLimb: 'upper',
      });
      sphere(leg, '可见弯折膝关节', knee, 0.039, materials.graphite, {
        robotJoint: 'knee',
      });
      beamBetween(leg, '下段积木腿节', knee, ankle, 0.061, 0.065, materials.white, {
        robotLimb: 'lower',
      });
      box(
        leg,
        '防滑积木脚掌',
        [sideX * 0.17, 0.035, sideZ * 0.181],
        [0.13, 0.07, 0.105],
        materials.graphite,
        { robotFoot: true, tabletopContact: true },
      );
      box(
        leg,
        '黄色脚背砖',
        [sideX * 0.17, 0.073, sideZ * 0.181],
        [0.085, 0.018, 0.075],
        materials.orange,
        { brickModule: true },
      );
    }
  }
  dog.rotation.y = Math.PI;
  return dog;
}

function addDevelopmentBoard(root, builder, { position, suffix = '' } = {}) {
  const { box, cylinder, materials } = builder;
  const board = exhibitGroup('微控制器开发板' + suffix, 'development-board', position);
  board.name = '微控制器开发板' + suffix;
  box(board, '绿色PCB电路基板', [0, 0.012, 0], [0.48, 0.024, 0.3], materials.pcb, {
    pcbSubstrate: true,
    tabletopContact: true,
  });
  box(board, '主控芯片封装', [0.015, 0.038, -0.005], [0.13, 0.026, 0.105], materials.dark, {
    integratedCircuit: true,
  });
  box(board, '主控芯片散热盖', [0.015, 0.054, -0.005], [0.09, 0.008, 0.07], materials.graphite, {
    integratedCircuitLid: true,
  });
  box(board, '电源管理芯片', [-0.142, 0.03, -0.057], [0.062, 0.012, 0.046], materials.dark, {
    integratedCircuit: true,
  });
  box(board, 'USB-C屏蔽接口', [0, 0.034, -0.139], [0.105, 0.035, 0.05], materials.steel, {
    usbPort: true,
  });
  box(board, 'USB-C插口黑色内芯', [0, 0.035, -0.166], [0.062, 0.014, 0.006], materials.dark, {
    connectorOpening: true,
  });
  box(board, '白色排线座', [-0.17, 0.031, 0.092], [0.095, 0.027, 0.043], materials.white, {
    boardConnector: true,
  });
  box(board, '调试按键', [0.178, 0.035, -0.064], [0.042, 0.018, 0.042], materials.orange, {
    boardControl: true,
  });

  for (const rowZ of [-0.104, 0.104]) {
    for (let index = 0; index < 7; index++) {
      const x = -0.16 + index * 0.053;
      box(board, '双排排针塑料座', [x, 0.035, rowZ], [0.033, 0.018, 0.036], materials.dark, {
        headerHousing: true,
      });
      cylinder(board, '镀金排针', [x, 0.055, rowZ], 0.0045, 0.03, materials.brass, 'y', {
        headerPin: true,
      });
    }
  }
  for (let index = 0; index < 5; index++) {
    box(
      board,
      '底边辅助排针塑料座',
      [-0.108 + index * 0.054, 0.031, 0.054],
      [0.035, 0.013, 0.023],
      materials.dark,
      { headerHousing: true },
    );
    cylinder(
      board,
      '底边镀金排针',
      [-0.108 + index * 0.054, 0.052, 0.054],
      0.0045,
      0.026,
      materials.brass,
      'y',
      { headerPin: true },
    );
  }
  return board;
}

function addToolKit(root, builder, { position, suffix = '' } = {}) {
  const { box, beamBetween, cylinder, materials, sphere } = builder;
  const tray = exhibitGroup('电子装配工具盘' + suffix, 'tool-kit', position);
  tray.name = '电子装配工具盘' + suffix;
  box(tray, '石墨色工具盘底', [0, 0.012, 0], [0.42, 0.024, 0.28], materials.graphite, {
    toolTray: true,
    tabletopContact: true,
  });
  for (const [edge, dimensions, point] of [
    ['左侧挡边', [0.018, 0.038, 0.28], [-0.201, 0.043, 0]],
    ['右侧挡边', [0.018, 0.038, 0.28], [0.201, 0.043, 0]],
    ['后侧挡边', [0.42, 0.038, 0.018], [0, 0.043, 0.131]],
  ]) {
    box(tray, edge, point, dimensions, materials.white, { trayRim: true });
  }

  const screwdriver = new THREE.Group();
  screwdriver.name = '绝缘柄螺丝刀';
  screwdriver.userData.toolPiece = 'screwdriver';
  tray.add(screwdriver);
  box(
    screwdriver,
    '螺丝刀绝缘手柄',
    [-0.105, 0.062, -0.075],
    [0.13, 0.058, 0.068],
    materials.yellow,
  );
  cylinder(screwdriver, '螺丝刀金属杆', [0.01, 0.061, -0.075], 0.009, 0.12, materials.steel, 'x');
  box(
    screwdriver,
    '螺丝刀一字刀尖',
    [0.079, 0.061, -0.075],
    [0.025, 0.008, 0.018],
    materials.steel,
  );

  const pliers = new THREE.Group();
  pliers.name = '电子尖嘴钳';
  pliers.userData.toolPiece = 'pliers';
  tray.add(pliers);
  sphere(pliers, '尖嘴钳铰链', [0.059, 0.059, 0.012], 0.025, materials.steel);
  beamBetween(
    pliers,
    '左钳口',
    [0.059, 0.059, 0.012],
    [0.153, 0.058, -0.01],
    0.022,
    0.022,
    materials.steel,
  );
  beamBetween(
    pliers,
    '右钳口',
    [0.059, 0.059, 0.012],
    [0.153, 0.058, 0.034],
    0.022,
    0.022,
    materials.steel,
  );
  beamBetween(
    pliers,
    '左侧橙色绝缘钳柄',
    [0.049, 0.052, 0.028],
    [-0.085, 0.051, 0.073],
    0.035,
    0.035,
    materials.orange,
  );
  beamBetween(
    pliers,
    '右侧橙色绝缘钳柄',
    [0.049, 0.052, -0.004],
    [-0.085, 0.051, -0.049],
    0.035,
    0.035,
    materials.orange,
  );

  const iron = new THREE.Group();
  iron.name = '低压焊接烙铁';
  iron.userData.toolPiece = 'soldering-iron';
  tray.add(iron);
  beamBetween(
    iron,
    '烙铁绝缘手柄',
    [-0.14, 0.062, 0.083],
    [-0.025, 0.062, 0.083],
    0.042,
    0.042,
    materials.white,
  );
  cylinder(iron, '烙铁金属发热杆', [-0.002, 0.062, 0.083], 0.012, 0.073, materials.steel, 'x');
  beamBetween(
    iron,
    '烙铁尖头',
    [0.034, 0.062, 0.083],
    [0.064, 0.062, 0.083],
    0.012,
    0.012,
    materials.dark,
  );
  return tray;
}

function addQuadcopter(root, builder) {
  const { box, beamBetween, cylinder, materials } = builder;
  const drone = exhibitGroup('静态四旋翼测绘无人机', 'quadcopter', [-0.5, 0, 0]);
  box(drone, '白色无人机中央机身', [0, 0.238, 0.018], [0.32, 0.1, 0.27], materials.white, {
    droneBody: true,
  });
  box(drone, '石墨电池舱', [0, 0.195, 0.045], [0.2, 0.018, 0.16], materials.graphite, {
    batteryBay: true,
  });
  box(drone, '橙色机头识别条', [0, 0.253, -0.125], [0.19, 0.028, 0.022], materials.orange, {
    safetyMarking: true,
  });
  cylinder(drone, '三轴云台相机镜筒', [0, 0.204, -0.154], 0.043, 0.068, materials.graphite, 'z', {
    camera: true,
  });
  cylinder(drone, '广角相机镜片', [0, 0.204, -0.19], 0.025, 0.01, materials.lens, 'z', {
    cameraLens: true,
  });

  for (const sideX of [-1, 1]) {
    for (const sideZ of [-1, 1]) {
      const motor = [sideX * 0.355, 0.264, sideZ * 0.275];
      const elbow = [sideX * 0.19, 0.246, sideZ * 0.145];
      beamBetween(
        drone,
        '碳纤维旋翼臂',
        [0, 0.225, 0.018],
        motor,
        0.047,
        0.047,
        materials.graphite,
        {
          droneArm: true,
        },
      );
      cylinder(drone, '无刷电机安装座', motor, 0.049, 0.025, materials.white, 'y', {
        motorPod: true,
      });
      cylinder(
        drone,
        '旋翼电机轴帽',
        [motor[0], motor[1] + 0.017, motor[2]],
        0.023,
        0.014,
        materials.orange,
        'y',
        { motorHub: true },
      );
      box(
        drone,
        '固定双叶螺旋桨',
        [motor[0], motor[1] + 0.038, motor[2]],
        [0.214, 0.008, 0.022],
        materials.dark,
        { droneRotor: true },
      );
      // The intersecting second blade gives each motor a readable, static
      // two-blade propeller silhouette from both camera and elevated views.
      box(
        drone,
        '螺旋桨横向叶片',
        [motor[0], motor[1] + 0.039, motor[2]],
        [0.022, 0.008, 0.15],
        materials.graphite,
        { droneRotorBlade: true },
      );
      beamBetween(
        drone,
        '一体式起落架支柱',
        [sideX * 0.12, 0.2, sideZ * 0.105],
        [sideX * 0.13, 0.057, sideZ * 0.12],
        0.018,
        0.018,
        materials.steel,
        { landingGear: true },
      );
      box(
        drone,
        '橡胶落地脚垫',
        [sideX * 0.13, 0.018, sideZ * 0.12],
        [0.095, 0.036, 0.055],
        materials.graphite,
        { landingFoot: true, tabletopContact: true },
      );
      // The elbow subtly offsets each arm and visually distinguishes the
      // four independent rotor assemblies without changing its static pose.
      cylinder(drone, '旋翼臂连接套', elbow, 0.029, 0.034, materials.white, 'x', {
        armJoint: true,
      });
    }
  }
  drone.rotation.y = Math.PI;
  return drone;
}

/** Create the three locally modeled tabletop exhibits for one lab table. */
export function createLaboratoryTableExhibits({ variant = 0 } = {}) {
  if (variant !== 0 && variant !== 1)
    throw new RangeError('Laboratory exhibit variant must be 0 or 1');
  const builder = createBuilder();
  const root = new THREE.Group();
  root.name = `玻璃实验室桌面展品 ${variant + 1}`;
  root.userData = { rigidAssembly: true, laboratoryExhibits: true, variant };

  if (variant === 0) {
    root.add(addBrickRobotDog(root, builder));
    root.add(addDevelopmentBoard(root, builder, { position: [0.55, 0, -0.22] }));
    root.add(addToolKit(root, builder, { position: [0.55, 0, 0.23] }));
  } else {
    root.add(addQuadcopter(root, builder));
    root.add(addToolKit(root, builder, { position: [0.6, 0, -0.18], suffix: ' B' }));
    root.add(addDevelopmentBoard(root, builder, { position: [0.6, 0, 0.27], suffix: ' B' }));
  }
  return root;
}
