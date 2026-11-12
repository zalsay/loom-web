import * as THREE from 'three';

// 尺度规范：1 单位 = 1 米 (1.0 = 1m)
// 场地核心：6 块 3m x 3m 孩子专属种植试验区，1.2m 砂石工作通道，中央 2.0m 主道
// 控制室：8m(长) x 5m(宽) x 3.2m(高) 现代木构玻璃房，南向面向所有田块

export const FARM_CONFIG = {
  plotSize: 3.0, // 3m x 3m
  plotCurbHeight: 0.2, // 20cm 木框挡板
  plotCurbThickness: 0.1, // 10cm 厚度
  pathWidth: 1.2, // 地块间通道 1.2m
  mainRoadWidth: 2.0, // 主干道 2.0m
  controlRoom: {
    width: 8.0,
    depth: 5.0,
    height: 3.2,
    x: 0,
    z: -8.5, // 坐北朝南，位于地块阵列北侧
  },
  plots: [
    {
      id: 1,
      name: '01 · 晨晨的番茄与重力滴灌试验',
      child: '晨晨 (7岁)',
      crop: '小番茄 (千禧)',
      stage: '开花结果期 (第4周)',
      device: 'DIY重力储水桶 + 渗灌毛细管',
      question: '周末没人来，水到底能不能滴整整两天？',
      soilMoisture: 42,
      soilTemp: 22.4,
      lightHours: 7.2,
      status: '正常 · 滴灌中',
      x: -4.5,
      z: 0.0,
    },
    {
      id: 2,
      name: '02 · 浩浩的向日葵向光追踪试验',
      child: '浩浩 (8岁)',
      crop: '矮生油用向日葵',
      stage: '现蕾拔节期 (第5周)',
      device: '双光敏电阻对日自转支架',
      question: '阴天的时候，花盘还会跟着太阳的方向转吗？',
      soilMoisture: 38,
      soilTemp: 23.1,
      lightHours: 8.5,
      status: '正常 · 追光就绪',
      x: 0.0,
      z: 0.0,
    },
    {
      id: 3,
      name: '03 · 悠悠的草莓立体阶梯架',
      child: '悠悠 (6岁半)',
      crop: '红颜草莓',
      stage: '初果膨大期 (第6周)',
      device: '三层木构阶梯架 + 离地防虫托盘',
      question: '为什么最底下一层的草莓叶子容易发黄？',
      soilMoisture: 45,
      soilTemp: 21.8,
      lightHours: 6.1,
      status: '告警 · 下层光照不足',
      x: 4.5,
      z: 0.0,
    },
    {
      id: 4,
      name: '04 · 乐乐的南瓜爬藤与防鸟风车',
      child: '乐乐 (7岁)',
      crop: '板栗南瓜',
      stage: '蔓生伸长期 (第3周)',
      device: '人字形竹木搭架 + 激光反光风车',
      question: '藤蔓往哪个方向爬，结的南瓜能晒到最多太阳？',
      soilMoisture: 50,
      soilTemp: 22.0,
      lightHours: 7.8,
      status: '正常 · 藤蔓生长迅速',
      x: -4.5,
      z: 5.5,
    },
    {
      id: 5,
      name: '05 · 糖糖的生菜与可伸缩遮阳网',
      child: '糖糖 (8岁)',
      crop: '奶油生菜 / 罗莎红',
      stage: '成株采收期 (第5周)',
      device: '拉绳式滑轮遮阳卷帘 + 光照计',
      question: '中午大太阳拉上网，生菜吃起来真的不会发苦吗？',
      soilMoisture: 55,
      soilTemp: 20.5,
      lightHours: 5.4,
      status: '正常 · 准备采收',
      x: 0.0,
      z: 5.5,
    },
    {
      id: 6,
      name: '06 · 新实验留白区 (待立案)',
      child: '开放共创',
      crop: '春化休整肥沃土壤',
      stage: '准备阶段',
      device: '标准土壤多参数综合传感器探针',
      question: '下一期孩子带来新想法后，立刻在这里动手整地搭架',
      soilMoisture: 35,
      soilTemp: 21.0,
      lightHours: 7.9,
      status: '待立案 · 随时可用',
      x: 4.5,
      z: 5.5,
    },
  ],
};

