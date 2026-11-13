import * as THREE from 'three';
import { farmSurface, farmLeafGeometry, farmInstances, farmRod } from './farm-surfaces.js';

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
      device: '自制储水桶和滴灌水管',
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
      device: '随光线转动的支架',
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
      device: '三层木架和离地防虫托盘',
      question: '为什么最底下一层的草莓叶子容易发黄？',
      soilMoisture: 45,
      soilTemp: 21.8,
      lightHours: 6.1,
      status: '留意下层光照',
      x: 4.5,
      z: 0.0,
    },
    {
      id: 4,
      name: '04 · 乐乐的南瓜爬藤与防鸟风车',
      child: '乐乐 (7岁)',
      crop: '板栗南瓜',
      stage: '蔓生伸长期 (第3周)',
      device: '竹木藤架和反光风车',
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
      device: '拉绳遮阳帘和光照计',
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
      name: '06 · 等你来种的一块地',
      child: '欢迎一起种植',
      crop: '已整理的土壤',
      stage: '准备阶段',
      device: '土壤温湿度传感器',
      question: '你想在这里种什么？又想做个什么装置？',
      soilMoisture: 35,
      soilTemp: 21.0,
      lightHours: 7.9,
      status: '准备种植',
      x: 4.5,
      z: 5.5,
    },
  ],
};

