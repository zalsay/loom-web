import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createPavilion } from '../scene/model.js';
import { createLaboratoryView } from '../scene/laboratory-view.js';
import { fallbackPlan, pandaDrawOrder } from '../scene/fallback-rules.js';
import { SITE, mapPoint, bendPoint } from '../scene/site-layout.js';
import { GLASS_ROOM } from '../scene/pavilion-dimensions.js';
import { createWorldWeather } from './world-weather.js';
import { createWorldAtmosphere } from './world-atmosphere.js';

const $ = (selector) => document.querySelector(selector);
const embedded = new URLSearchParams(location.search).has('embedded');
document.body.classList.toggle('embedded', embedded);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
let interactive = !embedded,
  visible = true,
  needsDraw = true,
  transition = null,
  currentView = 'perspective',
  userAdjustedCamera = false;
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
  let beforeRender = () => {};
  const isInside = (o, ancestor) => {
    for (let p = o; p; p = p.parent) if (p === ancestor) return true;
    return false;
  };
  const shown = (o) => {
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  };
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
      panda: root.getObjectByName(exportModel.panda.name),
      laboratory: root.getObjectByName(exportModel.laboratory.name),
    };
    root.traverse((o) => {
      const plan = fallbackPlan(o.name, o.material?.name);
      if (o.isInstancedMesh || plan.hidden) {
        o.visible = false;
        return;
      }
      if (!o.isMesh) return;
      o.material = o.material.clone();
      if (plan.renderOrder !== null) o.renderOrder = plan.renderOrder;
      // Keep the lawn's world-space colour field when textures and grass instances are unavailable.
      if (plan.flatLawn && !o.geometry.getAttribute('color'))
        o.geometry = new THREE.PlaneGeometry(180, 170, 30, 28);
      if (plan.flatColor) {
        const { color, doubleSide } = plan.flatColor;
        o.material = new THREE.MeshBasicMaterial({
          color,
          vertexColors: !!(plan.flatLawn && o.geometry.getAttribute('color')),
          side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
        });
      }
      if (plan.tessellate === 'scaled') {
        const g = o.geometry.clone();
        g.scale(o.scale.x, o.scale.y, o.scale.z);
        o.scale.set(1, 1, 1);
        o.geometry = tessellate.modify(g);
      } else if (plan.tessellate === 'plain') {
        o.geometry = tessellate.modify(o.geometry);
      }
      if (plan.dropFaces) {
        const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        const p = g.attributes.position,
          n = g.attributes.normal,
          uv = g.attributes.uv,
          ps = [],
          ns = [],
          us = [];
        for (let i = 0; i < p.count; i += 3) {
          const ny = n.getY(i);
          if (plan.dropFaces === 'down' ? ny < -0.5 : ny > 0.5) continue;
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
    // The panda's small parts share a 4,992-triangle sphere. The SVG renderer paints every
    // triangle as a path, so they get a low-poly sphere here; the head keeps its own mesh.
    const lowSphere = new THREE.SphereGeometry(1, 24, 16);
    const pandas = [model.panda];
    const pandaFaces = pandas.map((panda) => {
      const layered = [];
      const head = panda.getObjectByName('head');
      const belly = panda.getObjectByName('belly');
      head.geometry.computeBoundingBox();
      belly.geometry.computeBoundingBox();
      panda.traverse((o) => {
        if (!o.isMesh) return;
        const order = pandaDrawOrder(o.name, o.userData.paintOrder);
        if (order !== null) layered.push([o, order]);
        if (o.geometry.type === 'SphereGeometry' && o.geometry.parameters.widthSegments === 64)
          o.geometry = lowSphere;
      });
      return {
        panda,
        // The head can peek over a roof while the belly remains behind it. They
        // need independent visibility tests before raising their SVG paint order.
        layerGroups: [
          {
            anchor: head,
            center: head.geometry.boundingBox.getCenter(new THREE.Vector3()),
            layered: layered.filter(([o]) => !/^(belly$|emblem-svg-)/.test(o.name)),
            layersOn: null,
          },
          {
            anchor: belly,
            center: belly.geometry.boundingBox.getCenter(new THREE.Vector3()),
            layered: layered.filter(([o]) => /^(belly$|emblem-svg-)/.test(o.name)),
            layersOn: null,
          },
        ],
        faceDirection: new THREE.Vector3(0, 0, 1),
        facing: new THREE.Vector3(),
        toCamera: new THREE.Vector3(),
      };
    });
    // A raised draw order would also paint the face over the head from behind, or over
    // a tree or column in front of the panda, so it only applies while the face is in clear view.
    const ray = new THREE.Raycaster(),
      anchor = new THREE.Vector3();
    beforeRender = () => {
      // SVGRenderer updates matrices during render, after this hook. Resolve
      // cloned/posed parts first so the very first visibility result is valid.
      model.root.updateMatrixWorld(true);
      for (const state of pandaFaces) {
        if (!shown(state.panda)) continue;
        state.facing.copy(state.faceDirection).transformDirection(state.panda.matrixWorld);
        let blockers;
        for (const group of state.layerGroups) {
          anchor.copy(group.center).applyMatrix4(group.anchor.matrixWorld);
          state.toCamera.subVectors(camera.position, anchor);
          let clear = state.toCamera.dot(state.facing) > 0;
          if (clear) {
            const distance = state.toCamera.length();
            ray.set(camera.position, state.toCamera.negate().normalize());
            ray.far = distance - 1;
            if (!blockers) {
              blockers = [];
              model.root.traverse((o) => {
                if (o.isMesh && !o.isInstancedMesh && !isInside(o, state.panda) && shown(o))
                  blockers.push(o);
              });
            }
            clear = ray.intersectObjects(blockers, false).length === 0;
          }
          if (clear === group.layersOn) continue;
          group.layersOn = clear;
          for (const [o, order] of group.layered) o.renderOrder = clear ? order : 0;
        }
      }
    };
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
  const laboratoryView = createLaboratoryView(model);
  const atmosphere = createWorldAtmosphere({
    THREE,
    scene,
    camera,
    renderer,
    hemi,
    sun,
    fill,
    compatibilityMode,
    reducedMotion,
  });
  const weather = createWorldWeather({
    isActive: () => visible && !document.hidden,
    onChange(state) {
      atmosphere.setConditions(state);
      // SVG weather uses CSS overlays and a background tint. Clock/weather
      // refreshes must not repeatedly rebuild the complete architectural SVG.
      if (!compatibilityMode) needsDraw = true;
    },
  });
  weather.start();
  window.addEventListener('pagehide', (event) => {
    weather.stop();
    if (!event.persisted) {
      laboratoryView.dispose();
      atmosphere.dispose();
    }
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      weather.start();
      needsDraw = true;
    }
  });

  const presets = {
    perspective: { position: [34, 31, 43], target: [1, 1, -8] },
    eye: {
      position: mapPoint(...SITE.videoStartPixel, 1.7).toArray(),
      target: mapPoint(...SITE.videoTargetPixel, 1.9).toArray(),
    },
    aerial: {
      position: bendPoint(new THREE.Vector3(-0.55, 55, 0.5)).toArray(),
      target: bendPoint(new THREE.Vector3(-0.55, 0, 0)).toArray(),
    },
    enclosure: {
      position: bendPoint(new THREE.Vector3(GLASS_ROOM.startX - 4, 3.65, 14)).toArray(),
      target: bendPoint(new THREE.Vector3(GLASS_ROOM.centerX, 1.45, 0)).toArray(),
    },
    interior: {
      position: bendPoint(new THREE.Vector3(GLASS_ROOM.partitionX - 0.45, 1.72, 2.25)).toArray(),
      target: bendPoint(new THREE.Vector3(GLASS_ROOM.storeCenterX - 0.5, 1.4, -1.1)).toArray(),
    },
  };
  const compactTools = matchMedia('(max-width: 900px), (pointer: coarse) and (max-height: 500px)');
  const tools = $('#world-tools');
  const toolsToggle = $('#world-tools-toggle');
  function setToolsExpanded(expanded) {
    tools.classList.toggle('is-collapsed', !expanded);
    toolsToggle.setAttribute('aria-expanded', String(expanded));
  }
  setToolsExpanded(!compactTools.matches);
  toolsToggle.addEventListener('click', () => {
    setToolsExpanded(tools.classList.contains('is-collapsed'));
  });
  compactTools.addEventListener('change', (event) => {
    setToolsExpanded(!event.matches);
  });
  function updateViewButtons() {
    document.querySelectorAll('[data-view]').forEach((button) => {
      const active = button.dataset.view === currentView;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', active);
    });
  }
  function setView(name, animate = true) {
    if (!presets[name]) return;
    currentView = name;
    const indoor = name === 'interior';
    laboratoryView.setActive(indoor);
    atmosphere.setIndoor(indoor);
    document.body.dataset.worldView = indoor ? 'laboratory' : name;
    $('#landscape').disabled = indoor;
    $('#landscape').checked = model.landscape.visible;
    $('#viewport').setAttribute(
      'aria-label',
      indoor ? '可以转动和拉近看的织界实验室' : '可以转动和拉近看的织界空间',
    );
    $('.tools-label').textContent = indoor ? '织界实验室' : '浏览视角';
    if (!compatibilityMode) $('#render-mode').textContent = indoor ? '织界实验室' : '织界空间';
    $('.world-info p').textContent = indoor
      ? '转动视角，看看实验室的工具与作品。'
      : '拖动转一转，拉近看看建筑和草地。';
    const aspect = innerWidth / innerHeight;
    const portraitScale = aspect < 0.65 ? 1.7 : aspect < 0.9 ? 1.45 : 1;
    camera.fov =
      name === 'interior' ? (aspect < 0.9 ? 78 : 66) : name === 'eye' ? 56 : aspect < 0.9 ? 46 : 40;
    camera.near = name === 'interior' ? 0.04 : 0.5;
    controls.minDistance = name === 'interior' ? 0.6 : 5;
    controls.maxDistance = indoor ? 8.5 : 220;
    controls.maxTargetRadius = indoor ? 3 : 90;
    controls.cursor.copy(
      indoor ? bendPoint(new THREE.Vector3(GLASS_ROOM.storeCenterX, 1.4, 0)) : new THREE.Vector3(),
    );
    camera.updateProjectionMatrix();
    const preset = presets[name];
    const position = new THREE.Vector3(...preset.position),
      target = new THREE.Vector3(...preset.target);
    if (name === 'perspective' && portraitScale > 1)
      position.sub(target).multiplyScalar(portraitScale).add(target);
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
    updateViewButtons();
    needsDraw = true;
  }
  setView('perspective', false);
  document.querySelectorAll('[data-view]').forEach((button) =>
    button.addEventListener('click', () => {
      userAdjustedCamera = true;
      setView(button.dataset.view);
    }),
  );
  $('#landscape').addEventListener('change', (event) => {
    if (!laboratoryView.active) model.landscape.visible = event.target.checked;
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
    userAdjustedCamera = false;
    controls.autoRotate = false;
    $('#autorotate').checked = false;
    setView('perspective');
  });
  controls.addEventListener('start', () => {
    userAdjustedCamera = true;
    transition = null;
  });
  controls.addEventListener('change', () => {
    needsDraw = true;
  });
  window.addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    if (!userAdjustedCamera && currentView === 'perspective') setView('perspective', false);
    needsDraw = true;
  });
  window.addEventListener('message', (event) => {
    if (event.source !== parent || event.origin !== location.origin) return;
    if (event.data?.type === 'loom-world-mode') {
      const wasInteractive = interactive;
      interactive = !!event.data.interactive;
      controls.enabled = interactive;
      document.body.classList.toggle('interactive', interactive);
      if (!interactive && wasInteractive) {
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
    if (event.key !== 'Escape') return;
    if (embedded) notify('loom-world-close');
  });
  document.addEventListener('visibilitychange', () => {
    needsDraw = true;
  });
  let lastDraw = 0,
    readySent = false;
  function animate(time) {
    requestAnimationFrame(animate);
    if ((!visible && readySent) || document.hidden) return;
    if (compatibilityMode && time - lastDraw < 160) return;
    controls.update();
    const atmosphereChanged = atmosphere.update(time);
    if (!needsDraw && !transition && !controls.autoRotate && !atmosphereChanged) return;
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
    const near =
      currentView === 'interior'
        ? 0.04
        : Math.max(0.25, Math.min(3, camera.position.distanceTo(controls.target) / 50));
    if (Math.abs(camera.near - near) > 0.0001) {
      camera.near = near;
      camera.updateProjectionMatrix();
    }
    beforeRender();
    if (compatibilityMode)
      // SVGRenderer removes old paths one-by-one; batch-clear the attached SVG
      // first to avoid WebKit's pathological live-child removal cost.
      renderer.domElement.replaceChildren();
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
    laboratoryView,
    setView,
    compatibilityMode,
    weather,
    atmosphere,
    ready: true,
  };
}
init().catch((error) => {
  console.error(error);
  $('#loading').textContent = '暂时没打开，请刷新页面再试一次。';
  notify('loom-world-error');
});
