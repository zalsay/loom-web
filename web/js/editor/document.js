const freezeDeep = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
};

export const SCENE_LIMITS = freezeDeep({
  maxBytes: 256 * 1024,
  maxObjects: 256,
  maxOperations: 32,
  maxTemplateOverrides: 3,
  maxTitleLength: 80,
  maxNameLength: 64,
  maxIdLength: 64,
  maxCoordinate: 200,
  minY: -5,
  maxY: 100,
  maxRotation: Math.PI * 2,
  minScale: 0.1,
  maxScale: 5,
  minFovDegrees: 20,
  maxFovDegrees: 90,
  maxTimeOfDay: 24,
  maxLightIntensity: 5,
  maxSeed: 0xffffffff,
});

export const ASSETS = freezeDeep({
  'garden.bamboo-cluster': {
    id: 'garden.bamboo-cluster',
    label: '竹丛',
    name: '竹丛',
    materialIds: ['leaf.deep-green'],
  },
  'garden.bench.wood': {
    id: 'garden.bench.wood',
    label: '木长椅',
    name: '木长椅',
    materialIds: ['wood.warm-oak', 'metal.graphite', 'stone.warm-grey'],
  },
  'garden.lamp': {
    id: 'garden.lamp',
    label: '园灯',
    name: '园灯',
    materialIds: ['metal.graphite', 'stone.warm-grey'],
  },
  'garden.tree': {
    id: 'garden.tree',
    label: '树木',
    name: '树木',
    materialIds: ['leaf.deep-green', 'wood.warm-oak'],
  },
});

export const MATERIALS = freezeDeep({
  'leaf.deep-green': {
    id: 'leaf.deep-green',
    label: '深绿叶片',
    name: '深绿叶片',
    assetIds: ['garden.bamboo-cluster', 'garden.tree'],
    targetIds: [],
  },
  'wood.warm-oak': {
    id: 'wood.warm-oak',
    label: '暖橡木',
    name: '暖橡木',
    assetIds: ['garden.bench.wood', 'garden.tree'],
    targetIds: ['pavilion.frame'],
  },
  'metal.graphite': {
    id: 'metal.graphite',
    label: '石墨金属',
    name: '石墨金属',
    assetIds: ['garden.bench.wood', 'garden.lamp'],
    targetIds: ['pavilion.frame', 'pavilion.roof'],
  },
  'stone.warm-grey': {
    id: 'stone.warm-grey',
    label: '暖灰石材',
    name: '暖灰石材',
    assetIds: ['garden.bench.wood', 'garden.lamp'],
    targetIds: [],
  },
  'plaster.ivory': {
    id: 'plaster.ivory',
    label: '象牙白抹面',
    name: '象牙白抹面',
    assetIds: [],
    targetIds: ['pavilion.frame', 'pavilion.roof'],
  },
  'glass.clear': {
    id: 'glass.clear',
    label: '透明玻璃',
    name: '透明玻璃',
    assetIds: [],
    targetIds: ['pavilion.glass'],
  },
  'glass.frosted': {
    id: 'glass.frosted',
    label: '磨砂玻璃',
    name: '磨砂玻璃',
    assetIds: [],
    targetIds: ['pavilion.glass'],
  },
});

export const TEMPLATE_TARGETS = freezeDeep({
  'pavilion.frame': {
    id: 'pavilion.frame',
    materialSlot: 'surface',
    materialIds: ['plaster.ivory', 'metal.graphite', 'wood.warm-oak'],
  },
  'pavilion.roof': {
    id: 'pavilion.roof',
    materialSlot: 'surface',
    materialIds: ['plaster.ivory', 'metal.graphite'],
  },
  'pavilion.glass': {
    id: 'pavilion.glass',
    materialSlot: 'surface',
    materialIds: ['glass.clear', 'glass.frosted'],
  },
});

const SCENE_KEYS = [
  'schemaVersion',
  'documentId',
  'title',
  'template',
  'units',
  'upAxis',
  'seed',
  'registries',
  'templateOverrides',
  'environment',
  'camera',
  'objects',
];
const ENVIRONMENT_KEYS = [
  'skyPreset',
  'timeOfDay',
  'sunIntensity',
  'ambientIntensity',
  'doorState',
  'landscapeVisible',
];
const SKY_PRESETS = new Set(['soft-afternoon', 'clear-day', 'dusk']);
const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);

function invalid(path, message) {
  throw new TypeError(`${path}: ${message}`);
}

