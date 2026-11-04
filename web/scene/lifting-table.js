import * as THREE from 'three';

const HEIGHT_RANGE = Object.freeze([0.65, 1]);
const WIDTH_RANGE = Object.freeze([1.4, 3]);
const DEPTH_RANGE = Object.freeze([0.7, 1.4]);
const TOP_THICKNESS = 0.025;
const PAD_THICKNESS = 0.012;
const FOOT_THICKNESS = 0.035;
const COLUMN_OVERLAP = 0.035;

function roundedRectangle(width, depth, radius) {
  const x = width / 2;
  const z = depth / 2;
  const r = Math.min(radius, width * 0.04, depth * 0.08);
  const shape = new THREE.Shape();
  shape.moveTo(-x + r, -z);
  shape.lineTo(x - r, -z);
  shape.quadraticCurveTo(x, -z, x, -z + r);
  shape.lineTo(x, z - r);
  shape.quadraticCurveTo(x, z, x - r, z);
  shape.lineTo(-x + r, z);
  shape.quadraticCurveTo(-x, z, -x, z - r);
  shape.lineTo(-x, -z + r);
  shape.quadraticCurveTo(-x, -z, -x + r, -z);
  return shape;
}

function makeMaterial(name, options) {
  const material = new THREE.MeshStandardMaterial(options);
  material.name = name;
  return material;
}