export function createFarmScene() {
  const farmGroup = new THREE.Group();
  farmGroup.name = 'ZhijieFarmRoot';

  // 共享材质池
  const materials = {
    soil: new THREE.MeshStandardMaterial({
      color: 0x423121,
      roughness: 0.95,
      metalness: 0.05,
    }),
    soilBedTilled: new THREE.MeshStandardMaterial({
      color: 0x4a3625,
      roughness: 0.9,
      metalness: 0.05,
    }),
    woodCurb: new THREE.MeshStandardMaterial({
      color: 0x8a6240,
      roughness: 0.8,
      metalness: 0.05,
    }),
    grass: new THREE.MeshStandardMaterial({
      color: 0x729260,
      roughness: 0.85,
      metalness: 0.05,
    }),
    gravelPath: new THREE.MeshStandardMaterial({
      color: 0xc4b7a1,
      roughness: 0.92,
      metalness: 0.02,
    }),
    deckWood: new THREE.MeshStandardMaterial({
      color: 0xa0764e,
      roughness: 0.7,
      metalness: 0.1,
    }),
    darkSteel: new THREE.MeshStandardMaterial({
      color: 0x222629,
      roughness: 0.4,
      metalness: 0.8,
    }),
    lightTimber: new THREE.MeshStandardMaterial({
      color: 0xd8ba90,
      roughness: 0.65,
      metalness: 0.05,
    }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xe8f4f8,
      transparent: true,
      opacity: 0.35,
      roughness: 0.1,
      metalness: 0.1,
      transmission: 0.85,
      ior: 1.5,
      depthWrite: false, // 禁用透明玻璃写入深度缓冲，彻底避免与立柱/内部结构边缘发生 Z-fighting 深度冲突闪烁
    }),
    screenGlow: new THREE.MeshBasicMaterial({
      color: 0x4fc3f7,
    }),
    serverLeds: new THREE.MeshBasicMaterial({
      color: 0x69f0ae,
    }),
    serverRack: new THREE.MeshStandardMaterial({
      color: 0x181a1b,
      roughness: 0.35,
      metalness: 0.85,
    }),
    foliageTomato: new THREE.MeshStandardMaterial({
      color: 0x2e7d32,
      roughness: 0.6,
      metalness: 0.05,
    }),
    tomatoFruit: new THREE.MeshStandardMaterial({
      color: 0xd32f2f,
      roughness: 0.3,
      metalness: 0.1,
    }),
    sunflowerPetal: new THREE.MeshStandardMaterial({
      color: 0xfbc02d,
      roughness: 0.5,
      metalness: 0.1,
    }),
    sunflowerCenter: new THREE.MeshStandardMaterial({
      color: 0x3e2723,
      roughness: 0.8,
      metalness: 0.05,
    }),
    waterPipe: new THREE.MeshStandardMaterial({
      color: 0x37474f,
      roughness: 0.4,
      metalness: 0.6,
    }),
    brassValve: new THREE.MeshStandardMaterial({
      color: 0xd4af37,
      roughness: 0.35,
      metalness: 0.9,
    }),
    pvCell: new THREE.MeshStandardMaterial({
      color: 0x1a237e,
      roughness: 0.2,
      metalness: 0.9,
    }),
    whiteAppliance: new THREE.MeshStandardMaterial({
      color: 0xeeeeee,
      roughness: 0.35,
      metalness: 0.2,
    }),
    // 乐高经典高饱和色塑料材质 (ABS Plastic)
    legoRed: new THREE.MeshStandardMaterial({
      color: 0xdf2828,
      roughness: 0.25,
      metalness: 0.05,
    }),
    legoBlue: new THREE.MeshStandardMaterial({
      color: 0x0288d1,
      roughness: 0.25,
      metalness: 0.05,
    }),
    legoYellow: new THREE.MeshStandardMaterial({
      color: 0xffca28,
      roughness: 0.25,
      metalness: 0.05,
    }),
    legoWhite: new THREE.MeshStandardMaterial({
      color: 0xf5f5f5,
      roughness: 0.25,
      metalness: 0.05,
    }),
    legoBlack: new THREE.MeshStandardMaterial({
      color: 0x212121,
      roughness: 0.35,
      metalness: 0.05,
    }),
    rubberTire: new THREE.MeshStandardMaterial({
      color: 0x181818,
      roughness: 0.9,
      metalness: 0.02,
    }),
    legoSensorEye: new THREE.MeshBasicMaterial({
      color: 0x00e5ff,
    }),
    legoOrangeBeacon: new THREE.MeshBasicMaterial({
      color: 0xff9100,
    }),
  };

  // 1. 大地基础与场地规划
  const groundGeo = new THREE.PlaneGeometry(80, 80);
  const ground = new THREE.Mesh(groundGeo, materials.grass);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  farmGroup.add(ground);

  // 场地通道网络（围绕与穿插 3m×3m 格子之间，便于孩子走动与乐高小车运输）
  // 通道 1：西侧纵向通道 (x = -2.25m，连接地块01、04与控制室)
  const pathWestGeo = new THREE.PlaneGeometry(1.5, 14);
  const pathWest = new THREE.Mesh(pathWestGeo, materials.gravelPath);
  pathWest.rotation.x = -Math.PI / 2;
  pathWest.position.set(-2.25, 0.015, 2.0);
  pathWest.receiveShadow = true;
  farmGroup.add(pathWest);

  // 通道 2：东侧纵向通道 (x = +2.25m，连接地块02、03、05、06与控制室)
  const pathEastGeo = new THREE.PlaneGeometry(1.5, 14);
  const pathEast = new THREE.Mesh(pathEastGeo, materials.gravelPath);
  pathEast.rotation.x = -Math.PI / 2;
  pathEast.position.set(2.25, 0.015, 2.0);
  pathEast.receiveShadow = true;
  farmGroup.add(pathEast);

  // 通道 3：中央横向主通道 (z = 2.75m，穿插于第一排与第二排 3m×3m 田块之间，宽 2.4m)
  const pathCrossGeo = new THREE.PlaneGeometry(16, 2.4);
  const pathCross = new THREE.Mesh(pathCrossGeo, materials.gravelPath);
  pathCross.rotation.x = -Math.PI / 2;
  pathCross.position.set(0, 0.016, 2.75);
  pathCross.receiveShadow = true;
  farmGroup.add(pathCross);

  // 通道 4：北侧控制室木露台前坪通道 (z = -3.2m，宽 2.4m)
  const pathNorthGeo = new THREE.PlaneGeometry(16, 2.4);
  const pathNorth = new THREE.Mesh(pathNorthGeo, materials.gravelPath);
  pathNorth.rotation.x = -Math.PI / 2;
  pathNorth.position.set(0, 0.016, -3.2);
  pathNorth.receiveShadow = true;
  farmGroup.add(pathNorth);

  // 通道 5：南侧田块外缘通道 (z = 8.0m，宽 1.8m)
  const pathSouthGeo = new THREE.PlaneGeometry(16, 1.8);
  const pathSouth = new THREE.Mesh(pathSouthGeo, materials.gravelPath);
  pathSouth.rotation.x = -Math.PI / 2;
  pathSouth.position.set(0, 0.016, 8.0);
  pathSouth.receiveShadow = true;
  farmGroup.add(pathSouth);

  // 2. 孩子专属 3m x 3m 种植地块
  const plotInteractables = [];
  const waterParticlesList = [];

  FARM_CONFIG.plots.forEach((pData) => {
    const plotGroup = new THREE.Group();
    plotGroup.name = `Plot_${pData.id}`;
    plotGroup.position.set(pData.x, 0, pData.z);
    plotGroup.userData = {
      type: 'plot',
      data: pData,
    };

    // 3m x 3m 土壤垄床 (略微内缩 2cm，避免与 3m 木框内侧重叠产生 Z-fighting)
    const soilBedGeo = new THREE.BoxGeometry(2.76, 0.21, 2.76);
    const soilBed = new THREE.Mesh(soilBedGeo, materials.soilBedTilled);
    soilBed.position.set(0, 0.105, 0);
    soilBed.receiveShadow = true;
    soilBed.castShadow = true;
    plotGroup.add(soilBed);

    // 3m x 3m 木质外围挡 (Cedar wood curbing)
    const curbH = FARM_CONFIG.plotCurbHeight;
    const curbT = FARM_CONFIG.plotCurbThickness;
    const curbOuter = FARM_CONFIG.plotSize;

    // 四边木梁
    const curbLongGeo = new THREE.BoxGeometry(curbOuter, curbH, curbT);
    const curbShortGeo = new THREE.BoxGeometry(curbT, curbH, curbOuter - curbT * 2);

    // 北边木框
    const curbN = new THREE.Mesh(curbLongGeo, materials.woodCurb);
    curbN.position.set(0, curbH / 2, -curbOuter / 2 + curbT / 2);
    curbN.castShadow = true;
    plotGroup.add(curbN);

    // 南边木框
    const curbS = new THREE.Mesh(curbLongGeo, materials.woodCurb);
    curbS.position.set(0, curbH / 2, curbOuter / 2 - curbT / 2);
    curbS.castShadow = true;
    plotGroup.add(curbS);

    // 西边木框
    const curbW = new THREE.Mesh(curbShortGeo, materials.woodCurb);
    curbW.position.set(-curbOuter / 2 + curbT / 2, curbH / 2, 0);
    curbW.castShadow = true;
    plotGroup.add(curbW);

    // 东边木框
    const curbE = new THREE.Mesh(curbShortGeo, materials.woodCurb);
    curbE.position.set(curbOuter / 2 - curbT / 2, curbH / 2, 0);
    curbE.castShadow = true;
    plotGroup.add(curbE);

    // 专属标牌与编号（地块铭牌木桩）
    const signStakeGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.9, 8);
    const signStake = new THREE.Mesh(signStakeGeo, materials.woodCurb);
    signStake.position.set(-1.25, 0.45, 1.25);
    signStake.castShadow = true;
    plotGroup.add(signStake);

    const signBoardGeo = new THREE.BoxGeometry(0.42, 0.25, 0.025);
    const signBoardMat = new THREE.MeshStandardMaterial({
      color: 0x334433,
      roughness: 0.5,
    });
    const signBoard = new THREE.Mesh(signBoardGeo, signBoardMat);
    signBoard.position.set(-1.25, 0.8, 1.25);
    signBoard.rotation.y = -Math.PI / 6;
    plotGroup.add(signBoard);

    // 专属延时摄影立杆（Time-Lapse Camera Pole，记录发芽、生长、前后对比）
    const cameraPoleGeo = new THREE.CylinderGeometry(0.025, 0.025, 1.8, 8);
    const cameraPole = new THREE.Mesh(cameraPoleGeo, materials.darkSteel);
    cameraPole.position.set(1.3, 0.9, -1.3);
    cameraPole.castShadow = true;
    plotGroup.add(cameraPole);

    // 顶部延时小相机
    const cameraBoxGeo = new THREE.BoxGeometry(0.12, 0.09, 0.16);
    const cameraBox = new THREE.Mesh(cameraBoxGeo, materials.whiteAppliance);
    cameraBox.position.set(1.3, 1.78, -1.3);
    cameraBox.rotation.x = Math.PI / 4; // 向下俯拍地块
    cameraBox.rotation.y = -Math.PI / 4;
    plotGroup.add(cameraBox);

    // 镜头透镜
    const lensGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.05, 12);
    const lensMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.1 });
    const lens = new THREE.Mesh(lensGeo, lensMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.set(0, 0, 0.09);
    cameraBox.add(lens);

    // 土壤物联网传感器探针 (IoT Sensor Stake)
    const sensorStakeGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.45, 8);
    const sensorStake = new THREE.Mesh(sensorStakeGeo, materials.darkSteel);
    sensorStake.position.set(0.8, 0.3, 0.8);
    plotGroup.add(sensorStake);

    // 传感器顶部太阳能微电池与指示灯
    const sensorHeadGeo = new THREE.CylinderGeometry(0.05, 0.04, 0.08, 10);
    const sensorHead = new THREE.Mesh(sensorHeadGeo, materials.whiteAppliance);
    sensorHead.position.set(0.8, 0.52, 0.8);
    plotGroup.add(sensorHead);

    const ledGeo = new THREE.SphereGeometry(0.012, 8, 8);
    const led = new THREE.Mesh(ledGeo, materials.serverLeds);
    led.position.set(0.8, 0.57, 0.8);
    plotGroup.add(led);

    // 地块微喷/滴灌管网 (Drip irrigation pipe)
    const pipeGeo = new THREE.CylinderGeometry(0.012, 0.012, 2.6, 8);
    pipeGeo.rotateX(Math.PI / 2);
    const pipe1 = new THREE.Mesh(pipeGeo, materials.waterPipe);
    pipe1.position.set(-0.7, 0.23, 0);
    plotGroup.add(pipe1);

    const pipe2 = new THREE.Mesh(pipeGeo, materials.waterPipe);
    pipe2.position.set(0.7, 0.23, 0);
    plotGroup.add(pipe2);

    // 各地块专属农作物与孩子装置
    addPlotContents(plotGroup, pData, materials);

    farmGroup.add(plotGroup);
    plotInteractables.push(soilBed);
  });

  // 3. 共用控制室 Hub (Modern Eco-Tech Modular Lab)
  const roomConfig = FARM_CONFIG.controlRoom;
  const controlRoomGroup = new THREE.Group();
  controlRoomGroup.name = 'ControlRoomHub';
  controlRoomGroup.position.set(roomConfig.x, 0, roomConfig.z);

  // 控制室地台基座（抬高 0.25m，带外伸户外木露台）
  const deckGeo = new THREE.BoxGeometry(roomConfig.width + 1.6, 0.25, roomConfig.depth + 2.0);
  const deck = new THREE.Mesh(deckGeo, materials.deckWood);
  deck.position.set(0, 0.125, 0.5);
  deck.receiveShadow = true;
  controlRoomGroup.add(deck);

  // 控制室主体框架（梁柱体系与不重叠围护结构，彻底消除共面闪烁）
  const h = roomConfig.height; // 3.2m
  const w = roomConfig.width; // 8.0m
  const d = roomConfig.depth; // 5.0m
  const colSize = 0.2; // 20cm 柱体
  const wallT = 0.16; // 16cm 墙厚

  // 地板（室内木质地坪，置于地台上方，内缩 10cm 杜绝与地台/外墙共面）
  const floorGeo = new THREE.BoxGeometry(w - colSize * 2, 0.02, d - colSize * 2);
  const floorMat = new THREE.MeshStandardMaterial({
    color: 0xc8aa80,
    roughness: 0.5,
    metalness: 0.1,
  });
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.position.set(0, 0.26, 0);
  floor.receiveShadow = true;
  controlRoomGroup.add(floor);

  // 墙体标准材质
  const wallMat = new THREE.MeshStandardMaterial({
    color: 0xefede7,
    roughness: 0.8,
    metalness: 0.05,
  });

  // 北后墙：嵌于西北柱与东北柱之间（宽 w - colSize * 2），杜绝拐角重叠
  const backWallGeo = new THREE.BoxGeometry(w - colSize * 2, h, wallT);
  const backWall = new THREE.Mesh(backWallGeo, wallMat);
  backWall.position.set(0, h / 2 + 0.25, -d / 2 + wallT / 2);
  backWall.castShadow = true;
  backWall.receiveShadow = true;
  controlRoomGroup.add(backWall);

  // 东侧墙：嵌于东北柱与东南柱之间（深 d - colSize * 2）
  const sideWallGeo = new THREE.BoxGeometry(wallT, h, d - colSize * 2);
  const eastWall = new THREE.Mesh(sideWallGeo, wallMat);
  eastWall.position.set(w / 2 - wallT / 2, h / 2 + 0.25, 0);
  eastWall.castShadow = true;
  eastWall.receiveShadow = true;
  controlRoomGroup.add(eastWall);

  // 西侧墙：嵌于西北柱与西南柱之间
  const westWall = new THREE.Mesh(sideWallGeo, wallMat);
  westWall.position.set(-w / 2 + wallT / 2, h / 2 + 0.25, 0);
  westWall.castShadow = true;
  westWall.receiveShadow = true;
  controlRoomGroup.add(westWall);

  // 南向全景落地玻璃幕墙（嵌于门框立柱间，位置内缩 12cm，设置 depthWrite=false）
  const glassGeo = new THREE.BoxGeometry(w - colSize * 2, h - 0.15, 0.03);
  const frontGlass = new THREE.Mesh(glassGeo, materials.glass);
  frontGlass.position.set(0, h / 2 + 0.25, d / 2 - 0.12);
  controlRoomGroup.add(frontGlass);

  // 钢木复合立柱（四角承重柱与中央玻璃门框立柱，独立外包尺寸无共面冲突）
  const colGeo = new THREE.BoxGeometry(colSize, h, colSize);
  const colPositions = [
    [-w / 2 + colSize / 2, -d / 2 + colSize / 2], // 西北角柱
    [w / 2 - colSize / 2, -d / 2 + colSize / 2], // 东北角柱
    [-w / 2 + colSize / 2, d / 2 - colSize / 2], // 西南角柱
    [w / 2 - colSize / 2, d / 2 - colSize / 2], // 东南角柱
    [-1.2, d / 2 - colSize / 2], // 玻璃门立柱左
    [1.2, d / 2 - colSize / 2], // 玻璃门立柱右
  ];
  colPositions.forEach(([cx, cz]) => {
    const col = new THREE.Mesh(colGeo, materials.darkSteel);
    col.position.set(cx, h / 2 + 0.25, cz);
    col.castShadow = true;
    controlRoomGroup.add(col);
  });

  // 屋顶（轻质倾斜平顶，底面在 y = 3.47m，留出 2cm 阴影工艺槽，杜绝与墙顶共面）
  const roofGeo = new THREE.BoxGeometry(w + 0.6, 0.22, d + 0.6);
  const roofMat = new THREE.MeshStandardMaterial({
    color: 0x37474f,
    roughness: 0.6,
    metalness: 0.4,
  });
  const roof = new THREE.Mesh(roofGeo, roofMat);
  roof.position.set(0, h + 0.38, 0); // 底部位于 3.2 + 0.38 - 0.11 = 3.47m
  roof.castShadow = true;
  controlRoomGroup.add(roof);

  // 屋顶光伏支架横梁（将光伏板整体抬高至屋顶表面以上，杜绝斜面穿透屋顶）
  const railMat = new THREE.MeshStandardMaterial({ color: 0x222629, roughness: 0.5 });
  for (let r = 0; r < 2; r++) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(w - 1.2, 0.05, 0.08), railMat);
    rail.position.set(0, h + 0.52, -1.2 + r * 1.4);
    controlRoomGroup.add(rail);
  }

  // 屋顶太阳能光伏阵列 (Solar PV Array，架高安装于支架上)
  const pvWidth = 1.5;
  const pvDepth = 0.95;
  const pvGeo = new THREE.BoxGeometry(pvWidth, 0.04, pvDepth);
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 4; c++) {
      const pv = new THREE.Mesh(pvGeo, materials.pvCell);
      // 抬高至 h + 0.62 (3.82m)，倾角0.12rad下最低点为 3.82 - sin(0.12)*0.475 = 3.76m，高于屋顶 3.59m，彻底无穿透冲突
      pv.position.set(-2.55 + c * 1.7, h + 0.62, -1.2 + r * 1.4);
      pv.rotation.x = 0.12;
      controlRoomGroup.add(pv);
    }
  }

  // 屋顶 360° 全景云台球机与小型气象站
  const ptzMastGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.4, 8);
  const ptzMast = new THREE.Mesh(ptzMastGeo, materials.darkSteel);
  ptzMast.position.set(-3.2, h + 1.05, 1.6);
  controlRoomGroup.add(ptzMast);

  const domeGeo = new THREE.SphereGeometry(0.18, 16, 16);
  const dome = new THREE.Mesh(domeGeo, materials.whiteAppliance);
  dome.position.set(-3.2, h + 1.7, 1.6);
  controlRoomGroup.add(dome);

  // 室外雨水收集与过滤立桶（西侧墙外）
  const rainTankGeo = new THREE.CylinderGeometry(0.65, 0.65, 2.2, 16);
  const rainTankMat = new THREE.MeshStandardMaterial({
    color: 0x455a64,
    roughness: 0.4,
    metalness: 0.5,
  });
  const rainTank = new THREE.Mesh(rainTankGeo, rainTankMat);
  rainTank.position.set(-w / 2 - 0.8, 1.35, -0.6);
  rainTank.castShadow = true;
  controlRoomGroup.add(rainTank);

  // 4. 控制室内部核心设备
  // ----------------------------------------------------
  // 设备 A：边缘 AI 服务器机柜 (Edge AI Server Rack)
  // 位于西北角，负责本地视觉推理、延时视频转码、传感器时序数据库
  const rackGroup = new THREE.Group();
  rackGroup.name = 'ServerRack';
  rackGroup.position.set(-w / 2 + 1.0, 0.25, -d / 2 + 1.1);
  rackGroup.userData = {
    type: 'server_rack',
    title: '织界边缘 AI 服务器机柜 (42U Edge Node)',
    desc: '现场本地化运算核心：运行 G 老师视觉分析模型、6个地块延时摄影高画质存储（NAS）、环境时序数据库与离线 Agent 推理集群。断网依然保持自动化照料。',
  };

  const rackFrameGeo = new THREE.BoxGeometry(0.85, 2.2, 0.95);
  const rackFrame = new THREE.Mesh(rackFrameGeo, materials.serverRack);
  rackFrame.position.y = 1.1;
  rackFrame.castShadow = true;
  rackGroup.add(rackFrame);

  // 服务器正面闪烁面板单元 (Blade units)
  for (let s = 0; s < 6; s++) {
    const bladeGeo = new THREE.BoxGeometry(0.72, 0.2, 0.05);
    const bladeMat = new THREE.MeshStandardMaterial({
      color: 0x263238,
      roughness: 0.4,
      metalness: 0.7,
    });
    const blade = new THREE.Mesh(bladeGeo, bladeMat);
    blade.position.set(0, 0.35 + s * 0.28, 0.48);
    rackGroup.add(blade);

    // 蓝绿呼吸指示灯条
    const stripGeo = new THREE.BoxGeometry(0.18, 0.03, 0.02);
    const strip = new THREE.Mesh(
      stripGeo,
      s % 2 === 0 ? materials.serverLeds : materials.screenGlow,
    );
    strip.position.set(0.2, 0.35 + s * 0.28, 0.51);
    rackGroup.add(strip);
  }
  controlRoomGroup.add(rackGroup);

  // ----------------------------------------------------
  // 设备 B：Agent 交互核心大屏与讨论工作台 (G 老师 AI Agent Console)
  // 位于正中央，孩子与 G 老师在此复盘讨论（"现场遇到问题 → G老师分析 → 人去尝试 → 带着结果回来"）
  const agentDeskGroup = new THREE.Group();
  agentDeskGroup.name = 'AgentConsole';
  agentDeskGroup.position.set(0, 0.25, -0.6);
  agentDeskGroup.userData = {
    type: 'agent_console',
    title: 'G 老师农场 AI Agent 交互中心',
    desc: '孩子与 G 老师的研讨工位。大屏呈现“农场 AI-Lab 认知中枢”：作物长势诊断、环境异常预警、自然语言多轮问答记录。孩子现场遇到疑惑，在这里与 G 老师拆解实验。',
  };

  // 弧形/宽幅木作讨论台
  const deskTopGeo = new THREE.BoxGeometry(2.8, 0.08, 1.3);
  const deskTop = new THREE.Mesh(deskTopGeo, materials.lightTimber);
  deskTop.position.set(0, 0.78, 0);
  deskTop.castShadow = true;
  agentDeskGroup.add(deskTop);

  // 桌腿
  const legGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.74, 8);
  [
    [-1.2, -0.5],
    [1.2, -0.5],
    [-1.2, 0.5],
    [1.2, 0.5],
  ].forEach(([lx, lz]) => {
    const leg = new THREE.Mesh(legGeo, materials.darkSteel);
    leg.position.set(lx, 0.37, lz);
    agentDeskGroup.add(leg);
  });

  // 主屏幕支架与曲面大屏 (Agent Display)
  const screenStandGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.45, 8);
  const screenStand = new THREE.Mesh(screenStandGeo, materials.darkSteel);
  screenStand.position.set(0, 1.05, -0.4);
  agentDeskGroup.add(screenStand);

  const mainScreenGeo = new THREE.BoxGeometry(1.9, 0.85, 0.06);
  const mainScreen = new THREE.Mesh(mainScreenGeo, materials.darkSteel);
  mainScreen.position.set(0, 1.55, -0.4);
  agentDeskGroup.add(mainScreen);

  // 屏幕发光显示区（G 老师界面）
  const screenFaceGeo = new THREE.PlaneGeometry(1.82, 0.78);
  const screenCanvas = createAgentScreenTexture();
  const screenTex = new THREE.CanvasTexture(screenCanvas);
  const screenMat = new THREE.MeshBasicMaterial({ map: screenTex });
  const screenFace = new THREE.Mesh(screenFaceGeo, screenMat);
  screenFace.position.set(0, 1.55, -0.368);
  agentDeskGroup.add(screenFace);

  // 孩子与导师讨论凳子
  for (let st = 0; st < 3; st++) {
    const stoolGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.48, 16);
    const stool = new THREE.Mesh(stoolGeo, materials.lightTimber);
    stool.position.set(-0.9 + st * 0.9, 0.24, 0.75);
    agentDeskGroup.add(stool);
  }
  controlRoomGroup.add(agentDeskGroup);

  // ----------------------------------------------------
  // 设备 C：摄像头与视觉监控墙 (Surveillance & Computer Vision Matrix)
  // 位于东侧墙面，呈现 6 个地块的实时延时回传画面与鸟瞰全景
  const monitorWallGroup = new THREE.Group();
  monitorWallGroup.name = 'SurveillanceWall';
  monitorWallGroup.position.set(w / 2 - 0.25, 0.25, -0.6);
  monitorWallGroup.userData = {
    type: 'surveillance_wall',
    title: '六地块视觉监测与延时回传大屏',
    desc: '6路高清延时机位与全景PTZ的实时视觉矩阵。内置目标检测算法，自动标出番茄花朵数、向日葵朝向角、叶片面积扩张率，支撑“整季连续追踪”记录。',
  };

  const wallBracketGeo = new THREE.BoxGeometry(0.12, 1.6, 2.6);
  const wallBracket = new THREE.Mesh(wallBracketGeo, materials.darkSteel);
  wallBracket.position.set(0, 1.8, 0);
  monitorWallGroup.add(wallBracket);

  // 6 块监控分屏（模拟 6 个地块画面）
  const cTexCanvas = createCctvTexture();
  const cctvTex = new THREE.CanvasTexture(cTexCanvas);
  const cctvMat = new THREE.MeshBasicMaterial({ map: cctvTex });

  const cctvFaceGeo = new THREE.PlaneGeometry(2.45, 1.45);
  const cctvFace = new THREE.Mesh(cctvFaceGeo, cctvMat);
  cctvFace.rotation.y = -Math.PI / 2;
  cctvFace.position.set(-0.065, 1.8, 0);
  monitorWallGroup.add(cctvFace);
  controlRoomGroup.add(monitorWallGroup);

  // ----------------------------------------------------
  // 设备 D：水电光一体化控制台 (Hydro, Power & Light Control Console)
  // 位于控制室西南角，集中管理全农场的水肥微喷、光伏蓄电与辅助光周期
  const consoleGroup = new THREE.Group();
  consoleGroup.name = 'HydroPowerLightConsole';
  consoleGroup.position.set(-w / 2 + 1.2, 0.25, 1.1);
  consoleGroup.userData = {
    type: 'hydro_power_light_console',
    title: '水电光一体化物理调控中心',
    desc: '农场物理执行层。集成6路微灌电磁分水排阀、压力监测表、光伏逆变电量表、LED光周期补光控制器。支持孩子通过物理旋钮与手柄安全干预水阀。',
  };

  const consoleDeskGeo = new THREE.BoxGeometry(1.6, 0.9, 0.85);
  const consoleDesk = new THREE.Mesh(consoleDeskGeo, materials.whiteAppliance);
  consoleDesk.position.set(0, 0.45, 0);
  consoleDesk.castShadow = true;
  consoleGroup.add(consoleDesk);

  // 仪表台斜面
  const dashGeo = new THREE.BoxGeometry(1.5, 0.35, 0.35);
  const dashMat = new THREE.MeshStandardMaterial({
    color: 0x37474f,
    roughness: 0.3,
  });
  const dash = new THREE.Mesh(dashGeo, dashMat);
  dash.position.set(0, 1.0, -0.2);
  dash.rotation.x = -0.3;
  consoleGroup.add(dash);

  // 6路电磁阀铜质分水器 (Water manifold)
  for (let v = 0; v < 6; v++) {
    const valveGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.12, 8);
    const valve = new THREE.Mesh(valveGeo, materials.brassValve);
    valve.position.set(-0.5 + v * 0.2, 0.95, 0.18);
    consoleGroup.add(valve);

    const knobGeo = new THREE.SphereGeometry(0.025, 8, 8);
    const knobMat = new THREE.MeshStandardMaterial({
      color: v % 2 === 0 ? 0x2e7d32 : 0xd32f2f,
    });
    const knob = new THREE.Mesh(knobGeo, knobMat);
    knob.position.set(-0.5 + v * 0.2, 1.03, 0.18);
    consoleGroup.add(knob);
  }

  // 仪表刻度圆形表头 (Water pressure & power gauges)
  for (let g = 0; g < 3; g++) {
    const gaugeGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.02, 16);
    const gaugeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const gauge = new THREE.Mesh(gaugeGeo, gaugeMat);
    gauge.rotation.x = Math.PI / 2;
    gauge.position.set(-0.4 + g * 0.4, 1.05, -0.05);
    consoleGroup.add(gauge);
  }
  controlRoomGroup.add(consoleGroup);

  // 附加彩蛋：四足机器狗充能工位 (致敬前期机器狗系列)
  const dogDockGroup = new THREE.Group();
  dogDockGroup.name = 'RobotDogDock';
  dogDockGroup.position.set(w / 2 - 1.2, 0.25, 1.4);
  const dogBaseGeo = new THREE.BoxGeometry(0.8, 0.06, 0.7);
  const dogBaseMat = new THREE.MeshStandardMaterial({ color: 0x455a64, roughness: 0.5 });
  const dogBase = new THREE.Mesh(dogBaseGeo, dogBaseMat);
  dogBase.position.y = 0.03;
  dogDockGroup.add(dogBase);

  // 简化版小机器狗模型 (积木四足车体)
  const dogBodyGeo = new THREE.BoxGeometry(0.35, 0.14, 0.22);
  const dogBodyMat = new THREE.MeshStandardMaterial({ color: 0xffb300, roughness: 0.4 });
  const dogBody = new THREE.Mesh(dogBodyGeo, dogBodyMat);
  dogBody.position.set(0, 0.22, 0);
  dogDockGroup.add(dogBody);
  controlRoomGroup.add(dogDockGroup);

  farmGroup.add(controlRoomGroup);

  // 5. 环绕农田的环境要素（木栅栏、小推车、果树）
  createEnvironmentDetails(farmGroup, materials);

  // 6. 滴灌水流粒子效果
  const dripParticles = createDripWaterSystem(FARM_CONFIG.plots);
  farmGroup.add(dripParticles.group);

  // 7. 穿梭在 3m×3m 格子通道之间的乐高拼搭自动运输小车
  // 01号小车：穿行在西侧南北纵向小道 (地块01、04与02、05之间)，负责果蔬采摘自动化转运
  const rover1 = createLegoRover({
    id: 'LegoRover_1',
    name: '01号 乐高自动果蔬转运车',
    child: '晨晨 & 浩浩 联合拼搭',
    primaryColor: 0xdf2828, // 经典乐高红
    accentColor: 0xffffff,
    cargoType: 'fruits',
    axis: 'z',
    fixedCoord: -2.25,
    minBound: -3.0,
    maxBound: 6.8,
    startPos: new THREE.Vector3(-2.25, 0, -1.0),
    speed: 0.85,
    mats: materials,
  });
  farmGroup.add(rover1.group);

  // 02号小车：穿行在中央东西横向大道 (北排地块与南排地块之间)，负责巡检与工具/传感器补给
  const rover2 = createLegoRover({
    id: 'LegoRover_2',
    name: '02号 乐高巡检与工具补给车',
    child: '乐乐 & 糖糖 联合拼搭',
    primaryColor: 0x0288d1, // 经典乐高蓝
    accentColor: 0xffca28, // 乐高亮黄
    cargoType: 'tools',
    axis: 'x',
    fixedCoord: 2.75,
    minBound: -5.6,
    maxBound: 5.6,
    startPos: new THREE.Vector3(-3.5, 0, 2.75),
    speed: 0.72,
    mats: materials,
  });
  farmGroup.add(rover2.group);

  return {
    group: farmGroup,
    interactables: plotInteractables.concat([
      rackGroup,
      agentDeskGroup,
      monitorWallGroup,
      consoleGroup,
      rover1.group,
      rover2.group,
    ]),
    dripSystem: dripParticles,
    rovers: [rover1, rover2],
    materials,
  };
}

