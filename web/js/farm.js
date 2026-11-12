import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createFarmScene, FARM_CONFIG } from '../scene/farm-scene.js';

// DOM 选择器
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

const embedded = new URLSearchParams(location.search).has('embedded');
if (embedded) document.body.classList.add('embedded');

// 状态
let scene, camera, renderer, controls;
let farmSceneData;
let raycaster, mouse;
let targetCameraPos = null;
let targetControlsLookAt = null;
let isTransitioning = false;
const clock = new THREE.Clock();

// 预设视角坐标 (针对农场 3m×3m 布局与 8m×5m 控制室精心标定)
const VIEW_PRESETS = {
  overview: {
    pos: new THREE.Vector3(18, 16, 22),
    look: new THREE.Vector3(0, 1.5, -2),
  },
  'control-room': {
    pos: new THREE.Vector3(0, 2.2, -6.8), // 走进控制室内正中
    look: new THREE.Vector3(0, 1.6, -10.0),
  },
  'agent-screen': {
    pos: new THREE.Vector3(0.1, 1.7, -7.8), // 直视 G 老师交互大屏
    look: new THREE.Vector3(0, 1.55, -9.1),
  },
  plan: {
    pos: new THREE.Vector3(0, 32, 2.0), // 俯视规划全图
    look: new THREE.Vector3(0, 0, 2.0),
  },
};

// 光照预设
let hemiLight, sunLight, fillLight, roomWarmLight;

function init() {
  const container = $('#canvas-container');

  // 1. 渲染器 (启用 logarithmicDepthBuffer 增强全深度精度，彻底杜绝远处和结构边缘的深度冲突闪烁)
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
    logarithmicDepthBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  container.appendChild(renderer.domElement);

  // 2. 场景与雾效
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdbe3d2);
  scene.fog = new THREE.Fog(0xdbe3d2, 35, 95);

  // 3. 相机与控制器 (近平面设为 0.5m，大幅提升深度缓冲精度，避免过小近平面带来的精度衰减)
  camera = new THREE.PerspectiveCamera(
    42,
    container.clientWidth / container.clientHeight,
    0.5,
    250,
  );
  camera.position.copy(VIEW_PRESETS.overview.pos);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2 - 0.02; // 防止穿透地面
  controls.minDistance = 2.0;
  controls.maxDistance = 65;
  controls.target.copy(VIEW_PRESETS.overview.look);
  if (embedded) {
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
  }

  // 4. 灯光系统
  setupLights();

  // 5. 构筑织界农场 3D 实体场景
  farmSceneData = createFarmScene();
  scene.add(farmSceneData.group);

  // 6. 光线投射与点击交互
  raycaster = new THREE.Raycaster();
  mouse = new THREE.Vector2();

  window.addEventListener('resize', onWindowResize);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);

  setupUI();

  // 7. 动画主循环
  animate();
}

function setupLights() {
  hemiLight = new THREE.HemisphereLight(0xf2f7ee, 0x8a9870, 2.4);
  scene.add(hemiLight);

  sunLight = new THREE.DirectionalLight(0xfff8e7, 3.2);
  sunLight.position.set(-25, 38, 28);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -28;
  sunLight.shadow.camera.right = 28;
  sunLight.shadow.camera.top = 28;
  sunLight.shadow.camera.bottom = -28;
  sunLight.shadow.camera.near = 1;
  sunLight.shadow.camera.far = 100;
  sunLight.shadow.normalBias = 0.035;
  sunLight.shadow.bias = -0.0001;
  scene.add(sunLight);

  fillLight = new THREE.DirectionalLight(0xd9ebf2, 0.7);
  fillLight.position.set(25, 20, -20);
  scene.add(fillLight);

  // 控制室内暖色吸顶照明
  roomWarmLight = new THREE.PointLight(0xffeedd, 3.0, 12, 1.2);
  roomWarmLight.position.set(0, 2.8, -8.5);
  scene.add(roomWarmLight);
}

function applyLightingMode(mode) {
  if (mode === 'day') {
    scene.background.set(0xdbe3d2);
    scene.fog.color.set(0xdbe3d2);
    sunLight.intensity = 3.2;
    sunLight.color.set(0xfff8e7);
    hemiLight.intensity = 2.4;
    hemiLight.color.set(0xf2f7ee);
    fillLight.intensity = 0.7;
    roomWarmLight.intensity = 2.0;
  } else if (mode === 'dusk') {
    scene.background.set(0xe8b898);
    scene.fog.color.set(0xe8b898);
    sunLight.intensity = 2.5;
    sunLight.color.set(0xffaa5e);
    sunLight.position.set(-35, 12, 28);
    hemiLight.intensity = 1.6;
    hemiLight.color.set(0xffd1b3);
    fillLight.intensity = 0.4;
    roomWarmLight.intensity = 4.5;
  } else if (mode === 'night') {
    scene.background.set(0x0f1c24);
    scene.fog.color.set(0x0f1c24);
    sunLight.intensity = 0.3;
    sunLight.color.set(0x6080a0);
    hemiLight.intensity = 0.5;
    hemiLight.color.set(0x2a3d4d);
    fillLight.intensity = 0.2;
    roomWarmLight.intensity = 6.0; // 控制室成为夜间明亮的探索灯塔
  }
}

function smoothMoveCamera(toPos, toLookAt, onComplete) {
  targetCameraPos = toPos.clone();
  targetControlsLookAt = toLookAt.clone();
  isTransitioning = true;
}

function onWindowResize() {
  const container = $('#canvas-container');
  camera.aspect = container.clientWidth / container.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(container.clientWidth, container.clientHeight);
}