export function createFarmScene() {
  const farmGroup = new THREE.Group();
  farmGroup.name = 'ZhijieFarmRoot';

  const soilMap = farmSurface('soil', 3, 3);
  const woodMap = farmSurface('wood');
  const grassMap = farmSurface('grass', 80, 80);
  const gravelMap = farmSurface('gravel');
  const solarMap = farmSurface('solar');

  // 共享材质池
  const materials = {
    soil: new THREE.MeshStandardMaterial({
      color: 0x423121,
      roughness: 0.95,
      metalness: 0.05,
    }),
    soilBedTilled: new THREE.MeshStandardMaterial({
      map: soilMap,
      bumpMap: soilMap,
      bumpScale: 0.035,
      roughness: 1,
    }),
    woodCurb: new THREE.MeshStandardMaterial({
      map: woodMap,
      color: 0xbba17d,
      bumpMap: woodMap,
      bumpScale: 0.012,
      roughness: 0.88,
    }),
    grass: new THREE.MeshStandardMaterial({
      map: grassMap,
      roughness: 1,
      vertexColors: true,
    }),
    gravelPath: new THREE.MeshStandardMaterial({
      map: gravelMap,
      bumpMap: gravelMap,
      bumpScale: 0.025,
      roughness: 1,
    }),
    deckWood: new THREE.MeshStandardMaterial({
      map: woodMap,
      color: 0xe3cba9,
      bumpMap: woodMap,
      bumpScale: 0.012,
      roughness: 0.82,
    }),
    darkSteel: new THREE.MeshStandardMaterial({
      color: 0x222629,
      roughness: 0.4,
      metalness: 0.8,
    }),
    lightTimber: new THREE.MeshStandardMaterial({
      map: woodMap,
      color: 0xffedcf,
      roughness: 0.78,
    }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0xe8f4f8,
      transparent: true,
      opacity: 0.22,
      roughness: 0.16,
      metalness: 0.15,
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
      color: 0x4b693b,
      roughness: 0.95,
    }),
    tomatoFruit: new THREE.MeshStandardMaterial({
      color: 0xc4482e,
      roughness: 0.48,
    }),
    sunflowerPetal: new THREE.MeshStandardMaterial({
      color: 0xf3bf46,
      roughness: 0.85,
      side: THREE.DoubleSide,
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
      map: solarMap,
      roughness: 0.32,
      metalness: 0.45,
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
  const groundGeo = new THREE.PlaneGeometry(180, 180, 64, 64);
  const groundColors = [];
  const groundPosition = groundGeo.getAttribute('position');
  for (let i = 0; i < groundPosition.count; i++) {
    const x = groundPosition.getX(i),
      z = groundPosition.getY(i);
    const tone = 0.91 + 0.055 * Math.sin(x * 0.31) * Math.cos(z * 0.27);
    groundColors.push(tone, tone, tone * 0.95);
  }
  groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(groundColors, 3));
  const ground = new THREE.Mesh(groundGeo, materials.grass);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  farmGroup.add(ground);

  function pathMaterial(width, length) {
    const material = materials.gravelPath.clone();
    const map = gravelMap.clone();
    map.repeat.set(width * 2, length * 2);
    material.map = material.bumpMap = map;
    return material;
  }

  // 场地通道网络（围绕与穿插 3m×3m 格子之间，便于孩子走动与乐高小车运输）
  // 通道 1：西侧纵向通道 (x = -2.25m，连接地块01、04与控制室)
  const pathWestGeo = new THREE.PlaneGeometry(1.5, 14);
  const pathWest = new THREE.Mesh(pathWestGeo, pathMaterial(1.5, 14));
  pathWest.rotation.x = -Math.PI / 2;
  pathWest.position.set(-2.25, 0.015, 2.0);
  pathWest.receiveShadow = true;
  farmGroup.add(pathWest);

  // 通道 2：东侧纵向通道 (x = +2.25m，连接地块02、03、05、06与控制室)
  const pathEastGeo = new THREE.PlaneGeometry(1.5, 14);
  const pathEast = new THREE.Mesh(pathEastGeo, pathMaterial(1.5, 14));
  pathEast.rotation.x = -Math.PI / 2;
  pathEast.position.set(2.25, 0.015, 2.0);
  pathEast.receiveShadow = true;
  farmGroup.add(pathEast);

  // 通道 3：中央横向主通道 (z = 2.75m，穿插于第一排与第二排 3m×3m 田块之间，宽 2.4m)
  const pathCrossGeo = new THREE.PlaneGeometry(16, 2.4);
  const pathCross = new THREE.Mesh(pathCrossGeo, pathMaterial(16, 2.4));
  pathCross.rotation.x = -Math.PI / 2;
  pathCross.position.set(0, 0.016, 2.75);
  pathCross.receiveShadow = true;
  farmGroup.add(pathCross);

  // 通道 4：北侧控制室木露台前坪通道 (z = -3.2m，宽 2.4m)
  const pathNorthGeo = new THREE.PlaneGeometry(16, 2.4);
  const pathNorth = new THREE.Mesh(pathNorthGeo, pathMaterial(16, 2.4));
  pathNorth.rotation.x = -Math.PI / 2;
  pathNorth.position.set(0, 0.016, -3.2);
  pathNorth.receiveShadow = true;
  farmGroup.add(pathNorth);

  // 通道 5：南侧田块外缘通道 (z = 8.0m，宽 1.8m)
  const pathSouthGeo = new THREE.PlaneGeometry(16, 1.8);
  const pathSouth = new THREE.Mesh(pathSouthGeo, pathMaterial(16, 1.8));
  pathSouth.rotation.x = -Math.PI / 2;
  pathSouth.position.set(0, 0.016, 8.0);
  pathSouth.receiveShadow = true;
  farmGroup.add(pathSouth);

  // 2. 孩子专属 3m x 3m 种植地块
  const plotInteractables = [];

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

    // Raised soil rows keep the irrigation lines legible at close range.
    const ridges = [];
    for (let row = 0; row < 7; row++) {
      ridges.push({ position: [-1.05 + row * 0.35, 0.213, 0], scale: [0.1, 0.035, 1.29] });
    }
    farmInstances(
      plotGroup,
      '耕作土垄',
      new THREE.SphereGeometry(1, 10, 6),
      materials.soilBedTilled,
      ridges,
    );
    const cornerCaps = [];
    for (const x of [-1.43, 1.43])
      for (const z of [-1.43, 1.43]) {
        cornerCaps.push({ position: [x, 0.12, z] });
      }
    farmInstances(
      plotGroup,
      '木框角柱',
      new THREE.BoxGeometry(0.13, 0.24, 0.13),
      materials.woodCurb,
      cornerCaps,
    );

    // 专属标牌与编号（地块铭牌木桩）
    const signStakeGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.9, 8);
    const signStake = new THREE.Mesh(signStakeGeo, materials.woodCurb);
    signStake.position.set(-1.25, 0.45, 1.25);
    signStake.castShadow = true;
    plotGroup.add(signStake);

    const signBoardGeo = new THREE.BoxGeometry(0.52, 0.32, 0.035);
    const signBoardMat = new THREE.MeshStandardMaterial({
      color: 0x334433,
      roughness: 0.5,
    });
    const signBoard = new THREE.Mesh(signBoardGeo, signBoardMat);
    signBoard.position.set(-1.25, 0.8, 1.25);
    signBoard.rotation.y = -Math.PI / 6;
    plotGroup.add(signBoard);
    const labelCanvas = document.createElement('canvas');
    labelCanvas.width = 256;
    labelCanvas.height = 160;
    const label = labelCanvas.getContext('2d');
    label.fillStyle = '#304439';
    label.fillRect(0, 0, 256, 160);
    label.fillStyle = '#f4ebcf';
    label.font = '600 70px sans-serif';
    label.textAlign = 'center';
    label.fillText(String(pData.id).padStart(2, '0'), 128, 83);
    label.font = '25px sans-serif';
    label.fillText(['番茄', '向日葵', '草莓', '南瓜', '生菜', '等你来种'][pData.id - 1], 128, 132);
    const labelMap = new THREE.CanvasTexture(labelCanvas);
    labelMap.colorSpace = THREE.SRGBColorSpace;
    const labelFace = new THREE.Mesh(
      new THREE.PlaneGeometry(0.49, 0.3),
      new THREE.MeshStandardMaterial({ map: labelMap, roughness: 1 }),
    );
    labelFace.position.z = 0.019;
    signBoard.add(labelFace);

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
    plotInteractables.push(plotGroup);
  });

  // 3. 共用控制室 Hub (Modern Eco-Tech Modular Lab)
  const roomConfig = FARM_CONFIG.controlRoom;
  const controlRoomGroup = new THREE.Group();
  controlRoomGroup.name = 'ControlRoomHub';
  controlRoomGroup.position.set(roomConfig.x, 0, roomConfig.z);

  // 控制室地台基座（抬高 0.25m，带外伸户外木露台）
  const deckGeo = new THREE.BoxGeometry(roomConfig.width + 1.6, 0.21, roomConfig.depth + 2.0);
  const deck = new THREE.Mesh(deckGeo, materials.deckWood);
  deck.position.set(0, 0.105, 0.5);
  deck.receiveShadow = true;
  controlRoomGroup.add(deck);
  const deckBoards = [];
  for (let i = 0; i < 32; i++) {
    deckBoards.push({
      position: [-4.65 + i * 0.3, 0.23, 0.5],
      color: i % 3 === 0 ? '#e6d6bd' : '#ffffff',
    });
  }
  farmInstances(
    controlRoomGroup,
    '露台木板',
    new THREE.BoxGeometry(0.288, 0.04, 7),
    materials.deckWood,
    deckBoards,
  );
  const step = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.12, 0.5), materials.deckWood);
  step.position.set(0, 0.06, 4.22);
  step.receiveShadow = true;
  controlRoomGroup.add(step);

  // 控制室主体框架（梁柱体系与不重叠围护结构，彻底消除共面闪烁）
  const h = roomConfig.height; // 3.2m
  const w = roomConfig.width; // 8.0m
  const d = roomConfig.depth; // 5.0m
  const colSize = 0.2; // 20cm 柱体
  const wallT = 0.16; // 16cm 墙厚

  // 地板（室内木质地坪，置于地台上方，内缩 10cm 杜绝与地台/外墙共面）
  const floorGeo = new THREE.BoxGeometry(w - colSize * 2, 0.02, d - colSize * 2);
  const floorMat = new THREE.MeshStandardMaterial({
    map: woodMap,
    color: 0xfff2dd,
    roughness: 0.82,
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
  const cladding = [];
  for (const side of [-1, 1])
    for (let i = 0; i < 30; i++) {
      cladding.push({
        position: [side * (w / 2 + 0.025), h / 2 + 0.25, -2.32 + i * 0.16],
        color: i % 4 === 0 ? '#c8b698' : '#eee0c9',
      });
    }
  farmInstances(
    controlRoomGroup,
    '外墙竖向木饰面',
    new THREE.BoxGeometry(0.055, h - 0.08, 0.145),
    materials.lightTimber,
    cladding,
  );

  // 南向全景落地玻璃幕墙（嵌于门框立柱间，位置内缩 12cm，设置 depthWrite=false）
  const glassGeo = new THREE.BoxGeometry(w - colSize * 2, h - 0.15, 0.03);
  const frontGlass = new THREE.Mesh(glassGeo, materials.glass);
  frontGlass.position.set(0, h / 2 + 0.25, d / 2 - 0.12);
  controlRoomGroup.add(frontGlass);
  const glazingBars = [];
  for (const x of [-2.55, 0, 2.55]) glazingBars.push({ position: [x, h / 2 + 0.25, d / 2 - 0.08] });
  farmInstances(
    controlRoomGroup,
    '玻璃细框',
    new THREE.BoxGeometry(0.038, h - 0.15, 0.055),
    materials.darkSteel,
    glazingBars,
  );
  for (const x of [-0.13, 0.13])
    farmRod(
      controlRoomGroup,
      materials.darkSteel,
      [x, 1.15, d / 2 - 0.01],
      [x, 1.65, d / 2 - 0.01],
      0.018,
    );

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
  roof.receiveShadow = true;
  controlRoomGroup.add(roof);
  const soffit = new THREE.Mesh(
    new THREE.BoxGeometry(w + 0.45, 0.045, d + 0.45),
    materials.lightTimber,
  );
  soffit.position.set(0, h + 0.25, 0);
  controlRoomGroup.add(soffit);
  materials.warmFixture = new THREE.MeshStandardMaterial({
    color: 0xffe8bd,
    emissive: 0xffbc70,
    emissiveIntensity: 0.5,
    roughness: 0.5,
  });
  const porchLight = new THREE.Mesh(
    new THREE.BoxGeometry(w - 0.4, 0.028, 0.035),
    materials.warmFixture,
  );
  porchLight.position.set(0, h + 0.22, d / 2 + 0.16);
  controlRoomGroup.add(porchLight);

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
      const frame = new THREE.Mesh(
        new THREE.BoxGeometry(pvWidth + 0.055, 0.045, pvDepth + 0.055),
        materials.darkSteel,
      );
      frame.position.copy(pv.position);
      frame.rotation.copy(pv.rotation);
      frame.position.y -= 0.008;
      controlRoomGroup.add(frame);
      pv.position.y += 0.018;
      pv.castShadow = true;
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
  const tankRings = [];
  for (let i = 0; i < 7; i++)
    tankRings.push({
      position: [-w / 2 - 0.8, 0.4 + i * 0.3, -0.6],
      rotation: [Math.PI / 2, 0, 0],
    });
  farmInstances(
    controlRoomGroup,
    '雨水桶加强圈',
    new THREE.TorusGeometry(0.65, 0.018, 5, 24),
    materials.darkSteel,
    tankRings,
  );
  farmRod(controlRoomGroup, materials.darkSteel, [-4.35, 3.52, -1.8], [-4.8, 3.52, -1.8], 0.045);
  farmRod(controlRoomGroup, materials.darkSteel, [-4.8, 3.52, -1.8], [-4.8, 2.4, -0.6], 0.045);

  // 4. 控制室内部核心设备
  // ----------------------------------------------------
  // 设备 A：边缘 AI 服务器机柜 (Edge AI Server Rack)
  // 位于西北角，负责本地视觉推理、延时视频转码、传感器时序数据库
  const rackGroup = new THREE.Group();
  rackGroup.name = 'ServerRack';
  rackGroup.position.set(-w / 2 + 1.0, 0.25, -d / 2 + 1.1);
  rackGroup.userData = {
    type: 'server_rack',
    title: '农场电脑机柜',
    desc: '这里展示用于保存种植照片、环境记录和运行 G 老师的电脑设备，方便回看孩子们的观察。',
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
    title: 'G 老师讨论台',
    desc: '孩子们围坐在这里，看种植记录、聊遇到的问题，再商量下一次怎么尝试。大屏展示了一组讨论记录示例。',
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
  screenTex.colorSpace = THREE.SRGBColorSpace;
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
    title: '种植区观察屏',
    desc: '六个画面分别对应六块种植区，用来展示如何对比作物的生长变化。这里的画面是观察示意。',
  };

  const wallBracketGeo = new THREE.BoxGeometry(0.12, 1.6, 2.6);
  const wallBracket = new THREE.Mesh(wallBracketGeo, materials.darkSteel);
  wallBracket.position.set(0, 1.8, 0);
  monitorWallGroup.add(wallBracket);

  // 6 块监控分屏（模拟 6 个地块画面）
  const cTexCanvas = createCctvTexture();
  const cctvTex = new THREE.CanvasTexture(cTexCanvas);
  cctvTex.colorSpace = THREE.SRGBColorSpace;
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
    title: '灌溉与用电控制台',
    desc: '这里展示水阀、水压表、电量表和补光开关，帮助了解农场怎样供水、用电。网页中可查看设备外观与说明。',
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
  const leaves = [],
    fruits = [];
  const leafGeo = farmLeafGeometry();
  const fruitGeo = new THREE.SphereGeometry(1, 12, 8);
  const leafMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.95,
    side: THREE.DoubleSide,
  });
  const leaf = (x, y, z, angle, length, width = 1, tilt = -0.25) => {
    leaves.push({
      position: [x, y, z],
      rotation: [tilt, angle, 0],
      scale: [length * width, length, length],
    });
  };
  const fruit = (x, y, z, radius, color = '#c4482e', scaleY = 1) => {
    fruits.push({ position: [x, y, z], scale: [radius, radius * scaleY, radius], color });
  };

  if (pData.id === 1) {
    // Branches and separate leaves replace the original solid green spheres.
    for (const z of [-0.55, 0.55]) {
      farmRod(plotGroup, mats.lightTimber, [-1, 0.22, z], [-0.85, 1.65, z], 0.022);
      farmRod(plotGroup, mats.lightTimber, [1, 0.22, z], [0.85, 1.65, z], 0.022);
      farmRod(plotGroup, mats.lightTimber, [-0.88, 1.5, z], [0.88, 1.5, z], 0.019);
      for (let i = 0; i < 3; i++) {
        const x = -0.65 + i * 0.65;
        farmRod(plotGroup, mats.foliageTomato, [x, 0.23, z], [x + 0.08, 1.4, z], 0.014);
        for (let j = 0; j < 7; j++) {
          const angle = j * 2.399 + i,
            y = 0.4 + j * 0.135;
          const dx = Math.cos(angle) * 0.18,
            dz = Math.sin(angle) * 0.18;
          farmRod(plotGroup, mats.foliageTomato, [x, y, z], [x + dx, y + 0.08, z + dz], 0.007);
          leaf(x + dx, y + 0.08, z + dz, angle + 0.8, 0.28, 0.7);
          leaf(x + dx * 0.5, y + 0.03, z + dz * 0.5, angle - 1, 0.2, 0.7);
          if (j % 2 === 0) {
            fruit(x + dx, y - 0.03, z + dz, 0.062, j === 6 ? '#afbd53' : '#c4482e');
            fruit(x + dx + 0.075, y - 0.085, z + dz, 0.052, '#e7ae62');
          }
        }
      }
    }
  } else if (pData.id === 2) {
    const petals = [],
      centers = [];
    for (let row = 0; row < 3; row++)
      for (let col = 0; col < 3; col++) {
        const x = -0.8 + col * 0.8,
          z = -0.8 + row * 0.8;
        const h = 1.35 + (row + col) * 0.12;
        farmRod(plotGroup, mats.foliageTomato, [x, 0.22, z], [x, h, z], 0.023);
        for (let i = 0; i < 4; i++) leaf(x, 0.5 + i * 0.2, z, i * 2.4 + col, 0.37, 0.9, -0.45);
        // Tilt the flower toward visitors; individually shaped petals surround a raised seed disk.
        const head = new THREE.Group();
        head.position.set(x, h, z);
        head.rotation.set(-0.35, -0.3 + col * 0.12, 0);
        plotGroup.add(head);
        for (let petal = 0; petal < 14; petal++) {
          const a = (petal / 14) * Math.PI * 2;
          petals.push({
            position: [Math.cos(a) * 0.19, Math.sin(a) * 0.19, 0],
            rotation: [0, 0, a - Math.PI / 2],
            scale: [0.053, 0.13, 0.021],
          });
        }
        farmInstances(head, '向日葵花瓣', fruitGeo, mats.sunflowerPetal, petals.splice(0));
        const disk = new THREE.Mesh(new THREE.SphereGeometry(0.125, 16, 10), mats.sunflowerCenter);
        disk.scale.z = 0.32;
        head.add(disk);
        for (let i = 0; i < 45; i++) {
          const a = i * 2.399,
            r = Math.sqrt(i / 45) * 0.109;
          centers.push({
            position: [Math.cos(a) * r, Math.sin(a) * r, 0.033],
            scale: [0.008, 0.009, 0.008],
          });
        }
        farmInstances(head, '葵花籽', fruitGeo, mats.lightTimber, centers.splice(0));
      }
  } else if (pData.id === 3) {
    for (let tier = 0; tier < 3; tier++) {
      const y = 0.35 + tier * 0.34,
        z = 0.8 - tier * 0.75;
      const tray = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.18, 0.62), mats.woodCurb);
      tray.position.set(0, y, z);
      tray.castShadow = true;
      plotGroup.add(tray);
      const soil = new THREE.Mesh(new THREE.BoxGeometry(2.25, 0.025, 0.47), mats.soilBedTilled);
      soil.position.set(0, y + 0.1, z);
      plotGroup.add(soil);
      for (const x of [-1.02, 1.02])
        farmRod(plotGroup, mats.lightTimber, [x, 0.21, z], [x, y, z], 0.035);
      for (let plant = 0; plant < 5; plant++) {
        const x = -0.9 + plant * 0.45;
        for (let l = 0; l < 5; l++) leaf(x, y + 0.15, z, l * 2.399 + plant, 0.22, 1.1, -0.4);
        fruit(x - 0.07, y + 0.07, z + 0.27, 0.044, '#c4482e', 1.4);
        fruit(x + 0.08, y + 0.12, z + 0.23, 0.035, '#f2b8a3', 1.3);
      }
    }
  } else if (pData.id === 4) {
    const pumpkinMat = new THREE.MeshStandardMaterial({ color: 0xcf782b, roughness: 0.8 });
    for (let vine = 0; vine < 3; vine++) {
      let previous = [-0.8, 0.25, -0.65 + vine * 0.5];
      for (let i = 0; i < 7; i++) {
        const x = -0.8 + i * 0.25,
          z = -0.65 + vine * 0.5 + Math.sin(i * 1.1 + vine) * 0.18;
        if (i > 0) farmRod(plotGroup, mats.foliageTomato, previous, [x, 0.25, z], 0.014);
        leaf(x, 0.29, z, i * 2.399, 0.39, 1.25, -0.15);
        previous = [x, 0.25, z];
      }
    }
    for (const [x, z, radius] of [
      [-0.7, 0.75, 0.24],
      [0.55, 0.5, 0.19],
    ]) {
      const lobes = [];
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        lobes.push({
          position: [
            x + Math.cos(a) * radius * 0.43,
            0.24 + radius * 0.7,
            z + Math.sin(a) * radius * 0.43,
          ],
          scale: [radius * 0.67, radius * 0.76, radius * 0.67],
        });
      }
      farmInstances(plotGroup, '南瓜瓜棱', fruitGeo, pumpkinMat, lobes);
      farmRod(
        plotGroup,
        mats.woodCurb,
        [x, 0.24 + radius * 1.4, z],
        [x + 0.03, 0.34 + radius * 1.4, z],
        0.028,
      );
    }
    farmRod(plotGroup, mats.lightTimber, [-1, 0.22, -1], [-1, 1.3, -0.6], 0.025);
    farmRod(plotGroup, mats.lightTimber, [1, 0.22, -1], [1, 1.3, -0.6], 0.025);
    farmRod(plotGroup, mats.lightTimber, [-1, 1.3, -0.6], [1, 1.3, -0.6], 0.025);
    farmRod(plotGroup, mats.whiteAppliance, [0.9, 0.2, -0.9], [0.9, 1.55, -0.9], 0.015);
    const pinwheel = new THREE.Group();
    pinwheel.position.set(0.9, 1.55, -0.9);
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(
        new THREE.ConeGeometry(0.09, 0.2, 3),
        i % 2 ? mats.tomatoFruit : mats.sunflowerPetal,
      );
      const a = (i * Math.PI) / 2;
      blade.position.set(Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0);
      blade.rotation.z = a - 0.8;
      pinwheel.add(blade);
    }
    plotGroup.add(pinwheel);
  } else if (pData.id === 5) {
    for (const x of [-1.3, 1.3])
      for (const z of [-1.25, 0.05])
        farmRod(plotGroup, mats.darkSteel, [x, 0.22, z], [x, 1.16, z], 0.018);
    for (const z of [-1.25, 0.05])
      farmRod(plotGroup, mats.darkSteel, [-1.3, 1.16, z], [1.3, 1.16, z], 0.018);
    // Alpha-tested weave replaces the opaque sheet and diagonal wireframe box.
    const weave = new Uint8Array(16 * 16 * 4);
    for (let y = 0; y < 16; y++)
      for (let x = 0; x < 16; x++) {
        const solid = x % 4 === 0 || y % 4 === 0;
        weave.set([255, 255, 255, solid ? 255 : 0], (y * 16 + x) * 4);
      }
    const netMap = new THREE.DataTexture(weave, 16, 16);
    netMap.wrapS = netMap.wrapT = THREE.RepeatWrapping;
    netMap.repeat.set(25, 12);
    netMap.needsUpdate = true;
    const shadeNet = new THREE.Mesh(
      new THREE.PlaneGeometry(2.6, 1.3),
      new THREE.MeshStandardMaterial({
        map: netMap,
        alphaTest: 0.5,
        color: 0x687663,
        side: THREE.DoubleSide,
        roughness: 1,
      }),
    );
    shadeNet.rotation.x = -Math.PI / 2;
    shadeNet.position.set(0, 1.16, -0.6);
    plotGroup.add(shadeNet);
    for (let x = 0; x < 5; x++)
      for (let z = 0; z < 5; z++) {
        for (let l = 0; l < 9; l++) {
          leaf(
            -0.85 + x * 0.42,
            0.26 + (l > 5 ? 0.05 : 0),
            -0.85 + z * 0.42,
            l * 2.399 + x,
            l > 5 ? 0.13 : 0.2,
            1.15,
            l > 5 ? -1 : -0.35,
          );
        }
      }
  } else {
    const toolBox = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.3), mats.foliageTomato);
    toolBox.position.set(-0.8, 0.35, 0.8);
    toolBox.castShadow = true;
    plotGroup.add(toolBox);
    farmRod(plotGroup, mats.darkSteel, [-0.95, 0.5, 0.8], [-0.65, 0.5, 0.8], 0.02);
    farmRod(plotGroup, mats.lightTimber, [-0.45, 0.27, 0.8], [-0.65, 0.95, 0.8], 0.018);
    const spade = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), mats.darkSteel);
    spade.scale.set(0.7, 1.1, 0.12);
    spade.position.set(-0.43, 0.29, 0.8);
    plotGroup.add(spade);
  }
  if (leaves.length) farmInstances(plotGroup, '作物叶片', leafGeo, leafMat, leaves);
  else {
    leafGeo.dispose();
    leafMat.dispose();
  }
  if (fruits.length) {
    const fruitMaterial = mats.tomatoFruit.clone();
    fruitMaterial.color.set(0xffffff);
    farmInstances(plotGroup, '成熟与青涩果实', fruitGeo, fruitMaterial, fruits);
  } else if (![2, 4].includes(pData.id)) fruitGeo.dispose();
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
  let seed = 36113;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const crownGeo = new THREE.SphereGeometry(1, 16, 12);
  const positions = crownGeo.getAttribute('position');
  const colors = [];
  const tone = new THREE.Color();
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i),
      y = positions.getY(i),
      z = positions.getZ(i);
    const r = 1 + 0.07 * Math.sin(x * 19 + z * 11) * Math.cos(y * 17);
    positions.setXYZ(i, x * r, y * r, z * r);
    tone.set('#728e4c').lerp(new THREE.Color('#b5c879'), (y + 1) * 0.24);
    colors.push(tone.r, tone.g, tone.b);
  }
  crownGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  crownGeo.computeVertexNormals();
  const crownMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  const crowns = [],
    leafClusters = [];
  const treeCoords = [
    [-12, -4],
    [-12, 6],
    [12, -4],
    [12, 6],
  ];
  treeCoords.forEach(([tx, tz], treeIndex) => {
    farmRod(farmGroup, mats.woodCurb, [tx, 0, tz], [tx + 0.12, 3.3, tz - 0.1], 0.17);
    const mulch = new THREE.Mesh(new THREE.CircleGeometry(1.0, 32), mats.soilBedTilled);
    mulch.rotation.x = -Math.PI / 2;
    mulch.position.set(tx, 0.008, tz);
    farmGroup.add(mulch);
    for (let lobe = 0; lobe < 7; lobe++) {
      const a = lobe * 2.399 + treeIndex;
      const spread = lobe === 6 ? 0.1 : 0.85;
      const x = tx + Math.cos(a) * spread,
        z = tz + Math.sin(a) * spread;
      const y = lobe === 6 ? 4.7 : 3.45 + (lobe % 3) * 0.35;
      const radius = 0.92 + random() * 0.3;
      farmRod(farmGroup, mats.woodCurb, [tx + 0.08, 2.1, tz], [x, y, z], 0.055);
      crowns.push({
        position: [x, y, z],
        scale: [radius, radius * 0.84, radius],
        rotation: [0, a, 0],
        color: lobe % 2 ? '#d2dbaa' : '#ffffff',
      });
      for (let i = 0; i < 23; i++) {
        const theta = random() * Math.PI * 2,
          v = random() * 2 - 1;
        const ring = Math.sqrt(1 - v * v) * radius;
        leafClusters.push({
          position: [x + Math.cos(theta) * ring, y + v * radius * 0.8, z + Math.sin(theta) * ring],
          scale: [0.25, 0.16, 0.22],
          rotation: [random(), theta, random()],
        });
      }
    }
  });
  farmInstances(farmGroup, '果树层叠树冠', crownGeo, crownMat, crowns);
  const leafClusterMat = new THREE.MeshStandardMaterial({ color: 0x819952, roughness: 1 });
  farmInstances(
    farmGroup,
    '树冠叶簇',
    new THREE.SphereGeometry(1, 7, 5),
    leafClusterMat,
    leafClusters,
  );

  // Low grass at the margins; keep every existing path and plot free of blades.
  const grassGeo = new THREE.BufferGeometry();
  const blade = [];
  for (let i = 0; i < 3; i++) {
    const a = i * 2.399;
    for (const [x, y, z] of [
      [-0.016, 0, 0],
      [0.016, 0, 0],
      [0.05, 0.19 - i * 0.025, 0.035],
    ]) {
      blade.push(x * Math.cos(a) - z * Math.sin(a), y, x * Math.sin(a) + z * Math.cos(a));
    }
  }
  grassGeo.setAttribute('position', new THREE.Float32BufferAttribute(blade, 3));
  grassGeo.computeVertexNormals();
  const grassMat = new THREE.MeshStandardMaterial({
    color: 0x899959,
    side: THREE.DoubleSide,
    roughness: 1,
  });
  const tufts = [];
  const onPath = (x, z) =>
    ((Math.abs(x - 2.25) < 0.85 || Math.abs(x + 2.25) < 0.85) && z > -5.1 && z < 9.1) ||
    (Math.abs(x) < 8.1 &&
      (Math.abs(z - 2.75) < 1.3 || Math.abs(z + 3.2) < 1.3 || Math.abs(z - 8) < 1));
  for (let i = 0; i < 8500; i++) {
    const x = (random() - 0.5) * 32,
      z = (random() - 0.5) * 29;
    if (onPath(x, z) || (Math.abs(x) < 5.6 && z < -4.4 && z > -12)) continue;
    if (FARM_CONFIG.plots.some((p) => Math.abs(x - p.x) < 1.65 && Math.abs(z - p.z) < 1.65))
      continue;
    if (treeCoords.some(([tx, tz]) => Math.hypot(x - tx, z - tz) < 0.95)) continue;
    const size = 0.45 + random() * 0.6;
    tufts.push({
      position: [x, 0.005, z],
      scale: [size, size, size],
      rotation: [0, random() * Math.PI, 0],
      color: random() > 0.5 ? '#d8d4a5' : '#ffffff',
    });
  }
  const grass = farmInstances(farmGroup, '草地细叶', grassGeo, grassMat, tufts);
  grass.castShadow = false;

  const fenceMat = new THREE.MeshStandardMaterial({ color: 0xd8d5bc, roughness: 0.92 });
  const posts = [],
    caps = [];
  for (let fx = -14; fx <= 14; fx += 2.5) {
    posts.push({ position: [fx, 0.55, 12] });
    caps.push({ position: [fx, 1.13, 12], rotation: [0, Math.PI / 4, 0] });
  }
  farmInstances(farmGroup, '围栏立柱', new THREE.BoxGeometry(0.13, 1.1, 0.13), fenceMat, posts);
  farmInstances(farmGroup, '围栏柱帽', new THREE.ConeGeometry(0.11, 0.1, 4), fenceMat, caps);
  for (const y of [0.45, 0.85]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(29, 0.09, 0.05), fenceMat);
    rail.position.set(0, y, 12);
    rail.castShadow = true;
    farmGroup.add(rail);
  }
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
  ctx.fillText('织界农场 · G 老师', 30, 40);

  ctx.fillStyle = '#4ade80';
  ctx.font = '18px sans-serif';
  ctx.fillText('六块种植区 · 记录示例', 720, 40);

  // 左栏：实时数据与提问闭环
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(30, 80, 460, 400);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('孩子的观察与尝试', 50, 120);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '16px sans-serif';
  ctx.fillText('晨晨：为什么番茄叶尖周一会卷起来？', 50, 160);

  ctx.fillStyle = '#38bdf8';
  ctx.fillText('G 老师建议：先对比两块地的光照，', 50, 200);
  ctx.fillText('再看看土壤湿度，观察中午是否缺水。', 50, 230);

  ctx.fillStyle = '#f59e0b';
  ctx.fillText('动手尝试：加一块纸板遮阳，观察两天。', 50, 280);

  ctx.fillStyle = '#4ade80';
  ctx.fillText('回来看看：新叶舒展开了，继续记录变化。', 50, 330);

  // 右栏：六地块状态微缩图
  ctx.fillStyle = '#1e293b';
  ctx.fillRect(520, 80, 470, 400);

  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('种植记录示例', 540, 120);

  const plotsBrief = [
    '01 晨晨 · 番茄开花了，观察滴灌是否够用',
    '02 浩浩 · 向日葵含苞了，记录花盘朝向',
    '03 悠悠 · 草莓开始结果，留意下层光照',
    '04 乐乐 · 南瓜藤长长了，试着搭个架子',
    '05 糖糖 · 生菜准备采收，比较遮阳效果',
    '06 等你来种 · 土壤已整理，带上新想法',
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
      ctx.fillText(`作物观察 ${idx}`, x + 40, y + 45);

      // 摄像机编号与 REC 状态
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(x + 18, y + 22, 5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#f4f4f5';
      ctx.font = '12px sans-serif';
      ctx.fillText(`种植区 ${idx} · 观察示意`, x + 30, y + 26);
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
        ? '怎样让小车把摘下的番茄，稳稳送到控制室？'
        : '怎样让小车沿着田间小路，把工具送到需要的地方？',
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
