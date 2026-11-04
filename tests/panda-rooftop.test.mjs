import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

const vendorUrl = new URL('../web/vendor/', import.meta.url).href;
const loaderSource = `
  const vendor = ${JSON.stringify(vendorUrl)};
  export async function resolve(specifier, context, nextResolve) {
    if (specifier === 'three') return { url: new URL('three.module.js', vendor).href, shortCircuit: true };
    if (specifier.startsWith('three/addons/')) return {
      url: new URL(specifier.slice('three/'.length), vendor).href,
      shortCircuit: true,
    };
    return nextResolve(specifier, context);
  }
`;
register(`data:text/javascript,${encodeURIComponent(loaderSource)}`, import.meta.url);

const THREE = await import('three');
const { createRooftopPanda } = await import('../web/scene/panda-rooftop.js');
const { createFacetedPanda } = await import('../web/scene/panda-faceted.js');
const { createPavilion } = await import('../web/scene/model.js');
const { bendPoint } = await import('../web/scene/site-layout.js');
const { GLASS_ROOM, PAVILION, LOUVER } = await import('../web/scene/pavilion-dimensions.js');

function canvasContext() {
  return {
    createImageData(width, height) {
      return { data: new Uint8ClampedArray(width * height * 4) };
    },
    putImageData() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    ellipse() {},
    fill() {},
  };
}

globalThis.document = {
  createElement(name) {
    assert.equal(name, 'canvas');
    const context = canvasContext();
    return { width: 0, height: 0, getContext: () => context };
  },
};

function dispose(root) {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  root.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material)
      ? object.material || []
      : [object.material]) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
}

function along(vector, direction) {
  return vector.dot(direction);
}

function segmentWorldLength(panda, part) {
  return (
    new THREE.Vector3(...part.userData.limbStart).distanceTo(
      new THREE.Vector3(...part.userData.limbEnd),
    ) * panda.scale.x
  );
}

test('rump tilts slightly upward and outward without moving the head or separating belly details', () => {
  const panda = createRooftopPanda({
    eavePosition: new THREE.Vector3(0, 4.615, 0),
    outwardDirection: new THREE.Vector3(0, 0, 1),
  });
  const original = createFacetedPanda();
  try {
    panda.updateMatrixWorld(true);
    original.updateMatrixWorld(true);
    const tail = panda.getObjectByName('tail').position;
    const originalTail = original.getObjectByName('tail').position;
    assert.ok(
      tail.y - originalTail.y > 0.25 && tail.y - originalTail.y < 0.4,
      'tail base rises subtly with the rump, not just a rotated tail',
    );
    assert.ok(
      originalTail.z - tail.z > 0.2 && originalTail.z - tail.z < 0.3,
      'rump projects a little farther outside',
    );
    const torso = panda.getObjectByName('torso');
    assert.ok(torso.rotation.x > 0.15 && torso.rotation.x < 0.25, 'body pitch remains restrained');
    const transforms = ['torso', 'belly', 'tail', 'loom-emblem'].map((name) => {
      const before = original.getObjectByName(name);
      const after = panda.getObjectByName(name);
      return after.matrix.clone().multiply(before.matrix.clone().invert());
    });
    for (const transform of transforms)
      transform.elements.forEach((value, i) =>
        assert.ok(
          Math.abs(value - transforms[0].elements[i]) < 1e-6,
          'body, white belly, emblem and tail share one rigid pose',
        ),
      );
    assert.deepEqual(
      panda.getObjectByName('head').matrix.toArray(),
      original.getObjectByName('head').matrix.toArray(),
      'head remains fixed at its existing roof clearance',
    );
  } finally {
    dispose(panda);
    dispose(original);
  }
});

