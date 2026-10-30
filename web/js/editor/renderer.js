import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { fallbackPlan, pandaDrawOrder } from '../../scene/fallback-rules.js';
import { createPavilion } from '../../scene/model.js';

const SKY_COLORS = {
  'soft-afternoon': 0xdbe3d2,
  'clear-day': 0xc7dced,
  dusk: 0x433f58,
};

const MATERIALS = {
  'leaf.deep-green': { color: 0x315c3b, roughness: 0.92 },
  'wood.warm-oak': { color: 0x956a43, roughness: 0.78 },
  'metal.graphite': { color: 0x343b3d, roughness: 0.38, metalness: 0.72 },
  'stone.warm-grey': { color: 0x88877e, roughness: 0.94 },
  'plaster.ivory': { color: 0xf0eee4, roughness: 0.84 },
  'glass.clear': {
    color: 0xb7d5d5,
    roughness: 0.16,
    metalness: 0.1,
    transparent: true,
    opacity: 0.2,
    side: THREE.DoubleSide,
    depthWrite: false,
  },
  'glass.frosted': {
    color: 0xcdd8d2,
    roughness: 0.78,
    transparent: true,
    opacity: 0.68,
    side: THREE.DoubleSide,
    depthWrite: false,
  },
};

function collectMaterialTextures(material, textures) {
  if (!material) return;
  if (Array.isArray(material)) {
    for (const entry of material) collectMaterialTextures(entry, textures);
    return;
  }
  for (const value of Object.values(material)) {
    if (value?.isTexture) textures.add(value);
    else if (Array.isArray(value))
      for (const item of value) if (item?.isTexture) textures.add(item);
  }
  for (const uniform of Object.values(material.uniforms || {})) {
    const value = uniform?.value;
    if (value?.isTexture) textures.add(value);
    else if (Array.isArray(value))
      for (const item of value) if (item?.isTexture) textures.add(item);
  }
}

function disposeTree(root, additionalMaterials = []) {
  if (!root) return new Set();
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const addMaterial = (material) => {
    if (!material) return;
    if (Array.isArray(material)) {
      for (const entry of material) addMaterial(entry);
      return;
    }
    if (materials.has(material)) return;
    materials.add(material);
    collectMaterialTextures(material, textures);
  };
  for (const material of additionalMaterials) addMaterial(material);
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    addMaterial(object.material);
    if (object.isInstancedMesh) object.dispose();
  });
  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) texture.dispose();
  for (const material of materials) material.dispose();
  root.removeFromParent();
  return materials;
}