function onPointerDown(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(mouse, camera);

  // 递归检测交互物
  const hits = raycaster.intersectObjects(farmSceneData.interactables, true);
  if (hits.length > 0) {
    let curr = hits[0].object;
    while (curr && !curr.userData?.type && curr.parent) {
      curr = curr.parent;
    }

    if (curr && curr.userData) {
      handleSelectObject(curr);
    }
  }
}

function handleSelectObject(obj) {
  const uData = obj.userData;
  const card = $('#info-card');

  if (uData.type === 'plot') {
    const p = uData.data;
    $('#card-title').textContent = p.name;
    $('#card-sub').textContent = `${p.child} · ${p.crop} (${p.stage})`;
    $('#card-stats').style.display = 'grid';
    $('#stat-1-val').textContent = `${p.soilMoisture}%`;
    $('#stat-1-lbl').textContent = '土壤湿度';
    $('#stat-2-val').textContent = `${p.soilTemp}℃`;
    $('#stat-2-lbl').textContent = '地温';
    $('#stat-3-val').textContent = `${p.lightHours}h`;
    $('#stat-3-lbl').textContent = '今日光照';

    $('#card-device').textContent = p.device;
    $('#card-question').textContent = `“${p.question}”`;
    card.classList.remove('hidden');

    // 相机平滑推近该地块
    const plotPos = new THREE.Vector3(p.x, 0, p.z);
    smoothMoveCamera(
      new THREE.Vector3(p.x + 3.8, 3.5, p.z + 4.2),
      new THREE.Vector3(p.x, 0.6, p.z),
    );
  } else if (uData.type === 'lego_rover') {
    $('#card-title').textContent = uData.title;
    $('#card-sub').textContent = `${uData.child} · 乐高积木拼搭`;
    $('#card-stats').style.display = 'grid';
    $('#stat-1-val').textContent = uData.speed.split(' ')[0];
    $('#stat-1-lbl').textContent = '运行速度';
    $('#stat-2-val').textContent = uData.payload.split(' ')[0];
    $('#stat-2-lbl').textContent = '当前负重';
    $('#stat-3-val').textContent = uData.battery.split(' ')[0];
    $('#stat-3-lbl').textContent = '续航状态';

    $('#card-device').textContent = '乐高双电机越野底盘 + 超声波避障双眼 + 5x5点阵主控';
    $('#card-question').textContent = `“${uData.question}”`;
    card.classList.remove('hidden');

    const curP = obj.position;
    smoothMoveCamera(
      new THREE.Vector3(curP.x + 2.5, 2.2, curP.z + 2.8),
      new THREE.Vector3(curP.x, 0.4, curP.z),
    );
  } else if (uData.type) {
    // 控制室内设备
    $('#card-title').textContent = uData.title;
    $('#card-sub').textContent = '共用中心控制室核心组件';
    $('#card-stats').style.display = 'none';
    $('#card-device').textContent = '现场工业级与自动化支持设施';
    $('#card-question').textContent = uData.desc;
    card.classList.remove('hidden');
  }
}

function setupUI() {
  // 视角按钮
  $$('.btn-ctrl').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.btn-ctrl').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const vKey = btn.dataset.view;
      if (VIEW_PRESETS[vKey]) {
        smoothMoveCamera(VIEW_PRESETS[vKey].pos, VIEW_PRESETS[vKey].look);
      }
    });
  });

  // 孩子地块跳转
  $$('.plot-chip[data-plot]').forEach((chip) => {
    chip.addEventListener('click', () => {
      const pid = parseInt(chip.dataset.plot, 10);
      const pData = FARM_CONFIG.plots.find((p) => p.id === pid);
      if (pData) {
        handleSelectObject({ userData: { type: 'plot', data: pData } });
      }
    });
  });

  // 乐高运输小车聚焦跳转
  $$('.rover-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const rIdx = parseInt(btn.dataset.rover, 10);
      const roverObj = farmSceneData?.rovers?.[rIdx];
      if (roverObj) {
        handleSelectObject(roverObj.group);
      }
    });
  });

  // 滴灌水流开关
  $('#toggle-drip').addEventListener('change', (e) => {
    farmSceneData.dripSystem.setVisible(e.target.checked);
  });

  // 光照环境切换
  $('#select-light').addEventListener('change', (e) => {
    applyLightingMode(e.target.value);
  });

  // 自动旋转
  $('#toggle-autorotate').addEventListener('change', (e) => {
    controls.autoRotate = e.target.checked;
    controls.autoRotateSpeed = 0.5;
  });

  // 关闭卡片
  $('#card-close').addEventListener('click', () => {
    $('#info-card').classList.add('hidden');
  });
}

function animate() {
  requestAnimationFrame(animate);

  const dt = clock.getDelta();

  // 更新乐高拼搭自动运输小车巡航
  if (farmSceneData?.rovers) {
    farmSceneData.rovers.forEach((r) => r.update(dt));
  }

  // 相机插值平滑移动
  if (isTransitioning && targetCameraPos && targetControlsLookAt) {
    camera.position.lerp(targetCameraPos, 0.06);
    controls.target.lerp(targetControlsLookAt, 0.06);

    if (
      camera.position.distanceTo(targetCameraPos) < 0.05 &&
      controls.target.distanceTo(targetControlsLookAt) < 0.05
    ) {
      camera.position.copy(targetCameraPos);
      controls.target.copy(targetControlsLookAt);
      isTransitioning = false;
    }
  }

  controls.update();

  // 更新水滴微喷粒子动画
  if (farmSceneData?.dripSystem) {
    farmSceneData.dripSystem.update();
  }

  renderer.render(scene, camera);
}

// 启动
window.addEventListener('DOMContentLoaded', init);