/** Build a static, native-geometry white screw-locking lift table. */
export function createLiftingTable({
  width = 2.4,
  depth = 1.05,
  height = 0.82,
  floorY = 0.13,
} = {}) {
  if (!Number.isFinite(width) || width < WIDTH_RANGE[0] || width > WIDTH_RANGE[1])
    throw new TypeError('Lifting table width must be finite and between 1.4 and 3 metres');
  if (!Number.isFinite(depth) || depth < DEPTH_RANGE[0] || depth > DEPTH_RANGE[1])
    throw new TypeError('Lifting table depth must be finite and between 0.7 and 1.4 metres');
  if (!Number.isFinite(height) || height < HEIGHT_RANGE[0] || height > HEIGHT_RANGE[1])
    throw new TypeError('Lifting table height must be finite and between 0.65 and 1 metre');
  if (!Number.isFinite(floorY)) throw new TypeError('Lifting table floorY must be finite');

  const group = new THREE.Group();
  group.name = '白色手动升降长桌';
  group.userData = {
    storeTable: true,
    tableType: 'manual-lifting-table',
    footprint: [width, depth],
    height,
    heightAboveFloor: height,
    heightRange: [...HEIGHT_RANGE],
    floorY,
    rigidPlan: true,
    staticModel: true,
    liftMechanism: 'screw-lock',
  };

  const carrier = new THREE.Group();
  carrier.name = '升降桌面承载组';
  carrier.position.y = floorY + height;
  carrier.userData = { tabletopCarrier: true, tabletopSurfaceY: 0, devicePlacementSurface: true };
  group.add(carrier);

  const tabletopMaterial = makeMaterial('白色哑光桌面', { color: 0xf3f3f0, roughness: 0.72 });
  const frameMaterial = makeMaterial('白色粉末涂层钢架', {
    color: 0xe8e9e7,
    metalness: 0.24,
    roughness: 0.43,
  });
  const innerColumnMaterial = makeMaterial('白色升降内柱', {
    color: 0xf1f1ee,
    metalness: 0.2,
    roughness: 0.4,
  });
  const lockMaterial = makeMaterial('黑色手动锁定件', {
    color: 0x202224,
    metalness: 0.12,
    roughness: 0.62,
  });
  const padMaterial = makeMaterial('深灰防滑地垫', { color: 0x333536, roughness: 0.95 });

  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  function box(parent, name, x, y, z, sx, sy, sz, material, metadata = {}) {
    const mesh = new THREE.Mesh(unitBox, material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sz);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    Object.assign(mesh.userData, metadata);
    parent.add(mesh);
    return mesh;
  }

  function cylinder(parent, name, x, y, z, radius, length, material, axis, metadata = {}) {
    const geometry = new THREE.CylinderGeometry(radius, radius, length, 12, 1);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(x, y, z);
    if (axis === 'x') mesh.rotation.z = Math.PI / 2;
    if (axis === 'z') mesh.rotation.x = Math.PI / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    Object.assign(mesh.userData, metadata);
    parent.add(mesh);
    return mesh;
  }

  // Extrusion is rotated into the XZ plane and runs downward from the exact
  // device-placement plane at local y=0.
  const bevel = 0.0015;
  const topGeometry = new THREE.ExtrudeGeometry(
    roundedRectangle(width - 2 * bevel, depth - 2 * bevel, 0.025 - bevel),
    {
      depth: TOP_THICKNESS - 2 * bevel,
      bevelEnabled: true,
      bevelSize: bevel,
      bevelThickness: bevel,
      bevelSegments: 1,
      curveSegments: 4,
      steps: 1,
    },
  );
  topGeometry.translate(0, 0, bevel);
  const top = new THREE.Mesh(topGeometry, tabletopMaterial);
  top.name = '白色圆角长方桌面';
  top.rotation.x = Math.PI / 2;
  top.userData = { tabletop: true, tabletopTopLocalY: 0, thickness: TOP_THICKNESS };
  top.castShadow = true;
  top.receiveShadow = true;
  carrier.add(top);

  const halfWidth = width / 2;
  const halfDepth = depth / 2;
  const columnX = halfWidth - 0.19;
  const columnZ = halfDepth - 0.22;
  const outerColumnWidth = 0.085;
  const innerColumnWidth = 0.059;
  const baseY = -height + PAD_THICKNESS + FOOT_THICKNESS;
  const topY = -TOP_THICKNESS;
  const availableColumnHeight = topY - baseY;
  const lowerLength = availableColumnHeight * 0.53 + COLUMN_OVERLAP / 2;
  const jointY = baseY + lowerLength;
  const lowerTop = jointY + COLUMN_OVERLAP / 2;
  const upperBottom = jointY - COLUMN_OVERLAP / 2;

  for (const [supportIndex, side] of [-1, 1].entries()) {
    const supportId = side < 0 ? 'left-end' : 'right-end';
    const supportX = side * columnX;
    const footDepth = depth - 0.15;
    const footWidth = 0.12;
    box(
      carrier,
      supportId + ' · 纵深承重底脚',
      supportX,
      -height + PAD_THICKNESS + FOOT_THICKNESS / 2,
      0,
      footWidth,
      FOOT_THICKNESS,
      footDepth,
      frameMaterial,
      { tableFoot: true, support: true, supportId, foot: true },
    );

    for (const [padIndex, direction] of [-1, 1].entries()) {
      const padZ = direction * (halfDepth - 0.115);
      box(
        carrier,
        supportId + ' · 落地防滑垫 ' + (padIndex + 1),
        supportX,
        -height + PAD_THICKNESS / 2,
        padZ,
        0.105,
        PAD_THICKNESS,
        0.065,
        padMaterial,
        { floorContact: true, tableFoot: true, support: true, supportId, pad: true },
      );
    }

    // A single shallow cross rail ties each pair of columns into an end frame.
    box(
      carrier,
      supportId + ' · 桌下横向承载梁',
      supportX,
      -TOP_THICKNESS - 0.034,
      0,
      0.09,
      0.05,
      depth - 0.34,
      frameMaterial,
      { support: true, supportId, endCrossbar: true },
    );

    for (const [columnIndex, direction] of [-1, 1].entries()) {
      const columnId = supportId + (direction < 0 ? '-rear' : '-front');
      const z = direction * columnZ;
      const lowerCenterY = (baseY + lowerTop) / 2;
      const upperCenterY = (upperBottom + topY) / 2;
      const lower = box(
        carrier,
        columnId + ' · 外套管',
        supportX,
        lowerCenterY,
        z,
        outerColumnWidth,
        lowerTop - baseY,
        outerColumnWidth,
        frameMaterial,
        {
          support: true,
          telescopicSegment: true,
          supportId,
          columnId,
          column: columnIndex + 1,
          stage: 1,
          lowerY: baseY,
          upperY: lowerTop,
        },
      );
      lower.castShadow = true;
      box(
        carrier,
        columnId + ' · 内节升降柱',
        supportX,
        upperCenterY,
        z,
        innerColumnWidth,
        topY - upperBottom,
        innerColumnWidth,
        innerColumnMaterial,
        {
          support: true,
          telescopicSegment: true,
          supportId,
          columnId,
          column: columnIndex + 1,
          stage: 2,
          lowerY: upperBottom,
          upperY: topY,
        },
      );

      // The dark compression collar and side screw denote the manual fixing
      // point; they are duplicated once per independent load-bearing column.
      box(
        carrier,
        columnId + ' · 黑色锁紧箍',
        supportX,
        jointY,
        z,
        outerColumnWidth + 0.012,
        0.014,
        outerColumnWidth + 0.012,
        lockMaterial,
        { manualLock: true, support: true, supportId, columnId, lockPart: 'collar' },
      );
      cylinder(
        carrier,
        columnId + ' · 外向手拧螺杆',
        supportX + side * (outerColumnWidth / 2 + 0.012),
        jointY,
        z,
        0.014,
        0.025,
        lockMaterial,
        'x',
        { manualLock: true, support: true, supportId, columnId, lockPart: 'hand-screw' },
      );
      cylinder(
        carrier,
        columnId + ' · 手拧旋钮端面',
        supportX + side * (outerColumnWidth / 2 + 0.027),
        jointY,
        z,
        0.012,
        0.008,
        lockMaterial,
        'x',
        { manualLock: true, support: true, supportId, columnId, lockPart: 'knob' },
      );

      // Small dark circular marks on the front face read as locating holes.
      for (let hole = 0; hole < 5; hole++) {
        const holeY = baseY + 0.075 + hole * 0.043;
        cylinder(
          carrier,
          columnId + ' · 高度定位孔 ' + (hole + 1),
          supportX,
          holeY,
          z + outerColumnWidth / 2 + 0.001,
          0.0045,
          0.0025,
          lockMaterial,
          'z',
          {
            heightHole: true,
            support: true,
            supportId,
            columnId,
            hole: hole + 1,
          },
        );
      }

      // A white triangular gusset sits directly under each end crossbar.
      const braceShape = new THREE.Shape();
      braceShape.moveTo(-0.075, 0);
      braceShape.lineTo(0.075, 0);
      braceShape.lineTo(0.075, -0.105);
      braceShape.closePath();
      const braceGeometry = new THREE.ExtrudeGeometry(braceShape, {
        depth: 0.008,
        bevelEnabled: false,
        steps: 1,
      });
      const brace = new THREE.Mesh(braceGeometry, frameMaterial);
      brace.name = columnId + ' · 桌下三角加强片';
      brace.position.set(supportX - 0.075, -TOP_THICKNESS - 0.058, z - 0.004);
      brace.castShadow = true;
      brace.receiveShadow = true;
      brace.userData = { support: true, supportId, columnId, triangularBrace: true };
      carrier.add(brace);
    }
  }

  return group;
}