function assertPlainObject(value, path, allowedKeys, requiredKeys = allowedKeys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    invalid(path, 'must be a plain object');
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    invalid(path, 'must not have a custom prototype');
  }

  const allowed = new Set(allowedKeys);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') invalid(path, 'symbol keys are not allowed');
    if (!allowed.has(key)) invalid(`${path}.${key}`, 'unknown field');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !hasOwn(descriptor, 'value')) {
      invalid(`${path}.${key}`, 'must be an enumerable data property');
    }
  }
  for (const key of requiredKeys) {
    if (!hasOwn(value, key)) invalid(`${path}.${key}`, 'is required');
  }
  return value;
}

function assertArray(value, path, maxLength = Number.MAX_SAFE_INTEGER) {
  if (!Array.isArray(value)) invalid(path, 'must be an array');
  if (value.length > maxLength) invalid(path, `must contain at most ${maxLength} items`);
  for (const key of Reflect.ownKeys(value)) {
    if (key === 'length') continue;
    if (typeof key !== 'string' || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length) {
      invalid(path, 'must not have extra or symbol properties');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !hasOwn(descriptor, 'value')) {
      invalid(`${path}[${key}]`, 'must be an enumerable data item');
    }
  }
  for (let index = 0; index < value.length; index++) {
    if (!hasOwn(value, index)) invalid(`${path}[${index}]`, 'sparse arrays are not allowed');
  }
  return value;
}

function finiteNumber(value, path, min, max, integer = false) {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(path, 'must be finite');
  if (value < min || value > max) invalid(path, `must be between ${min} and ${max}`);
  if (integer && !Number.isInteger(value)) invalid(path, 'must be an integer');
  return Object.is(value, -0) ? 0 : value;
}

function text(value, path, maxLength) {
  if (typeof value !== 'string') invalid(path, 'must be a string');
  if (value.length > maxLength * 2)
    invalid(path, `must contain 1 to ${maxLength} non-whitespace characters`);
  const characterLength = Array.from(value).length;
  if (characterLength === 0 || characterLength > maxLength || !value.trim()) {
    invalid(path, `must contain 1 to ${maxLength} non-whitespace characters`);
  }
  if (/[\u0000-\u001f\u007f]/u.test(value)) invalid(path, 'must not contain control characters');
  return value;
}

function identifier(value, path) {
  const result = text(value, path, SCENE_LIMITS.maxIdLength);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) {
    invalid(path, 'contains unsupported identifier characters');
  }
  return result;
}

function numberTuple(value, path, length, validateItem) {
  assertArray(value, path, length);
  if (value.length !== length) invalid(path, `must contain exactly ${length} numbers`);
  const result = [];
  for (let index = 0; index < value.length; index++) {
    result.push(validateItem(value[index], `${path}[${index}]`));
  }
  return result;
}

function parseVector(value, path, { rotation = false } = {}) {
  return numberTuple(value, path, 3, (item, itemPath) => {
    if (rotation) {
      return finiteNumber(item, itemPath, -SCENE_LIMITS.maxRotation, SCENE_LIMITS.maxRotation);
    }
    return finiteNumber(
      item,
      itemPath,
      itemPath.endsWith('[1]') ? SCENE_LIMITS.minY : -SCENE_LIMITS.maxCoordinate,
      itemPath.endsWith('[1]') ? SCENE_LIMITS.maxY : SCENE_LIMITS.maxCoordinate,
    );
  });
}

function parseTransform(value, path) {
  assertPlainObject(value, path, ['position', 'rotation', 'scale']);
  return {
    position: parseVector(value.position, `${path}.position`),
    rotation: parseVector(value.rotation, `${path}.rotation`, { rotation: true }),
    scale: numberTuple(value.scale, `${path}.scale`, 3, (item, itemPath) =>
      finiteNumber(item, itemPath, SCENE_LIMITS.minScale, SCENE_LIMITS.maxScale),
    ),
  };
}

function parseCamera(value, path = 'camera') {
  assertPlainObject(value, path, ['position', 'target', 'fovDegrees']);
  const position = parseVector(value.position, `${path}.position`);
  const target = parseVector(value.target, `${path}.target`);
  if (position.every((coordinate, index) => coordinate === target[index])) {
    invalid(path, 'position and target must differ');
  }
  return {
    position,
    target,
    fovDegrees: finiteNumber(
      value.fovDegrees,
      `${path}.fovDegrees`,
      SCENE_LIMITS.minFovDegrees,
      SCENE_LIMITS.maxFovDegrees,
    ),
  };
}