// 辅助函数：根据地块特色生成作物与装置
function addPlotContents(plotGroup, pData, mats) {
  const pid = pData.id;

  if (pid === 1) {
    // 晨晨的番茄搭架与自动滴灌
    // 4组人字形竹竿支架
    for (let i = 0; i < 4; i++) {
      const stake1 = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.015, 1.4, 6),
        mats.woodCurb,
      );
      stake1.rotation.z = 0.2;
      stake1.position.set(-0.7 + i * 0.45, 0.7, -0.4);
      plotGroup.add(stake1);

      const stake2 = new THREE.Mesh(
        new THREE.CylinderGeometry(0.015, 0.015, 1.4, 6),
        mats.woodCurb,
      );
      stake2.rotation.z = -0.2;
      stake2.position.set(-0.7 + i * 0.45, 0.7, 0.4);
      plotGroup.add(stake2);

      // 茂密的番茄灌木团
      const bushGeo = new THREE.SphereGeometry(0.28, 8, 8);
      const bush = new THREE.Mesh(bushGeo, mats.foliageTomato);
      bush.position.set(-0.7 + i * 0.45, 0.65, 0);
      bush.scale.set(0.9, 1.4, 0.9);
      plotGroup.add(bush);

      // 挂枝小番茄 (红点)
      for (let t = 0; t < 3; t++) {
        const tomGeo = new THREE.SphereGeometry(0.038, 8, 8);
        const tom = new THREE.Mesh(tomGeo, mats.tomatoFruit);
        tom.position.set(-0.7 + i * 0.45 + (t - 1) * 0.12, 0.5 + t * 0.15, 0.2);
        plotGroup.add(tom);
      }
    }
  } else if (pid === 2) {
    // 浩浩的向日葵向光试验
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const stemH = 1.3 + (row + col) * 0.1;
        const stem = new THREE.Mesh(
          new THREE.CylinderGeometry(0.02, 0.02, stemH, 6),
          mats.foliageTomato,
        );
        stem.position.set(-0.8 + col * 0.8, stemH / 2 + 0.1, -0.8 + row * 0.8);
        plotGroup.add(stem);

        // 花盘金黄花瓣
        const diskGeo = new THREE.CylinderGeometry(0.18, 0.18, 0.04, 16);
        const disk = new THREE.Mesh(diskGeo, mats.sunflowerPetal);
        disk.rotation.x = 0.4;
        disk.position.set(-0.8 + col * 0.8, stemH + 0.1, -0.8 + row * 0.8);
        plotGroup.add(disk);

        // 花盘中心深棕色葵花籽盘
        const center = new THREE.Mesh(
          new THREE.CylinderGeometry(0.1, 0.1, 0.045, 12),
          mats.sunflowerCenter,
        );
        center.rotation.x = 0.4;
        center.position.set(-0.8 + col * 0.8, stemH + 0.11, -0.8 + row * 0.8);
        plotGroup.add(center);
      }
    }
  } else if (pid === 3) {
    // 悠悠的草莓立体阶梯架 (三层)
    for (let tier = 0; tier < 3; tier++) {
      const tierGeo = new THREE.BoxGeometry(2.4, 0.2, 0.6);
      const tierBox = new THREE.Mesh(tierGeo, mats.woodCurb);
      tierBox.position.set(0, 0.25 + tier * 0.3, -0.7 + tier * 0.7);
      plotGroup.add(tierBox);

      // 草莓丛
      for (let s = 0; s < 5; s++) {
        const berryFoliage = new THREE.Mesh(
          new THREE.SphereGeometry(0.14, 6, 6),
          mats.foliageTomato,
        );
        berryFoliage.position.set(-0.9 + s * 0.45, 0.4 + tier * 0.3, -0.7 + tier * 0.7);
        plotGroup.add(berryFoliage);

        const redBerry = new THREE.Mesh(new THREE.SphereGeometry(0.035, 6, 6), mats.tomatoFruit);
        redBerry.position.set(-0.9 + s * 0.45, 0.32 + tier * 0.3, -0.55 + tier * 0.7);
        plotGroup.add(redBerry);
      }
    }
  } else if (pid === 4) {
    // 乐乐的南瓜爬藤与防鸟风车
    // 地面大南瓜叶片堆与南瓜
    const leafGroupGeo = new THREE.CylinderGeometry(0.7, 0.9, 0.2, 8);
    const leafMound = new THREE.Mesh(leafGroupGeo, mats.foliageTomato);
    leafMound.position.set(0, 0.28, 0);
    plotGroup.add(leafMound);

    // 橘色大南瓜
    const pumpkinMat = new THREE.MeshStandardMaterial({ color: 0xf57c00, roughness: 0.5 });
    const pumpkin = new THREE.Mesh(new THREE.SphereGeometry(0.24, 12, 10), pumpkinMat);
    pumpkin.scale.set(1.2, 0.8, 1.2);
    pumpkin.position.set(-0.5, 0.3, 0.4);
    plotGroup.add(pumpkin);

    // 孩子手作彩色小风车 (防鸟试验)
    const pinPole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 1.0, 6),
      mats.whiteAppliance,
    );
    pinPole.position.set(0.8, 0.6, -0.8);
    plotGroup.add(pinPole);

    const pinwheel = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.08, 4), mats.sunflowerPetal);
    pinwheel.rotation.x = Math.PI / 2;
    pinwheel.position.set(0.8, 1.1, -0.8);
    plotGroup.add(pinwheel);
  } else if (pid === 5) {
    // 糖糖的生菜与遮阳网试验
    // 半幅伸缩黑色遮阳网支架
    const frameGeo = new THREE.BoxGeometry(2.6, 0.9, 1.3);
    const wireFrame = new THREE.Mesh(
      frameGeo,
      new THREE.MeshBasicMaterial({ color: 0x455a64, wireframe: true }),
    );
    wireFrame.position.set(0, 0.65, -0.6);
    plotGroup.add(wireFrame);

    const shadeNetGeo = new THREE.PlaneGeometry(2.55, 1.25);
    const shadeMat = new THREE.MeshStandardMaterial({
      color: 0x1c2833,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
    });
    const shadeNet = new THREE.Mesh(shadeNetGeo, shadeMat);
    shadeNet.rotation.x = Math.PI / 2;
    shadeNet.position.set(0, 1.1, -0.6);
    plotGroup.add(shadeNet);

    // 生菜矩阵（球状生菜）
    for (let gx = 0; gx < 5; gx++) {
      for (let gz = 0; gz < 5; gz++) {
        const lettuce = new THREE.Mesh(
          new THREE.SphereGeometry(0.12, 6, 6),
          new THREE.MeshStandardMaterial({ color: gz < 3 ? 0x66bb6a : 0x81c784, roughness: 0.7 }),
        );
        lettuce.scale.set(1.2, 0.7, 1.2);
        lettuce.position.set(-0.8 + gx * 0.4, 0.28, -0.8 + gz * 0.4);
        plotGroup.add(lettuce);
      }
    }
  } else if (pid === 6) {
    // 新试验留白区（整平耕地与工具箱、水壶，等待下一位孩子）
    const boxMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.4 });
    const toolBox = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.3), boxMat);
    toolBox.position.set(-0.8, 0.32, 0.8);
    plotGroup.add(toolBox);

    // 小铁锹 (孩子工具)
    const spadeHandle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 0.7, 6),
      mats.lightTimber,
    );
    spadeHandle.rotation.z = -0.3;
    spadeHandle.position.set(-0.5, 0.4, 0.8);
    plotGroup.add(spadeHandle);
  }
}