test('rooftop panda grips the eave with its head above and body outside', () => {
  const eave = new THREE.Vector3(8, 4.615, 0.8);
  const outward = new THREE.Vector3(0.71, 0, 0.704).normalize();
  const panda = createRooftopPanda({ eavePosition: eave, outwardDirection: outward });
  try {
    panda.updateMatrixWorld(true);
    const headBounds = new THREE.Box3().setFromObject(panda.getObjectByName('head'));
    const head = headBounds.getCenter(new THREE.Vector3());
    const torso = panda.getObjectByName('torso').getWorldPosition(new THREE.Vector3());
    const tail = panda.getObjectByName('tail').getWorldPosition(new THREE.Vector3());
    const localForward = new THREE.Vector3(0, 0, 1).transformDirection(panda.matrixWorld);
    const inward = outward.clone().negate();
    const headAboveEave = head.y - eave.y;
    const bodyOutside = along(torso.clone().sub(eave), outward);
    const tailOutside = along(tail.clone().sub(eave), outward);
    assert.ok(headAboveEave >= 0.5, `head should rise above eave, got ${headAboveEave}`);
    assert.ok(headBounds.max.y > eave.y + 1, 'head silhouette should clearly rise above the eave');
    assert.ok(bodyOutside > 0.9, `torso should hang outside eave, got ${bodyOutside}`);
    assert.ok(
      tailOutside > bodyOutside + 0.6,
      'back/tail should face farther outside than the torso',
    );
    assert.ok(
      along(localForward, outward) < -0.99,
      'panda local +Z must face inward toward the roof',
    );
    const nose = panda.getObjectByName('nose').getWorldPosition(new THREE.Vector3());
    const muzzleFacing = nose.sub(head).normalize();
    assert.ok(along(muzzleFacing, inward) > 0.9, 'eyes and muzzle should face toward the roof');

    for (const side of ['left', 'right']) {
      const paw = panda.getObjectByName(`paw-${side}`).getWorldPosition(new THREE.Vector3());
      const pawOutside = along(paw.clone().sub(eave), outward);
      assert.ok(
        Math.abs(pawOutside - 0.12) < 0.02,
        `${side} paw should straddle eave: ${pawOutside}`,
      );
      assert.ok(Math.abs(paw.y - (eave.y + 0.185)) < 0.02, `${side} paw should rest above roof`);
      const armBounds = new THREE.Box3().setFromObject(panda.getObjectByName(`arm-${side}`));
      const forearm = panda.getObjectByName(`forearm-${side}`);
      const elbow = panda.getObjectByName(`elbow-${side}`);
      const pawBounds = new THREE.Box3().setFromObject(panda.getObjectByName(`paw-${side}`));
      assert.ok(armBounds.intersectsBox(pawBounds), `${side} arm should connect to its paw`);
      assert.ok(
        new THREE.Box3().setFromObject(forearm).intersectsBox(pawBounds),
        `${side} forearm should meet the gripping paw`,
      );
      assert.ok(
        armBounds.intersectsBox(new THREE.Box3().setFromObject(elbow)) &&
          new THREE.Box3()
            .setFromObject(forearm)
            .intersectsBox(new THREE.Box3().setFromObject(elbow)),
        `${side} upper and lower arm should meet at a real elbow mesh`,
      );
    }
    assert.equal(panda.userData.rooftopPose, 'eave-climber');
  } finally {
    dispose(panda);
  }
});