function parseEnvironment(value, path = 'environment', { partial = false } = {}) {
  assertPlainObject(value, path, ENVIRONMENT_KEYS, partial ? [] : ENVIRONMENT_KEYS);
  if (partial && Reflect.ownKeys(value).length === 0)
    invalid(path, 'must update at least one field');

  const result = {};
  for (const key of ENVIRONMENT_KEYS) {
    if (!hasOwn(value, key)) continue;
    const field = value[key];
    switch (key) {
      case 'skyPreset':
        if (typeof field !== 'string' || !SKY_PRESETS.has(field))
          invalid(`${path}.${key}`, 'is not registered');
        result[key] = field;
        break;
      case 'timeOfDay':
        result[key] = finiteNumber(field, `${path}.${key}`, 0, SCENE_LIMITS.maxTimeOfDay);
        break;
      case 'sunIntensity':
      case 'ambientIntensity':
        result[key] = finiteNumber(field, `${path}.${key}`, 0, SCENE_LIMITS.maxLightIntensity);
        break;
      case 'doorState':
        if (field !== 'open' && field !== 'closed')
          invalid(`${path}.${key}`, 'must be open or closed');
        result[key] = field;
        break;
      case 'landscapeVisible':
        if (typeof field !== 'boolean') invalid(`${path}.${key}`, 'must be a boolean');
        result[key] = field;
        break;
    }
  }
  return result;
}

function parseObject(value, path = 'object') {
  assertPlainObject(value, path, ['id', 'assetId', 'name', 'transform', 'materialId']);
  const id = identifier(value.id, `${path}.id`);
  const assetId = value.assetId;
  if (typeof assetId !== 'string' || !hasOwn(ASSETS, assetId))
    invalid(`${path}.assetId`, 'is not registered');
  const materialId = value.materialId;
  if (typeof materialId !== 'string' || !ASSETS[assetId].materialIds.includes(materialId)) {
    invalid(`${path}.materialId`, `is not compatible with ${assetId}`);
  }
  return {
    id,
    assetId,
    name: text(value.name, `${path}.name`, SCENE_LIMITS.maxNameLength),
    transform: parseTransform(value.transform, `${path}.transform`),
    materialId,
  };
}

function parseTemplateOverrides(value, path = 'templateOverrides') {
  assertArray(value, path, SCENE_LIMITS.maxTemplateOverrides);
  const seen = new Set();
  const result = [];
  for (let index = 0; index < value.length; index++) {
    const entry = value[index];
    const entryPath = `${path}[${index}]`;
    assertPlainObject(entry, entryPath, ['targetId', 'materialSlot', 'materialId']);
    const targetId = entry.targetId;
    if (typeof targetId !== 'string' || !hasOwn(TEMPLATE_TARGETS, targetId)) {
      invalid(`${entryPath}.targetId`, 'is not an editable template target');
    }
    const target = TEMPLATE_TARGETS[targetId];
    if (entry.materialSlot !== target.materialSlot)
      invalid(`${entryPath}.materialSlot`, 'is not registered for this target');
    const materialId = entry.materialId;
    if (typeof materialId !== 'string' || !target.materialIds.includes(materialId)) {
      invalid(`${entryPath}.materialId`, `is not compatible with ${targetId}`);
    }
    if (seen.has(targetId)) invalid(`${entryPath}.targetId`, 'is duplicated');
    seen.add(targetId);
    result.push({ targetId, materialSlot: target.materialSlot, materialId });
  }
  return result;
}

function byteLength(value) {
  return new TextEncoder().encode(value).byteLength;
}

function assertSceneSize(scene) {
  const serialized = JSON.stringify(scene);
  if (byteLength(serialized) > SCENE_LIMITS.maxBytes) {
    invalid('scene', `serialized UTF-8 JSON exceeds ${SCENE_LIMITS.maxBytes} bytes`);
  }
}