// 模拟水流与微喷粒子
function createDripWaterSystem(plots) {
  const particleCount = 180;
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(particleCount * 3);
  const speeds = new Float32Array(particleCount);

  let idx = 0;
  for (let i = 0; i < particleCount; i++) {
    const targetPlot = plots[i % plots.length];
    positions[idx] = targetPlot.x + (Math.random() - 0.5) * 2.2;
    positions[idx + 1] = 0.25 + Math.random() * 0.2;
    positions[idx + 2] = targetPlot.z + (Math.random() - 0.5) * 2.2;
    speeds[i] = 0.008 + Math.random() * 0.012;
    idx += 3;
  }

  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.PointsMaterial({
    color: 0x4fc3f7,
    size: 0.045,
    transparent: true,
    opacity: 0.75,
  });

  const particleMesh = new THREE.Points(geometry, material);
  particleMesh.visible = true;

  const update = () => {
    const pos = geometry.attributes.position.array;
    for (let i = 0; i < particleCount; i++) {
      const yIdx = i * 3 + 1;
      pos[yIdx] -= speeds[i];
      if (pos[yIdx] < 0.2) {
        pos[yIdx] = 0.42;
      }
    }
    geometry.attributes.position.needsUpdate = true;
  };

  return {
    group: particleMesh,
    update,
    setVisible: (v) => {
      particleMesh.visible = v;
    },
  };
}