function applySvgSimplification(root, TessellateModifier) {
  const originals = new Set();
  const generated = new Set();
  const originalMaterials = new Set();
  const originalTextures = new Set();
  // SVGRenderer emits a separate path for every triangle. Keep its optional edge
  // subdivision deliberately coarse; it exists only to improve painter ordering.
  const tessellate = TessellateModifier ? new TessellateModifier(4, 4) : null;
  const before = [];
  root.traverse((object) => {
    if (object.geometry) originals.add(object.geometry);
    if (object.material) {
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        originalMaterials.add(material);
        collectMaterialTextures(material, originalTextures);
      }
    }
    if (object.isInstancedMesh) object.visible = false;
    else if (object.isMesh) before.push(object);
  });

  for (const object of before) {
    const plan = fallbackPlan(object.name, object.material?.name);
    if (plan.hidden) {
      object.visible = false;
      continue;
    }
    // The panda's embossed SVG emblem is decorative and expands into tens of
    // thousands of paths. It is omitted in compatibility mode, where the main
    // panda silhouette and face remain visible.
    if (object.name.startsWith('emblem-svg-')) {
      object.visible = false;
      continue;
    }
    if (plan.renderOrder !== null) object.renderOrder = plan.renderOrder;
    if (plan.flatLawn) {
      object.geometry = new THREE.PlaneGeometry(180, 170, 30, 28);
      generated.add(object.geometry);
    }
    if (plan.flatColor) {
      const { color, doubleSide } = plan.flatColor;
      object.material = new THREE.MeshBasicMaterial({
        color,
        side: doubleSide ? THREE.DoubleSide : THREE.FrontSide,
      });
    }
    const isRoof = /屋面|顶板/.test(object.name);
    if (isRoof && object.geometry) {
      // The source roof has a highly tessellated curved outline. SVG rendering
      // does not benefit from those subdivisions, so preserve its overall
      // footprint as a compact slab instead of splitting it into more paths.
      object.geometry.computeBoundingBox();
      const bounds = object.geometry.boundingBox;
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const slab = new THREE.BoxGeometry(
        Math.max(size.x, 0.02),
        Math.max(size.y, 0.02),
        Math.max(size.z, 0.02),
      );
      slab.translate(center.x, center.y, center.z);
      object.geometry = slab;
      generated.add(slab);
    }
    if (plan.tessellate && tessellate && !isRoof) {
      const source = plan.tessellate === 'scaled' ? object.geometry.clone() : object.geometry;
      if (plan.tessellate === 'scaled')
        source.scale(object.scale.x, object.scale.y, object.scale.z);
      const result = tessellate.modify(source);
      if (source !== object.geometry) source.dispose();
      object.geometry = result;
      generated.add(result);
      if (plan.tessellate === 'scaled') object.scale.set(1, 1, 1);
    }
    if (plan.dropFaces) {
      const source = object.geometry.index
        ? object.geometry.toNonIndexed()
        : object.geometry.clone();
      const positions = source.attributes.position;
      const normals = source.attributes.normal;
      const uvs = source.attributes.uv;
      const nextPositions = [];
      const nextNormals = [];
      const nextUvs = [];
      for (let index = 0; index < positions.count; index += 3) {
        const normalY = normals.getY(index);
        if (plan.dropFaces === 'down' ? normalY < -0.5 : normalY > 0.5) continue;
        for (let vertex = 0; vertex < 3; vertex++) {
          const at = index + vertex;
          nextPositions.push(positions.getX(at), positions.getY(at), positions.getZ(at));
          nextNormals.push(normals.getX(at), normals.getY(at), normals.getZ(at));
          if (uvs) nextUvs.push(uvs.getX(at), uvs.getY(at));
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(nextPositions, 3));
      geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nextNormals, 3));
      if (nextUvs.length) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(nextUvs, 2));
      object.geometry = geometry;
      generated.add(geometry);
      source.dispose();
    }
  }

  const panda = root.getObjectByName('LoomOS Panda');
  const layers = [];
  if (panda) {
    const lowSphere = new THREE.SphereGeometry(1, 8, 6);
    panda.traverse((object) => {
      if (!object.isMesh) return;
      const order = pandaDrawOrder(object.name, object.userData.paintOrder);
      if (order !== null) layers.push([object, order]);
      if (
        object.geometry.type === 'SphereGeometry' &&
        object.geometry.parameters.widthSegments === 64
      ) {
        object.geometry = lowSphere;
      }
    });
    generated.add(lowSphere);
  }
  const liveGeometries = new Set();
  const liveMaterials = new Set();
  const liveTextures = new Set();
  root.traverse((object) => {
    if (object.geometry) liveGeometries.add(object.geometry);
    if (object.material) {
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        liveMaterials.add(material);
        collectMaterialTextures(material, liveTextures);
      }
    }
  });
  for (const geometry of new Set([...originals, ...generated])) {
    if (!liveGeometries.has(geometry)) geometry.dispose();
  }
  for (const texture of originalTextures) if (!liveTextures.has(texture)) texture.dispose();
  for (const material of originalMaterials) if (!liveMaterials.has(material)) material.dispose();
  if (!panda) return () => {};
  const raycaster = new THREE.Raycaster();
  const head = new THREE.Vector3();
  const facing = new THREE.Vector3();
  const toCamera = new THREE.Vector3();
  let layersOn = null;
  return (camera) => {
    panda.getWorldPosition(head);
    head.y += 1.25;
    facing.set(Math.sin(panda.rotation.y), 0, Math.cos(panda.rotation.y));
    toCamera.subVectors(camera.position, head);
    let clear = toCamera.dot(facing) > 0;
    if (clear) {
      const distance = toCamera.length();
      raycaster.set(camera.position, toCamera.negate().normalize());
      raycaster.far = distance - 1;
      const blockers = [];
      root.traverse((object) => {
        if (!object.isMesh || object.isInstancedMesh || !object.visible) return;
        let parent = object;
        while (parent && parent !== panda) parent = parent.parent;
        if (parent !== panda) blockers.push(object);
      });
      clear = raycaster.intersectObjects(blockers, false).length === 0;
    }
    if (clear === layersOn) return;
    layersOn = clear;
    for (const [object, order] of layers) object.renderOrder = clear ? order : 0;
  };
}