export function validateSceneDocument(value) {
  assertPlainObject(value, 'scene', SCENE_KEYS);
  if (value.schemaVersion !== 1) invalid('scene.schemaVersion', 'unsupported version');

  assertPlainObject(value.template, 'scene.template', ['id', 'version']);
  if (value.template.id !== 'official-pavilion-garden' || value.template.version !== '1.0.0') {
    invalid('scene.template', 'must reference official-pavilion-garden@1.0.0');
  }
  assertPlainObject(value.registries, 'scene.registries', ['templates', 'materials', 'assets']);
  if (
    value.registries.templates !== 'loom-templates@1' ||
    value.registries.materials !== 'loom-materials@1' ||
    value.registries.assets !== 'loom-garden-assets@1'
  ) {
    invalid('scene.registries', 'registry versions are unsupported');
  }
  if (value.units !== 'meters') invalid('scene.units', 'must be meters');
  if (value.upAxis !== '+Y') invalid('scene.upAxis', 'must be +Y');

  const seed = finiteNumber(value.seed, 'scene.seed', 0, SCENE_LIMITS.maxSeed, true);
  const objectsInput = assertArray(value.objects, 'scene.objects', SCENE_LIMITS.maxObjects);
  const objectIds = new Set();
  const objects = [];
  for (let index = 0; index < objectsInput.length; index++) {
    const item = objectsInput[index];
    const object = parseObject(item, `scene.objects[${index}]`);
    if (objectIds.has(object.id)) invalid(`scene.objects[${index}].id`, 'must be unique');
    objectIds.add(object.id);
    objects.push(object);
  }

  const scene = {
    schemaVersion: 1,
    documentId: identifier(value.documentId, 'scene.documentId'),
    title: text(value.title, 'scene.title', SCENE_LIMITS.maxTitleLength),
    template: { id: 'official-pavilion-garden', version: '1.0.0' },
    units: 'meters',
    upAxis: '+Y',
    seed,
    registries: {
      templates: 'loom-templates@1',
      materials: 'loom-materials@1',
      assets: 'loom-garden-assets@1',
    },
    templateOverrides: parseTemplateOverrides(value.templateOverrides),
    environment: parseEnvironment(value.environment),
    camera: parseCamera(value.camera, 'scene.camera'),
    objects,
  };
  assertSceneSize(scene);
  return scene;
}

function parseMaterialTarget(value, path = 'target') {
  assertPlainObject(value, path, ['kind', 'objectId', 'targetId', 'materialSlot'], ['kind']);
  const kind = value.kind;
  if (kind === 'object') {
    assertPlainObject(value, path, ['kind', 'objectId']);
    return { kind, objectId: identifier(value.objectId, `${path}.objectId`) };
  }
  if (kind === 'template') {
    assertPlainObject(value, path, ['kind', 'targetId', 'materialSlot']);
    const targetId = value.targetId;
    if (typeof targetId !== 'string' || !hasOwn(TEMPLATE_TARGETS, targetId)) {
      invalid(`${path}.targetId`, 'is not an editable template target');
    }
    const target = TEMPLATE_TARGETS[targetId];
    if (value.materialSlot !== target.materialSlot)
      invalid(`${path}.materialSlot`, 'is not registered for this target');
    return { kind, targetId, materialSlot: target.materialSlot };
  }
  invalid(`${path}.kind`, 'must be object or template');
}

function parseOperation(value, path) {
  assertPlainObject(
    value,
    path,
    [
      'op',
      'id',
      'assetId',
      'name',
      'transform',
      'materialId',
      'objectId',
      'patch',
      'camera',
      'target',
    ],
    ['op'],
  );
  switch (value.op) {
    case 'add_object': {
      assertPlainObject(value, path, ['op', 'id', 'assetId', 'name', 'transform', 'materialId']);
      return {
        op: 'add_object',
        object: parseObject(
          {
            id: value.id,
            assetId: value.assetId,
            name: value.name,
            transform: value.transform,
            materialId: value.materialId,
          },
          path,
        ),
      };
    }
    case 'move_object': {
      assertPlainObject(value, path, ['op', 'objectId', 'transform']);
      return {
        op: 'move_object',
        objectId: identifier(value.objectId, `${path}.objectId`),
        transform: parseTransform(value.transform, `${path}.transform`),
      };
    }
    case 'remove_object': {
      assertPlainObject(value, path, ['op', 'objectId']);
      return { op: 'remove_object', objectId: identifier(value.objectId, `${path}.objectId`) };
    }
    case 'set_environment': {
      assertPlainObject(value, path, ['op', 'patch']);
      return {
        op: 'set_environment',
        patch: parseEnvironment(value.patch, `${path}.patch`, { partial: true }),
      };
    }
    case 'set_camera': {
      assertPlainObject(value, path, ['op', 'camera']);
      return { op: 'set_camera', camera: parseCamera(value.camera, `${path}.camera`) };
    }
    case 'set_material': {
      assertPlainObject(value, path, ['op', 'target', 'materialId']);
      const target = parseMaterialTarget(value.target, `${path}.target`);
      if (typeof value.materialId !== 'string' || !hasOwn(MATERIALS, value.materialId)) {
        invalid(`${path}.materialId`, 'is not registered');
      }
      return { op: 'set_material', target, materialId: value.materialId };
    }
    default:
      invalid(`${path}.op`, 'is not an allowlisted operation');
  }
}