// 场地外围装饰物（果树、围栏、推车）
function createEnvironmentDetails(farmGroup, mats) {
  // 果树 4 棵
  const treeCoords = [
    [-12, -4],
    [-12, 6],
    [12, -4],
    [12, 6],
  ];
  treeCoords.forEach(([tx, tz]) => {
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.26, 3.2, 8), mats.woodCurb);
    trunk.position.set(tx, 1.6, tz);
    trunk.castShadow = true;
    farmGroup.add(trunk);

    const foliage = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 8), mats.foliageTomato);
    foliage.position.set(tx, 3.8, tz);
    foliage.castShadow = true;
    farmGroup.add(foliage);
  });

  // 农场外围简易木栅栏 (白色农场围栏)
  const fenceMat = new THREE.MeshStandardMaterial({ color: 0xeeece5, roughness: 0.7 });
  for (let fx = -14; fx <= 14; fx += 2.5) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.1, 0.1), fenceMat);
    post.position.set(fx, 0.55, 12);
    farmGroup.add(post);
  }
  const railGeo = new THREE.BoxGeometry(29, 0.08, 0.04);
  const rail1 = new THREE.Mesh(railGeo, fenceMat);
  rail1.position.set(0, 0.85, 12);
  farmGroup.add(rail1);
  const rail2 = new THREE.Mesh(railGeo, fenceMat);
  rail2.position.set(0, 0.45, 12);
  farmGroup.add(rail2);
}