test('climbing limbs use short bent segments with real elbow and knee joints', () => {
  const panda = createRooftopPanda({
    eavePosition: new THREE.Vector3(0, 4.615, 0),
    outwardDirection: new THREE.Vector3(0, 0, 1),
  });
  try {
    panda.updateMatrixWorld(true);
    for (const side of ['left', 'right']) {
      const arm = panda.getObjectByName(`arm-${side}`);
      const forearm = panda.getObjectByName(`forearm-${side}`);
      const elbow = panda.getObjectByName(`elbow-${side}`);
      const leg = panda.getObjectByName(`leg-${side}`);
      const shin = panda.getObjectByName(`shin-${side}`);
      const knee = panda.getObjectByName(`knee-${side}`);
      for (const part of [arm, forearm, elbow, leg, shin, knee]) {
        assert.ok(part?.isMesh, `${side} limb part should be a real mesh`);
        assert.equal(part.material.flatShading, true, `${part.name} stays faceted`);
        assert.equal(part.material.vertexColors, true, `${part.name} retains vertex colors`);
      }
      assert.ok(arm.userData.limbStart && arm.userData.limbEnd);
      assert.ok(forearm.userData.limbStart && forearm.userData.limbEnd);
      assert.ok(leg.userData.limbStart && leg.userData.limbEnd);
      assert.ok(shin.userData.limbStart && shin.userData.limbEnd);
      const armLength = new THREE.Vector3(...arm.userData.limbStart).distanceTo(
        new THREE.Vector3(...arm.userData.limbEnd),
      );
      const forearmLength = new THREE.Vector3(...forearm.userData.limbStart).distanceTo(
        new THREE.Vector3(...forearm.userData.limbEnd),
      );
      assert.ok(armLength < 0.9 && forearmLength < 0.9, 'forelimb segments remain short');
      assert.ok(segmentWorldLength(panda, leg) < 0.95, 'thigh remains short');
      assert.ok(segmentWorldLength(panda, shin) < 0.95, 'shin remains short');
      const directions = (upper, lower) =>
        [upper, lower].map((part) =>
          new THREE.Vector3(0, 1, 0).transformDirection(part.matrixWorld),
        );
      const [upperArm, lowerArm] = directions(arm, forearm);
      const [thigh, lowerLeg] = directions(leg, shin);
      assert.ok(upperArm.angleTo(lowerArm) > 0.3, `${side} elbow forms a visible bend`);
      assert.ok(thigh.angleTo(lowerLeg) > 0.2, `${side} knee forms a visible bend`);
      assert.ok(
        new THREE.Box3().setFromObject(arm).intersectsBox(new THREE.Box3().setFromObject(elbow)),
      );
      assert.ok(
        new THREE.Box3()
          .setFromObject(forearm)
          .intersectsBox(new THREE.Box3().setFromObject(elbow)),
      );
      assert.ok(
        new THREE.Box3().setFromObject(leg).intersectsBox(new THREE.Box3().setFromObject(knee)),
      );
      assert.ok(
        new THREE.Box3().setFromObject(shin).intersectsBox(new THREE.Box3().setFromObject(knee)),
      );
    }
  } finally {
    dispose(panda);
  }
});

test('rooftop face orientation follows arbitrary bent eave directions', () => {
  for (const direction of [new THREE.Vector3(-0.42, 0, 0.907), new THREE.Vector3(0.86, 2, -0.51)]) {
    const originalDirection = direction.clone();
    const outward = direction.clone().setY(0).normalize();
    const eave = new THREE.Vector3(4, 4.615, -3);
    const panda = createRooftopPanda({
      eavePosition: eave,
      outwardDirection: direction,
    });
    try {
      panda.updateMatrixWorld(true);
      const localForward = new THREE.Vector3(0, 0, 1).transformDirection(panda.matrixWorld);
      assert.ok(along(localForward, outward) < -0.99);
      assert.deepEqual(
        direction,
        originalDirection,
        'posing must not mutate the supplied direction',
      );
      for (const side of ['left', 'right']) {
        const paw = panda.getObjectByName(`paw-${side}`).getWorldPosition(new THREE.Vector3());
        assert.ok(Math.abs(along(paw.sub(eave), outward) - 0.12) < 1e-6);
      }
    } finally {
      dispose(panda);
    }
  }
});

