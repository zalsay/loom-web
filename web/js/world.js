import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPavilion } from '../scene/model.js';
import { SITE, mapPoint, bendPoint } from '../scene/site-layout.js';

const $ = (selector) => document.querySelector(selector);
const embedded = new URLSearchParams(location.search).has('embedded');
document.body.classList.toggle('embedded', embedded);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let interactive = !embedded,
  visible = true,
  needsDraw = true,
  transition = null,
  currentView = 'perspective';
function notify(type, extra = {}) {
  if (embedded) parent.postMessage({ type, ...extra }, location.origin);
}
async function init() {
  let renderer,
    compatibilityMode = false;
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2', { antialias: true, powerPreference: 'default' });
    if (!context) throw new Error('WebGL2 unavailable');
    renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true });
  } catch {
    const { SVGRenderer } = await import('three/addons/renderers/SVGRenderer.js');
    renderer = new SVGRenderer();
    renderer.setQuality('low');
    compatibilityMode = true;
    $('#render-mode').textContent = '当前为简化画面';
  }
  if (!compatibilityMode) {
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
  }
  renderer.setSize(innerWidth, innerHeight);
  $('#viewport').append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xdbe3d2);
  scene.fog = new THREE.Fog(0xdbe3d2, 80, 210);
  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.5, 400);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.075;
  controls.minDistance = 5;
  controls.maxDistance = 220;
  controls.maxPolarAngle = Math.PI / 2 - 0.035;
  controls.minPolarAngle = 0.06;
  controls.maxTargetRadius = 90;
  controls.autoRotateSpeed = 0.32;
  controls.enabled = interactive;
  const hemi = new THREE.HemisphereLight(0xe9f3ee, 0x8b986b, 2.5);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff7df, 3.1);
  sun.position.set(-45, 80, 60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -85;
  sun.shadow.camera.right = 85;
  sun.shadow.camera.top = 80;
  sun.shadow.camera.bottom = -80;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 240;
  sun.shadow.normalBias = 0.035;
  sun.shadow.bias = -0.00015;
  sun.shadow.radius = 3;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xe2f0f3, 0.6);
  fill.position.set(15, 10, -20);
  scene.add(fill);
  const exportModel = createPavilion();
  let model = exportModel;
  if (compatibilityMode) {
    const { TessellateModifier } = await import('three/addons/modifiers/TessellateModifier.js');
    const root = exportModel.root.clone(true);
    const tessellate = new TessellateModifier(1.6, 7);
    model = {
      ...exportModel,
      root,
      building: root.getObjectByName('建筑'),
      ground: root.getObjectByName('地面与铺装'),
      landscape: root.getObjectByName('草坪与园林'),
    };
    root.traverse((o) => {
      if (o.isInstancedMesh || o.name === '疏朗树叶') o.visible = false;
      if (o.isMesh) {
        o.material = o.material.clone();
        if (o.name === '草坪地面') {
          o.renderOrder = -5;
          o.geometry = new THREE.PlaneGeometry(180, 170, 30, 28);
          o.material = new THREE.MeshBasicMaterial({ color: 0xa6af7d });
        }
        if (/栅格区封闭内体|封闭侧墙/.test(o.name)) {
          const g = o.geometry.clone();
          g.scale(o.scale.x, o.scale.y, o.scale.z);
          o.scale.set(1, 1, 1);
          o.geometry = tessellate.modify(g);
        }
        if (/路缘|园路收边/.test(o.name)) o.renderOrder = -4;
        if (/沥青|园路$/.test(o.name)) o.renderOrder = -3;
        if (/道路|园路|铺装前场/.test(o.name)) o.renderOrder = -3;
        if (/人行道|路缘/.test(o.name)) o.renderOrder = -4;
        if (o.material.name === '市政道路沥青')
          o.material = new THREE.MeshBasicMaterial({ color: 0x7b847d, side: THREE.DoubleSide });
        if (/标线|分隔线|沿路缘白线|道路虚线|铺装分缝/.test(o.name)) o.renderOrder = -2;
        if (/沥青|园路$/.test(o.name))
          o.material = new THREE.MeshBasicMaterial({ color: 0x8a918b, side: THREE.DoubleSide });
        if (/屋面|顶板|吊顶底板|沥青路面|弧形路缘/.test(o.name))
          o.geometry = tessellate.modify(o.geometry);
      }
      if (/吊顶格栅|吊顶底板|屋面板接缝/.test(o.name)) o.visible = false;
      if (o.isMesh && /屋面与白色檐口|屋面顶板与金属压边/.test(o.name)) {
        const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        const p = g.attributes.position,
          n = g.attributes.normal,
          uv = g.attributes.uv,
          ps = [],
          ns = [],
          us = [];
        for (let i = 0; i < p.count; i += 3) {
          const ny = n.getY(i);
          if (o.name === '屋面顶板与金属压边' ? ny < -0.5 : ny > 0.5) continue;
          for (let j = 0; j < 3; j++) {
            ps.push(p.getX(i + j), p.getY(i + j), p.getZ(i + j));
            ns.push(n.getX(i + j), n.getY(i + j), n.getZ(i + j));
            if (uv) us.push(uv.getX(i + j), uv.getY(i + j));
          }
        }
        const ng = new THREE.BufferGeometry();
        ng.setAttribute('position', new THREE.Float32BufferAttribute(ps, 3));
        ng.setAttribute('normal', new THREE.Float32BufferAttribute(ns, 3));
        if (us.length) ng.setAttribute('uv', new THREE.Float32BufferAttribute(us, 2));
        o.geometry = ng;
      }
    });
    for (const g of model.landscape.children.filter(
      (o) => o.name === '园林乔木' && o.userData.detailed,
    )) {
      for (let i = 0; i < 4; i++) {
        const crown = new THREE.Mesh(
          new THREE.IcosahedronGeometry(1.45, 1),
          new THREE.MeshLambertMaterial({ color: i % 2 ? 0x7e915a : 0x6e8453 }),
        );
        crown.position.set(Math.cos(i * 2.4) * 0.65, 5.5 + (i % 2) * 0.8, Math.sin(i * 2.4) * 0.65);
        crown.scale.set(1, 0.85, 0.9);
        g.add(crown);
      }
    }
    scene.background = new THREE.Color(0xdde6da);
    hemi.intensity = 0.9;
    sun.intensity = 0.3;
    fill.intensity = 0.1;
    scene.add(new THREE.AmbientLight(0xffffff, 0.62));
  }
  scene.add(model.root);

  const detail = bendPoint(new THREE.Vector3(-9, 1.9, 0.3));
  const presets = {
    perspective: { position: [34, 31, 43], target: [1, 1, -8] },
    eye: {
      position: mapPoint(...SITE.videoStartPixel, 1.7).toArray(),
      target: mapPoint(...SITE.videoTargetPixel, 1.9).toArray(),
    },
    aerial: { position: [-2, 185, 3], target: [-2, 0, -5] },
    enclosure: { position: [detail.x + 10, 5.8, detail.z + 14], target: detail.toArray() },
  };
  function setView(name, animate = true) {
    if (!presets[name]) return;
    currentView = name;
    camera.fov = name === 'eye' ? 56 : 40;
    camera.updateProjectionMatrix();
    const preset = presets[name];
    const position = new THREE.Vector3(...preset.position),
      target = new THREE.Vector3(...preset.target);
    if (innerWidth < 550 && name === 'perspective')
      position.sub(target).multiplyScalar(1.12).add(target);
    if (animate && !reducedMotion)
      transition = {
        start: performance.now(),
        from: camera.position.clone(),
        fromTarget: controls.target.clone(),
        to: position,
        toTarget: target,
      };
    else {
      camera.position.copy(position);
      controls.target.copy(target);
      controls.update();
    }
    document.querySelectorAll('[data-view]').forEach((button) => {
      const active = button.dataset.view === name;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active);
    });
    needsDraw = true;
  }
  setView('perspective', false);
  document
    .querySelectorAll('[data-view]')
    .forEach((button) => button.addEventListener('click', () => setView(button.dataset.view)));
  $('#landscape').addEventListener('change', (event) => {
    model.landscape.visible = event.target.checked;
    needsDraw = true;
  });
  const doors = [];
  model.building.traverse((object) => {
    if (object.userData.doorLeaf) doors.push(object);
  });
  $('#doors').addEventListener('change', (event) => {
    for (const leaf of doors)
      leaf.rotation.y =
        (leaf.userData.closedAngle || 0) + (event.target.checked ? leaf.userData.openAngle : 0);
    needsDraw = true;
  });
  $('#autorotate').addEventListener('change', (event) => {
    controls.autoRotate = event.target.checked;
    needsDraw = true;
  });
  $('#reset').addEventListener('click', () => {
    controls.autoRotate = false;
    $('#autorotate').checked = false;
    setView('perspective');
  });
  controls.addEventListener('start', () => {
    transition = null;
  });
  controls.addEventListener('change', () => {
    needsDraw = true;
  });
  window.addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    needsDraw = true;
  });
  window.addEventListener('message', (event) => {
    if (event.source !== parent || event.origin !== location.origin) return;
    if (event.data?.type === 'loom-world-mode') {
      interactive = !!event.data.interactive;
      controls.enabled = interactive;
      document.body.classList.toggle('interactive', interactive);
      if (!interactive) {
        controls.autoRotate = false;
        $('#autorotate').checked = false;
        setView('perspective', false);
      }
      visible = true;
      needsDraw = true;
    }
    if (event.data?.type === 'loom-world-visibility') {
      visible = !!event.data.visible;
      needsDraw = true;
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && embedded) notify('loom-world-close');
  });
  document.addEventListener('visibilitychange', () => {
    needsDraw = true;
  });
  let lastDraw = 0,
    readySent = false;
  function animate(time) {
    requestAnimationFrame(animate);
    if (!visible || document.hidden) return;
    if (compatibilityMode && time - lastDraw < 160) return;
    controls.update();
    if (!needsDraw && !transition && !controls.autoRotate) return;
    lastDraw = time;
    needsDraw = false;
    if (transition) {
      const progress = Math.min((time - transition.start) / 950, 1),
        ease = 1 - (1 - progress) ** 3;
      camera.position.lerpVectors(transition.from, transition.to, ease);
      controls.target.lerpVectors(transition.fromTarget, transition.toTarget, ease);
      if (progress === 1) transition = null;
      controls.update();
    }
    const near = Math.max(0.25, Math.min(3, camera.position.distanceTo(controls.target) / 50));
    if (Math.abs(camera.near - near) > 0.0001) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }
    renderer.render(scene, camera);
    if (!readySent) {
      readySent = true;
      $('#loading').classList.add('hidden');
      notify('loom-world-ready', { compatibilityMode });
    }
  }
  requestAnimationFrame(animate);
  window.loomWorld = {
    scene,
    camera,
    renderer,
    controls,
    model,
    setView,
    compatibilityMode,
    ready: true,
  };
}
init().catch((error) => {
  console.error(error);
  $('#loading').textContent = '暂时没打开，请刷新页面再试一次。';
  notify('loom-world-error');
});