// 动态生成 G 老师 Agent 屏幕 Canvas 纹理
function createAgentScreenTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  // 深色科幻生态底色
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, 1024, 512);

  // 顶栏 Header
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 0, 1024, 60);

  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText('ZHJIE FARM · G 老师农场 AI-Lab 协同中枢', 30, 40);

  ctx.fillStyle = '#4ade80';
  ctx.font = '18px sans-serif';
  ctx.fillText('● 边缘集群正常 · 6/6 地块在线', 720, 40);

  // 左栏：实时数据与提问闭环
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(30, 80, 460, 400);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('【孩子问题与实验闭环】', 50, 120);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '16px sans-serif';
  ctx.fillText('晨晨：为什么番茄叶尖周一会卷起来？', 50, 160);

  ctx.fillStyle = '#38bdf8';
  ctx.fillText('G 老师建议：对比 01号地块与05号光照记录，', 50, 200);
  ctx.fillText('结合土壤湿度传感器读数(42%)排查是否为中午蒸腾过盛。', 50, 230);

  ctx.fillStyle = '#f59e0b';
  ctx.fillText('现场尝试：下午加装简易纸板遮阳罩观察2天。', 50, 280);

  ctx.fillStyle = '#4ade80';
  ctx.fillText('复盘结果：新叶舒展，水分维持稳定，验证有效！', 50, 330);

  // 右栏：六地块状态微缩图
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(520, 80, 470, 400);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('【3m×3m 专属地块综合指标】', 540, 120);

  const plotsBrief = [
    '01 晨晨 · 番茄滴灌：温 22.4℃ 湿 42% [滴灌就绪]',
    '02 浩浩 · 向日葵：日照 8.5h 追光角 62°',
    '03 悠悠 · 草莓立体架：湿 45% [提示底层补光]',
    '04 乐乐 · 南瓜爬藤：长势旺盛 面积扩充 28%',
    '05 糖糖 · 遮阳生菜：甜度蓄积期 遮阳率 50%',
    '06 留白地块 · 待立案：土壤肥力指数 A级',
  ];

  ctx.font = '15px monospace';
  plotsBrief.forEach((str, i) => {
    ctx.fillStyle = i === 2 ? '#f87171' : '#cbd5e1';
    ctx.fillText(str, 540, 170 + i * 46);
  });

  return canvas;
}