function makeMaterial(materialId) {
  const options = MATERIALS[materialId];
  if (!options) throw new TypeError(`Unregistered material: ${materialId}`);
  const material = new THREE.MeshStandardMaterial(options);
  material.name = materialId;
  return material;
}

function transformOf(object) {
  return {
    position: object.position.toArray(),
    rotation: object.rotation.toArray().slice(0, 3),
    scale: object.scale.toArray(),
  };
}

function setTransform(object, transform) {
  object.position.fromArray(transform.position);
  object.rotation.set(...transform.rotation);
  object.scale.fromArray(transform.scale);
}

function createGardenObject(entry) {
  const group = new THREE.Group();
  group.name = entry.name;
  group.userData.sceneObjectId = entry.id;
  group.userData.assetId = entry.assetId;
  const surface = makeMaterial(entry.materialId);
  const detail = new THREE.MeshStandardMaterial({ color: 0x71583d, roughness: 0.9 });
  const bulb = new THREE.MeshStandardMaterial({
    color: 0xffe2a5,
    emissive: 0xb77a2d,
    emissiveIntensity: 0.45,
    roughness: 0.34,
  });
  const mesh = (geometry, material = surface, name = 'garden component') => {
    const object = new THREE.Mesh(geometry, material);
    object.name = name;
    object.castShadow = true;
    object.receiveShadow = true;
    if (material === surface) object.userData.materialSlot = 'surface';
    group.add(object);
    return object;
  };

  if (entry.assetId === 'garden.bamboo-cluster') {
    for (let index = 0; index < 7; index++) {
      const angle = index * 2.399;
      const x = Math.cos(angle) * (0.18 + (index % 3) * 0.09);
      const z = Math.sin(angle) * (0.18 + (index % 2) * 0.1);
      const height = 2.6 + (index % 4) * 0.42;
      const stalk = mesh(new THREE.CylinderGeometry(0.045, 0.065, height, 8), surface, '竹竿');
      stalk.position.set(x, height / 2, z);
      for (let node = 1; node < 5; node++) {
        const joint = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.045, 8), surface, '竹节');
        joint.position.set(x, (height * node) / 5, z);
      }
      for (let leaf = 0; leaf < 3; leaf++) {
        const frond = mesh(new THREE.ConeGeometry(0.12, 0.92, 5), surface, '竹叶');
        frond.position.set(
          x + Math.cos(angle + leaf) * 0.38,
          height * (0.66 + leaf * 0.08),
          z + Math.sin(angle + leaf) * 0.38,
        );
        frond.rotation.z = -0.75 + leaf * 0.22;
        frond.rotation.y = angle + leaf;
      }
    }
  } else if (entry.assetId === 'garden.bench.wood') {
    for (let index = 0; index < 4; index++) {
      const plank = mesh(new THREE.BoxGeometry(2.15, 0.12, 0.2), surface, '长椅木板');
      plank.position.set(0, 0.58 + index * 0.24, index < 2 ? 0 : -0.32);
      if (index >= 2) plank.rotation.x = -0.12;
    }
    for (const x of [-0.82, 0.82]) {
      const leg = mesh(new THREE.BoxGeometry(0.12, 0.54, 0.52), surface, '长椅支架');
      leg.position.set(x, 0.28, 0);
      const back = mesh(new THREE.BoxGeometry(0.12, 0.72, 0.13), surface, '靠背支柱');
      back.position.set(x, 0.94, -0.31);
      back.rotation.x = -0.12;
    }
  } else if (entry.assetId === 'garden.lamp') {
    const base = mesh(new THREE.CylinderGeometry(0.32, 0.42, 0.2, 12), surface, '园灯底座');
    base.position.y = 0.1;
    const post = mesh(new THREE.CylinderGeometry(0.08, 0.12, 2.65, 10), surface, '园灯灯柱');
    post.position.y = 1.5;
    const head = mesh(new THREE.CylinderGeometry(0.42, 0.3, 0.48, 12), surface, '园灯灯罩');
    head.position.y = 2.95;
    const light = mesh(new THREE.SphereGeometry(0.23, 12, 8), bulb, '园灯灯泡');
    light.position.y = 2.7;
  } else if (entry.assetId === 'garden.tree') {
    const trunk = mesh(new THREE.CylinderGeometry(0.12, 0.2, 2.8, 8), detail, '树干');
    trunk.position.y = 1.4;
    for (let index = 0; index < 5; index++) {
      const crown = mesh(new THREE.IcosahedronGeometry(1.0, 1), surface, '树冠');
      const angle = index * 2.399;
      crown.position.set(Math.cos(angle) * 0.62, 3.0 + (index % 3) * 0.6, Math.sin(angle) * 0.62);
      crown.scale.set(1.12, 1.0, 1.08);
    }
  } else {
    surface.dispose();
    detail.dispose();
    bulb.dispose();
    throw new TypeError(`Unregistered asset: ${entry.assetId}`);
  }
  group.userData.surfaceMaterial = surface;
  setTransform(group, entry.transform);
  const usedMaterials = new Set();
  group.traverse((object) => {
    if (object.material) {
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        usedMaterials.add(material);
      }
    }
  });
  if (!usedMaterials.has(detail)) detail.dispose();
  if (!usedMaterials.has(bulb)) bulb.dispose();
  return group;
}