test('rooftop poses require usable eave data and create independent panda resources', () => {
  assert.throws(
    () =>
      createRooftopPanda({ eavePosition: [0, 0, 0], outwardDirection: new THREE.Vector3(0, 0, 1) }),
    /must be THREE.Vector3 values/,
  );
  assert.throws(
    () =>
      createRooftopPanda({
        eavePosition: new THREE.Vector3(),
        outwardDirection: new THREE.Vector3(),
      }),
    /horizontal direction/,
  );
  assert.throws(
    () =>
      createRooftopPanda({
        eavePosition: new THREE.Vector3(Number.NaN, 0, 0),
        outwardDirection: new THREE.Vector3(0, 0, 1),
      }),
    /components must be finite/,
  );

  const position = new THREE.Vector3(1, 4.615, -2);
  const outward = new THREE.Vector3(0, 0, -1);
  const first = createRooftopPanda({ eavePosition: position, outwardDirection: outward });
  const second = createRooftopPanda({ eavePosition: position, outwardDirection: outward });
  try {
    assert.notEqual(first, second);
    assert.notEqual(
      first.getObjectByName('head').geometry,
      second.getObjectByName('head').geometry,
    );
    assert.notEqual(
      first.getObjectByName('head').material,
      second.getObjectByName('head').material,
    );
    assert.equal(first.name, 'LoomOS Rooftop Panda');
  } finally {
    dispose(first);
    dispose(second);
  }
});