// 动态生成监控大屏 CCTV 画面纹理 (6路分屏)
function createCctvTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 768;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, 768, 512);

  const rows = 2;
  const cols = 3;
  const w = 768 / cols;
  const h = 512 / rows;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c + 1;
      const x = c * w;
      const y = r * h;

      // 视窗边框
      ctx.strokeStyle = '#27272a';
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);

      // 假视频画面背景
      ctx.fillStyle = r === 0 ? '#18281d' : '#142028';
      ctx.fillRect(x + 2, y + 2, w - 4, h - 4);

      // 模拟 CV 目标识别绿框
      ctx.strokeStyle = '#22c55e';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 40, y + 50, 80, 70);

      ctx.fillStyle = '#22c55e';
      ctx.font = '11px monospace';
      ctx.fillText(`CROP_DET#${idx} 98%`, x + 40, y + 45);

      // 摄像机编号与 REC 状态
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(x + 18, y + 22, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#f4f4f5';
      ctx.font = '12px sans-serif';
      ctx.fillText(`CAM-0${idx} · 3m×3m #${idx}`, x + 30, y + 26);
    }
  }

  return canvas;
}

// 乐高拼搭风自动运输小车工厂函数
function createLegoRover({
  id,
  name,
  child,
  primaryColor,
  accentColor,
  cargoType,
  axis,
  fixedCoord,
  minBound,
  maxBound,
  startPos,
  speed,
  mats,
}) {
  const roverGroup = new THREE.Group();
  roverGroup.name = id;
  roverGroup.position.copy(startPos);

  const legoMatPrimary = new THREE.MeshStandardMaterial({
    color: primaryColor,
    roughness: 0.25,
    metalness: 0.05,
  });
  const legoMatAccent = new THREE.MeshStandardMaterial({
    color: accentColor,
    roughness: 0.25,
    metalness: 0.05,
  });

  // 1. 底盘黑色乐高基板 (Chassis base plate)
  const baseGeo = new THREE.BoxGeometry(0.74, 0.05, 0.46);
  const base = new THREE.Mesh(baseGeo, mats.legoBlack);
  base.position.y = 0.11;
  base.castShadow = true;
  roverGroup.add(base);

  // 2. 主体彩色乐高积木层 (Main brick body)
  const bodyGeo = new THREE.BoxGeometry(0.7, 0.08, 0.42);
  const body = new THREE.Mesh(bodyGeo, legoMatPrimary);
  body.position.y = 0.175;
  body.castShadow = true;
  roverGroup.add(body);

  // 3. 经典乐高凸点阵列 (LEGO Studs Lattice)
  const studGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.012, 10);
  for (let sx = -3; sx <= 3; sx++) {
    for (let sz = -2; sz <= 2; sz++) {
      // 留出货箱与传感器位置
      if (sx > 0 && Math.abs(sz) <= 1) continue;
      const stud = new THREE.Mesh(studGeo, legoMatPrimary);
      stud.position.set(sx * 0.09, 0.22, sz * 0.09);
      stud.castShadow = true;
      roverGroup.add(stud);
    }
  }

  // 4. 四个乐高越野大车轮 (LEGO Technic-style wheels)
  const wheels = [];
  const tireGeo = new THREE.CylinderGeometry(0.095, 0.095, 0.065, 16);
  tireGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.068, 16);
  rimGeo.rotateZ(Math.PI / 2);

  const wheelOffsets = [
    [-0.24, 0.095, -0.24], // 前左
    [0.24, 0.095, -0.24], // 后左
    [-0.24, 0.095, 0.24], // 前右
    [0.24, 0.095, 0.24], // 后右
  ];

  wheelOffsets.forEach(([wx, wy, wz]) => {
    const wheelGroup = new THREE.Group();
    wheelGroup.position.set(wx, wy, wz);

    const tire = new THREE.Mesh(tireGeo, mats.rubberTire);
    tire.castShadow = true;
    wheelGroup.add(tire);

    const rim = new THREE.Mesh(rimGeo, mats.legoYellow);
    wheelGroup.add(rim);

    // 乐高十字轴心插栓
    const cap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 0.072, 8).rotateZ(Math.PI / 2),
      mats.legoBlack,
    );
    wheelGroup.add(cap);

    roverGroup.add(wheelGroup);
    wheels.push(wheelGroup);
  });

  // 5. 乐高智能主控积木 (LEGO Smart Hub Block)
  const hubGeo = new THREE.BoxGeometry(0.25, 0.13, 0.22);
  const hub = new THREE.Mesh(hubGeo, mats.legoWhite);
  hub.position.set(-0.16, 0.28, 0);
  hub.castShadow = true;
  roverGroup.add(hub);

  // 主控 5x5 LED 状态屏
  const screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 0.08), mats.legoSensorEye);
  screenMesh.rotation.y = -Math.PI / 2;
  screenMesh.position.set(-0.286, 0.28, 0);
  roverGroup.add(screenMesh);

  // 顶部开机按键
  const btn = new THREE.Mesh(
    new THREE.CylinderGeometry(0.018, 0.018, 0.015, 12),
    mats.legoSensorEye,
  );
  btn.position.set(-0.16, 0.35, 0);
  roverGroup.add(btn);

  // 6. 前端超声波避障双眼传感器 (LEGO Ultrasonic Sensor "Eyes")
  const eyeBar = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.07, 0.18), mats.legoBlack);
  eyeBar.position.set(-0.36, 0.2, 0);
  roverGroup.add(eyeBar);

  for (const eyeSide of [-0.05, 0.05]) {
    const eyeRing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.026, 0.026, 0.02, 12).rotateZ(Math.PI / 2),
      legoMatAccent,
    );
    eyeRing.position.set(-0.38, 0.2, eyeSide);
    roverGroup.add(eyeRing);

    const eyeLens = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.018, 0.024, 12).rotateZ(Math.PI / 2),
      mats.legoSensorEye,
    );
    eyeLens.position.set(-0.382, 0.2, eyeSide);
    roverGroup.add(eyeLens);
  }

  // 7. 后部货厢与载荷
  if (cargoType === 'fruits') {
    // 01号小车：黄色果蔬采摘箱，装满刚采摘的千禧小番茄
    const crateGeo = new THREE.BoxGeometry(0.3, 0.12, 0.3);
    const crate = new THREE.Mesh(crateGeo, mats.legoYellow);
    crate.position.set(0.16, 0.27, 0);
    crate.castShadow = true;
    roverGroup.add(crate);

    // 箱内小番茄
    for (let f = 0; f < 6; f++) {
      const tom = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 8), mats.tomatoFruit);
      tom.position.set(0.1 + (f % 3) * 0.06, 0.35, -0.07 + Math.floor(f / 3) * 0.14);
      roverGroup.add(tom);
    }

    // 乐高天线小旗帜
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.42, 6), mats.legoWhite);
    mast.position.set(0.3, 0.42, 0.12);
    roverGroup.add(mast);

    const flag = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.1, 3), legoMatPrimary);
    flag.rotation.z = Math.PI / 2;
    flag.position.set(0.34, 0.58, 0.12);
    roverGroup.add(flag);
  } else {
    // 02号小车：巡检仪器货架，搭载土壤探针与备用滴灌管接头
    const rackBox = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.1, 0.3), mats.legoBlack);
    rackBox.position.set(0.16, 0.26, 0);
    roverGroup.add(rackBox);

    // 备用土壤探针
    const spareProbe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.24, 8).rotateZ(Math.PI / 2),
      mats.darkSteel,
    );
    spareProbe.position.set(0.16, 0.33, -0.06);
    roverGroup.add(spareProbe);

    // 顶部橙色警示闪烁灯
    const beaconStem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.18, 8),
      mats.darkSteel,
    );
    beaconStem.position.set(0.16, 0.36, 0.08);
    roverGroup.add(beaconStem);

    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.028, 0.05, 10),
      mats.legoOrangeBeacon,
    );
    beacon.position.set(0.16, 0.46, 0.08);
    roverGroup.add(beacon);
  }

  // 绑定用户交互属性
  roverGroup.userData = {
    type: 'lego_rover',
    title: name,
    child: child,
    speed: `${speed} m/s (自动巡航)`,
    payload: cargoType === 'fruits' ? '3.2 kg (千禧番茄采收箱)' : '2.1 kg (备用探针与滴灌阀)',
    battery: '88% (锂电+顶面微充)',
    question:
      cargoType === 'fruits'
        ? '孩子编程控制小车在田埂通道巡线，满载后自动将番茄运回控制室冷藏。'
        : '沿主横道全天候巡回，随时为各试验田提供备用传感器与管道接头。',
    desc:
      cargoType === 'fruits'
        ? '【晨晨与浩浩的乐高拼搭成果】\n底盘由经典大颗粒积木与双电机减速齿轮箱构成。孩子在 G 老师指导下编写了避障与巡线逻辑，在 3m×3m 田块之间的砂石通道自主往返，把采收的番茄从地头运送到控制室门口。'
        : '【乐乐与糖糖的乐高巡检补给车】\n搭载超声波雷达与工具承载架，在南北横向主通道上来回巡视，随时为需要检修探针或更换微喷接头的地块提供零配件。',
  };

  // 巡航状态机
  let currentCoord = axis === 'z' ? startPos.z : startPos.x;
  let direction = 1;

  const update = (dt) => {
    const safeDt = Math.min(dt, 0.1);
    const moveDist = speed * safeDt * direction;
    currentCoord += moveDist;

    // 边界反向
    if (direction > 0 && currentCoord >= maxBound) {
      currentCoord = maxBound;
      direction = -1;
    } else if (direction < 0 && currentCoord <= minBound) {
      currentCoord = minBound;
      direction = 1;
    }

    if (axis === 'z') {
      roverGroup.position.z = currentCoord;
      roverGroup.position.x = fixedCoord;
      // 朝向调整：沿 Z 轴移动时的车头方向
      roverGroup.rotation.y = direction > 0 ? -Math.PI / 2 : Math.PI / 2;
    } else {
      roverGroup.position.x = currentCoord;
      roverGroup.position.z = fixedCoord;
      roverGroup.rotation.y = direction > 0 ? Math.PI : 0;
    }

    // 车轮随前进距离真实滚动 (v = w * r, delta theta = dist / r)
    const dTheta = (speed * safeDt) / 0.095;
    wheels.forEach((w) => {
      w.rotation.x += dTheta;
    });
  };

  return {
    group: roverGroup,
    update,
  };
}