/** Owns one isolated renderer and scene instance for an already-validated SceneDocument. */
export async function createSpaceRenderer({
  container,
  onSelect = () => {},
  onTransform = () => {},
  onCameraChange = () => {},
  onStatus = () => {},
  readOnly = false,
}) {
  if (!container?.appendChild) throw new TypeError('container must be a DOM element');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY_COLORS['soft-afternoon']);
  scene.fog = new THREE.Fog(SKY_COLORS['soft-afternoon'], 80, 210);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.25, 400);
  camera.position.set(18, 12, 24);
  const hemisphere = new THREE.HemisphereLight(0xe9f3ee, 0x8b986b, 2.5);
  const sun = new THREE.DirectionalLight(0xfff7df, 1.2);
  sun.position.set(-45, 80, 60);
  const fill = new THREE.DirectionalLight(0xe2f0f3, 0.6);
  fill.position.set(15, 10, -20);
  scene.add(hemisphere, sun, fill);

  let renderer;
  let mode = 'webgl';
  let TessellateModifier = null;
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2', { antialias: true, powerPreference: 'default' });
    if (!context) throw new Error('WebGL2 unavailable');
    renderer = new THREE.WebGLRenderer({ canvas, context, antialias: true });
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.5));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;
  } catch {
    const { SVGRenderer } = await import('three/addons/renderers/SVGRenderer.js');
    ({ TessellateModifier } = await import('three/addons/modifiers/TessellateModifier.js'));
    renderer = new SVGRenderer();
    renderer.setQuality('low');
    mode = 'svg';
  }
  container.appendChild(renderer.domElement);
  if (mode === 'svg') {
    onStatus({ mode, message: '当前为简化 SVG 画面；密集草叶和阴影已省略。' });
  } else {
    onStatus({ mode, message: 'WebGL 3D 画面已就绪。' });
  }

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 1.5, 0);
  controls.update();
  // Damping is useful while orbiting WebGL, but its change events trigger an
  // animation frame per settling step. The SVG compatibility view stays static
  // after the pointer interaction, so it should render only on actual changes.
  controls.enableDamping = mode !== 'svg';
  controls.dampingFactor = 0.075;
  controls.minDistance = 5;
  controls.maxDistance = 220;
  controls.maxPolarAngle = Math.PI / 2 - 0.035;
  controls.minPolarAngle = 0.06;
  controls.maxTargetRadius = 90;
  scene.add(new THREE.AmbientLight(0xffffff, mode === 'svg' ? 0.62 : 0));

  const templateRoot = new THREE.Group();
  templateRoot.name = '个人空间母版实例';
  scene.add(templateRoot);
  const objectRoot = new THREE.Group();
  objectRoot.name = '个人空间组件';
  scene.add(objectRoot);
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const intersection = new THREE.Vector3();
  const objectGroups = new Map();
  const targetDefaults = new Map();
  const overrideMaterials = new Map();
  const objectMaterials = new Map();
  let model = null;
  let svgBeforeRender = () => {};
  let documentValue = null;
  let selectedId = null;
  let selectionHelper = null;
  let transformMode = 'orbit';
  let moving = null;
  let pointerDown = null;
  let frame = 0;
  let needsDraw = true;
  let disposed = false;
  let wasHidden = false;

  const requestDraw = () => {
    needsDraw = true;
    if (!frame && !disposed && !document.hidden) frame = requestAnimationFrame(draw);
  };

  const readCamera = () => ({
    position: camera.position.toArray(),
    target: controls.target.toArray(),
    fovDegrees: camera.fov,
  });

  const setCamera = (value) => {
    camera.position.fromArray(value.position);
    controls.target.fromArray(value.target);
    camera.fov = value.fovDegrees;
    camera.updateProjectionMatrix();
    controls.update();
  };

  const resize = () => {
    if (disposed) return;
    const bounds = container.getBoundingClientRect();
    const width = Math.max(1, Math.floor(bounds.width || container.clientWidth || 1));
    const height = Math.max(1, Math.floor(bounds.height || container.clientHeight || 1));
    renderer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    requestDraw();
  };

  const setSelection = (id) => {
    const group = id === null ? null : objectGroups.get(id);
    if (!group && id !== null) return;
    selectedId = id;
    if (selectionHelper) {
      scene.remove(selectionHelper);
      selectionHelper.geometry.dispose();
      selectionHelper.material.dispose();
      selectionHelper = null;
    }
    if (group) {
      selectionHelper = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color(0xf0a35b));
      selectionHelper.material.depthTest = false;
      selectionHelper.material.transparent = true;
      selectionHelper.material.opacity = 0.95;
      scene.add(selectionHelper);
      updateSelectionHelper();
    }
    requestDraw();
  };

  function updateSelectionHelper() {
    if (!selectionHelper) return;
    const group = objectGroups.get(selectedId);
    if (!group) {
      setSelection(null);
      return;
    }
    group.updateWorldMatrix(true, true);
    selectionHelper.box.setFromObject(group);
    selectionHelper.updateMatrixWorld(true);
  }

  const raycastObject = (event) => {
    const bounds = renderer.domElement.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    scene.updateMatrixWorld(true);
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects([...objectGroups.values()], true);
    for (const hit of hits) {
      let object = hit.object;
      while (object && !object.userData.sceneObjectId) object = object.parent;
      if (object && objectGroups.get(object.userData.sceneObjectId) === object) return object;
    }
    return null;
  };

  const intersectGround = (event) => {
    const bounds = renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    return raycaster.ray.intersectPlane(groundPlane, intersection) ? intersection.clone() : null;
  };

  const onPointerDown = (event) => {
    if (disposed || event.button !== 0) return;
    const object = raycastObject(event);
    pointerDown = { x: event.clientX, y: event.clientY };
    if (transformMode !== 'move' || readOnly || !object) return;
    const point = intersectGround(event);
    if (!point) return;
    setSelection(object.userData.sceneObjectId);
    onSelect(object.userData.sceneObjectId);
    moving = {
      id: object.userData.sceneObjectId,
      group: object,
      pointerId: event.pointerId,
      offset: new THREE.Vector3(object.position.x - point.x, 0, object.position.z - point.z),
      startingTransform: transformOf(object),
      moved: false,
    };
    renderer.domElement.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event) => {
    if (!moving) return;
    const point = intersectGround(event);
    if (!point) return;
    const previous = moving.group.position.clone();
    moving.group.position.set(
      point.x + moving.offset.x,
      moving.startingTransform.position[1],
      point.z + moving.offset.z,
    );
    moving.moved ||= moving.group.position.distanceToSquared(previous) > 1e-4;
    updateSelectionHelper();
    requestDraw();
    event.preventDefault();
  };

  const onPointerUp = (event) => {
    if (moving) {
      const ended = moving;
      moving = null;
      renderer.domElement.releasePointerCapture?.(ended.pointerId ?? event.pointerId);
      if (ended.moved) onTransform({ id: ended.id, transform: transformOf(ended.group) });
      pointerDown = null;
      return;
    }
    if (!pointerDown) return;
    const distance = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y);
    if (distance <= 6) {
      const object = raycastObject(event);
      const id = object?.userData.sceneObjectId || null;
      setSelection(id);
      onSelect(id);
    }
    pointerDown = null;
  };

  const onPointerCancel = (event) => {
    if (moving) {
      renderer.domElement.releasePointerCapture?.(moving.pointerId ?? event.pointerId);
      setTransform(moving.group, moving.startingTransform);
      requestDraw();
    }
    moving = null;
    pointerDown = null;
  };

  let cameraAtInteractionStart = null;
  const onStart = () => {
    cameraAtInteractionStart = readCamera();
  };
  const onEnd = () => {
    if (!cameraAtInteractionStart) return;
    const previous = cameraAtInteractionStart;
    const current = readCamera();
    cameraAtInteractionStart = null;
    const changed =
      previous.position.some((value, index) => Math.abs(value - current.position[index]) > 1e-4) ||
      previous.target.some((value, index) => Math.abs(value - current.target[index]) > 1e-4) ||
      Math.abs(previous.fovDegrees - current.fovDegrees) > 1e-4;
    if (changed) onCameraChange(current);
  };
  controls.addEventListener('start', onStart);
  controls.addEventListener('end', onEnd);
  controls.addEventListener('change', requestDraw);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('pointercancel', onPointerCancel);
  renderer.domElement.style.touchAction = 'none';

  const resizeObserver = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
  resizeObserver?.observe(container);
  window.addEventListener('resize', resize);
  const onVisibilityChange = () => {
    wasHidden = document.hidden;
    if (document.hidden && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    } else if (!document.hidden) requestDraw();
  };
  const onPageHide = () => {
    wasHidden = true;
    if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
  };
  const onPageShow = () => {
    wasHidden = document.hidden;
    if (!document.hidden) requestDraw();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  resize();

  function draw() {
    frame = 0;
    if (disposed || document.hidden || wasHidden || !needsDraw) return;
    needsDraw = false;
    controls.update();
    updateSelectionHelper();
    svgBeforeRender(camera);
    renderer.render(scene, camera);
  }

  const rebuildTemplate = (seed) => {
    if (model) {
      for (const entries of targetDefaults.values()) {
        for (const [object, material] of entries) object.material = material;
      }
      model.root.traverse((object) => {
        delete object.userData.templateTargetId;
      });
      disposeTree(model.root);
    }
    targetDefaults.clear();
    model = createPavilion({ seed });
    templateRoot.add(model.root);
    svgBeforeRender = () => {};
    if (mode === 'svg') svgBeforeRender = applySvgSimplification(model.root, TessellateModifier);
    model.root.traverse((object) => {
      const targetId = object.userData.templateTargetId;
      if (object.isMesh && targetId) {
        if (!targetDefaults.has(targetId)) targetDefaults.set(targetId, []);
        targetDefaults.get(targetId).push([object, object.material]);
      }
    });
  };

  const applyEnvironment = (environment) => {
    const color = SKY_COLORS[environment.skyPreset];
    scene.background.setHex(color);
    scene.fog.color.setHex(color);
    hemisphere.intensity = mode === 'svg' ? 0.9 : 2.5 * (environment.ambientIntensity / 0.8);
    sun.intensity = mode === 'svg' ? 0.3 : environment.sunIntensity * 2.58;
    fill.intensity = mode === 'svg' ? 0.1 : 0.6 * (environment.ambientIntensity / 0.8);
    const daylight = (environment.timeOfDay / 24) * Math.PI * 2 - Math.PI / 2;
    sun.position.set(-45 * Math.cos(daylight), Math.max(-30, 8 + 72 * Math.sin(daylight)), 60);
    model.landscape.visible = environment.landscapeVisible;
    model.building.traverse((object) => {
      if (!object.userData.doorLeaf) return;
      const closed = object.userData.closedAngle ?? 0;
      object.rotation.y =
        closed + (environment.doorState === 'open' ? object.userData.openAngle : 0);
    });
  };

  const applyTemplateOverrides = (overrides) => {
    for (const [targetId, entries] of targetDefaults) {
      for (const [object, material] of entries) object.material = material;
      const override = overrides.find((item) => item.targetId === targetId);
      if (!override) continue;
      const key = `${targetId}:${override.materialId}`;
      let material = overrideMaterials.get(key);
      if (!material) {
        material = makeMaterial(override.materialId);
        overrideMaterials.set(key, material);
      }
      for (const [object] of entries) object.material = material;
    }
  };

  const updateObjects = (entries) => {
    const seen = new Set();
    for (const entry of entries) {
      seen.add(entry.id);
      let group = objectGroups.get(entry.id);
      if (!group || group.userData.assetId !== entry.assetId) {
        if (group) {
          objectRoot.remove(group);
          objectGroups.delete(entry.id);
          objectMaterials.delete(entry.id);
          disposeTree(group);
        }
        group = createGardenObject(entry);
        objectRoot.add(group);
        objectGroups.set(entry.id, group);
        objectMaterials.set(entry.id, group.userData.surfaceMaterial);
      } else {
        group.name = entry.name;
        setTransform(group, entry.transform);
        const oldMaterial = objectMaterials.get(entry.id);
        if (oldMaterial?.name !== entry.materialId) {
          const material = makeMaterial(entry.materialId);
          group.traverse((object) => {
            if (object.isMesh && object.userData.materialSlot === 'surface')
              object.material = material;
          });
          oldMaterial?.dispose();
          objectMaterials.set(entry.id, material);
          group.userData.surfaceMaterial = material;
        }
      }
      setTransform(group, entry.transform);
    }
    for (const [id, group] of objectGroups) {
      if (seen.has(id)) continue;
      objectRoot.remove(group);
      objectGroups.delete(id);
      objectMaterials.delete(id);
      if (selectedId === id) {
        setSelection(null);
        onSelect(null);
      }
      disposeTree(group);
    }
    updateSelectionHelper();
  };

  return {
    setScene(sceneValue, { preserveCamera = false } = {}) {
      if (disposed) throw new Error('renderer is disposed');
      if (
        sceneValue?.template?.id !== 'official-pavilion-garden' ||
        sceneValue?.template?.version !== '1.0.0'
      ) {
        throw new TypeError('Unsupported pavilion template');
      }
      const previous = documentValue;
      documentValue = sceneValue;
      if (!model || !previous || sceneValue.seed !== previous.seed)
        rebuildTemplate(sceneValue.seed);
      applyEnvironment(sceneValue.environment);
      applyTemplateOverrides(sceneValue.templateOverrides);
      updateObjects(sceneValue.objects);
      if (!preserveCamera || !previous) setCamera(sceneValue.camera);
      requestDraw();
    },
    setSelection(id) {
      if (id !== null && !objectGroups.has(id)) throw new TypeError(`Unknown object id: ${id}`);
      setSelection(id);
    },
    setTransformMode(modeValue) {
      if (modeValue !== 'orbit' && modeValue !== 'move') {
        throw new TypeError("transform mode must be 'orbit' or 'move'");
      }
      transformMode = modeValue;
      controls.enabled = readOnly || modeValue === 'orbit';
    },
    getCamera: readCamera,
    dispose() {
      if (disposed) return;
      disposed = true;
      if (moving) renderer.domElement.releasePointerCapture?.(moving.pointerId);
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      resizeObserver?.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('pageshow', onPageShow);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      controls.removeEventListener('end', onEnd);
      controls.removeEventListener('start', onStart);
      controls.removeEventListener('change', requestDraw);
      controls.dispose();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerCancel);
      const retainedMaterials = new Set(overrideMaterials.values());
      for (const entries of targetDefaults.values()) {
        for (const [, material] of entries) retainedMaterials.add(material);
      }
      disposeTree(scene, retainedMaterials);
      overrideMaterials.clear();
      objectMaterials.clear();
      renderer.dispose?.();
      renderer.renderLists?.dispose?.();
      renderer.domElement.remove();
    },
  };
}