export function applyOperations(sceneValue, operationsValue) {
  const original = validateSceneDocument(sceneValue);
  const operationsInput = assertArray(operationsValue, 'operations', SCENE_LIMITS.maxOperations);
  if (operationsInput.length === 0) invalid('operations', 'must contain at least one operation');
  const operations = [];
  for (let index = 0; index < operationsInput.length; index++) {
    operations.push(parseOperation(operationsInput[index], `operations[${index}]`));
  }
  const working = validateSceneDocument(original);

  for (const operation of operations) {
    switch (operation.op) {
      case 'add_object': {
        if (working.objects.some((item) => item.id === operation.object.id)) {
          invalid('operations.add_object.id', 'already exists');
        }
        if (working.objects.length >= SCENE_LIMITS.maxObjects) {
          invalid('operations.add_object', 'would exceed the object limit');
        }
        working.objects.push(operation.object);
        break;
      }
      case 'move_object': {
        const target = working.objects.find((item) => item.id === operation.objectId);
        if (!target)
          invalid('operations.move_object.objectId', 'does not reference a personal object');
        target.transform = operation.transform;
        break;
      }
      case 'remove_object': {
        const index = working.objects.findIndex((item) => item.id === operation.objectId);
        if (index < 0)
          invalid('operations.remove_object.objectId', 'does not reference a personal object');
        working.objects.splice(index, 1);
        break;
      }
      case 'set_environment':
        working.environment = { ...working.environment, ...operation.patch };
        break;
      case 'set_camera':
        working.camera = operation.camera;
        break;
      case 'set_material': {
        if (operation.target.kind === 'object') {
          const target = working.objects.find((item) => item.id === operation.target.objectId);
          if (!target)
            invalid(
              'operations.set_material.target.objectId',
              'does not reference a personal object',
            );
          if (!ASSETS[target.assetId].materialIds.includes(operation.materialId)) {
            invalid(
              'operations.set_material.materialId',
              `is not compatible with ${target.assetId}`,
            );
          }
          target.materialId = operation.materialId;
        } else {
          const registryTarget = TEMPLATE_TARGETS[operation.target.targetId];
          if (!registryTarget.materialIds.includes(operation.materialId)) {
            invalid(
              'operations.set_material.materialId',
              `is not compatible with ${operation.target.targetId}`,
            );
          }
          const existing = working.templateOverrides.findIndex(
            (item) => item.targetId === operation.target.targetId,
          );
          const override = {
            targetId: operation.target.targetId,
            materialSlot: operation.target.materialSlot,
            materialId: operation.materialId,
          };
          if (existing < 0) working.templateOverrides.push(override);
          else working.templateOverrides[existing] = override;
        }
        break;
      }
    }
  }

  return validateSceneDocument(working);
}

function randomDocumentId() {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi?.getRandomValues)
    throw new Error('A secure random source is required to create a scene');
  const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
  return `scene_${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function createDefaultScene(options = {}) {
  assertPlainObject(options, 'options', ['title', 'seed'], []);
  const title = options.title === undefined ? '我的织界空间' : options.title;
  const seed = options.seed === undefined ? 4917 : options.seed;
  const scene = {
    schemaVersion: 1,
    documentId: randomDocumentId(),
    title,
    template: { id: 'official-pavilion-garden', version: '1.0.0' },
    units: 'meters',
    upAxis: '+Y',
    seed,
    registries: {
      templates: 'loom-templates@1',
      materials: 'loom-materials@1',
      assets: 'loom-garden-assets@1',
    },
    templateOverrides: [],
    environment: {
      skyPreset: 'soft-afternoon',
      timeOfDay: 15.5,
      sunIntensity: 1.2,
      ambientIntensity: 0.8,
      doorState: 'closed',
      landscapeVisible: true,
    },
    camera: {
      position: [18, 12, 24],
      target: [0, 1.5, 0],
      fovDegrees: 40,
    },
    objects: [],
  };
  return validateSceneDocument(scene);
}