test('pavilion contains only the static rooftop panda, with no ground-level duplicate', () => {
  const model = createPavilion();
  try {
    model.root.updateMatrixWorld(true);
    const rooftopPanda = model.root.getObjectByName('LoomOS Rooftop Panda');
    assert.ok(rooftopPanda);
    assert.equal(rooftopPanda.parent, model.root);
    assert.equal(model.panda.parent, model.root);
    assert.equal(model.panda, rooftopPanda);
    assert.equal(model.root.getObjectByName('LoomOS Panda'), undefined);
    const pandas = [];
    model.root.traverse((object) => {
      if (object.userData.rooftopPose || object.name === 'LoomOS Panda') pandas.push(object);
    });
    assert.deepEqual(pandas, [rooftopPanda]);
    assert.equal(rooftopPanda.userData.rooftopPose, 'eave-climber');
    const screenMid = LOUVER.centerX;
    const expectedEave = bendPoint(
      new THREE.Vector3(screenMid, PAVILION.roofTop, GLASS_ROOM.width / 2 + 0.4),
    );
    assert.ok(
      new THREE.Vector3(...rooftopPanda.userData.rooftopEavePosition).distanceTo(expectedEave) <
        1e-6,
      'panda must sit over the left louver column instead of the former open bay',
    );
    assert.equal(rooftopPanda.userData.rooftopFootSupport, '视频起点侧白色栅格立面');
    const outward = new THREE.Vector3(...rooftopPanda.userData.rooftopOutwardDirection);
    const forward = new THREE.Vector3(0, 0, 1).transformDirection(rooftopPanda.matrixWorld);
    assert.ok(along(forward, outward) < -0.99, 'integrated model must face in toward the roof');
    const torso = rooftopPanda.getObjectByName('torso').getWorldPosition(new THREE.Vector3());
    const tail = rooftopPanda.getObjectByName('tail').getWorldPosition(new THREE.Vector3());
    assert.ok(
      tail.sub(torso).dot(outward) > 0.6,
      'integrated model must expose its back and rump outside',
    );

    const roofTop = model.building.getObjectByName('屋面顶板与金属压边');
    const roofBounds = new THREE.Box3().setFromObject(roofTop);
    const eave = new THREE.Vector3(...rooftopPanda.userData.rooftopEavePosition);
    const roofRay = new THREE.Raycaster();
    const support = model.building.getObjectByName('视频起点侧白色栅格立面');
    const blades = support.children.filter((object) => object.name === '白色水平栅格片');
    for (const side of ['left', 'right']) {
      const paw = rooftopPanda.getObjectByName(`paw-${side}`);
      const pawBounds = new THREE.Box3().setFromObject(paw);
      const pawCenter = paw.getWorldPosition(new THREE.Vector3());
      assert.ok(
        pawBounds.intersectsBox(roofBounds),
        `${side} paw should overlap the actual roof bounds`,
      );
      assert.ok(
        along(pawCenter.clone().sub(eave), outward) > 0,
        `${side} paw should be outside the eave`,
      );

      const insidePaw = pawCenter.clone().addScaledVector(outward, -0.2);
      insidePaw.y = roofBounds.max.y + 0.2;
      roofRay.set(insidePaw, new THREE.Vector3(0, -1, 0));
      roofRay.far = 1;
      assert.ok(
        roofRay.intersectObject(roofTop, false).length > 0,
        `${side} paw should reach roof top`,
      );

      const foot = rooftopPanda.getObjectByName(`foot-${side}`);
      foot.geometry.computeBoundingBox();
      const vertices = foot.geometry.getAttribute('position');
      const normals = foot.geometry.getAttribute('normal');
      let soleVertices = 0;
      for (let i = 0; i < vertices.count; i++) {
        if (Math.abs(vertices.getY(i) - foot.geometry.boundingBox.min.y) < 1e-6) soleVertices++;
        const length = new THREE.Vector3().fromBufferAttribute(normals, i).length();
        assert.ok(Math.abs(length - 1) < 1e-5, 'flattening keeps valid unit face normals');
      }
      assert.ok(
        soleVertices > 100,
        `${side} foot has a broad planar sole, not a single contact vertex`,
      );
      const sole = foot.localToWorld(new THREE.Vector3(0, foot.geometry.boundingBox.min.y, 0));
      const soleNormal = new THREE.Vector3(0, -1, 0).applyNormalMatrix(
        new THREE.Matrix3().getNormalMatrix(foot.matrixWorld),
      );
      const probe = new THREE.Raycaster(
        sole.clone().addScaledVector(soleNormal, -0.2),
        soleNormal,
        0,
        0.3,
      );
      const hit = probe.intersectObjects(blades, false)[0];
      assert.ok(hit, `${side} sole must hit an actual louver blade`);
      assert.ok(
        sole.distanceTo(hit.point) < 0.004,
        `${side} foot cannot float away from the column`,
      );
      const normal = hit.face.normal
        .clone()
        .applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(hit.object.matrixWorld));
      assert.ok(
        soleNormal.dot(normal) < -0.999,
        `${side} sole must face the facade, not hang downward`,
      );
      const legBounds = new THREE.Box3().setFromObject(rooftopPanda.getObjectByName(`leg-${side}`));
      const shin = rooftopPanda.getObjectByName(`shin-${side}`);
      const knee = rooftopPanda.getObjectByName(`knee-${side}`);
      const shinBounds = new THREE.Box3().setFromObject(shin);
      const kneeBounds = new THREE.Box3().setFromObject(knee);
      assert.ok(
        shinBounds.intersectsBox(new THREE.Box3().setFromObject(foot)),
        `${side} lower leg connects to foot`,
      );
      assert.ok(
        legBounds.intersectsBox(kneeBounds) && shinBounds.intersectsBox(kneeBounds),
        `${side} thigh and lower leg meet at a real knee mesh`,
      );
      assert.ok(
        legBounds.intersectsBox(
          new THREE.Box3().setFromObject(rooftopPanda.getObjectByName('torso')),
        ),
        `${side} hip connects to body`,
      );
      const upperDirection = new THREE.Vector3(0, 1, 0).transformDirection(
        rooftopPanda.getObjectByName(`leg-${side}`).matrixWorld,
      );
      const lowerDirection = new THREE.Vector3(0, 1, 0).transformDirection(shin.matrixWorld);
      assert.ok(
        segmentWorldLength(rooftopPanda, rooftopPanda.getObjectByName(`leg-${side}`)) < 0.95 &&
          segmentWorldLength(rooftopPanda, shin) < 0.95,
        `${side} integrated thigh and shin stay short`,
      );
      assert.ok(
        upperDirection.angleTo(lowerDirection) > 0.2,
        `${side} thigh and shin should form a visibly bent climbing pose`,
      );
      for (let i = 0; i < 2; i++)
        assert.equal(
          rooftopPanda.getObjectByName(`toe-${side}-${i}`).parent,
          foot,
          'toe marks move with the foot',
        );
    }
  } finally {
    dispose(model.root);
  }
});
