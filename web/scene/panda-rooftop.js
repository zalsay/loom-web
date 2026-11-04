import * as THREE from 'three';
import { createFacetedPanda } from './panda-faceted.js';
import { disposePanda } from './panda/model.js';

const CLIMBER_SCALE = 0.8;
const BODY_OUTSIDE_OFFSET = 0.88;
const HEAD_LOCAL_Y = 3.04;
const HEAD_CLEARANCE = 0.62;
const PAW_LOCAL_X = 1.48;
const PAW_OUTSIDE_OFFSET = 0.12;
const PAW_ABOVE_EAVE = 0.185;
const RUMP_PITCH = Math.PI / 15;
const RUMP_PIVOT_Y = 2.05;
const RUMP_LIFT = 0.08;

function makeFacetedPart(panda, template, name) {
  const part = new THREE.Mesh(template.geometry, template.material);
  part.name = name;
  part.castShadow = template.castShadow;
  part.receiveShadow = template.receiveShadow;
  panda.add(part);
  return part;
}

function placeLimbSegment(mesh, start, end, radiusX, radiusZ, padding = 0.035) {
  const direction = end.clone().sub(start);
  const length = direction.length();
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  mesh.scale.set(radiusX, length / 2 + padding, radiusZ);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  mesh.userData.limbStart = start.toArray();
  mesh.userData.limbEnd = end.toArray();
}

function raiseRump(panda) {
  // Pitch the body gently around the upper torso, not the whole sculpture: the
  // rump/tail rise and move outward while the head and four contact points stay put.
  const pose = new THREE.Matrix4()
    .makeTranslation(0, RUMP_PIVOT_Y + RUMP_LIFT, 0)
    .multiply(new THREE.Matrix4().makeRotationX(RUMP_PITCH))
    .multiply(new THREE.Matrix4().makeTranslation(0, -RUMP_PIVOT_Y, 0));
  for (const name of ['torso', 'belly', 'tail', 'loom-emblem'])
    panda.getObjectByName(name).applyMatrix4(pose);
  return pose;
}

function poseHindLeg(panda, side, sign, bodyPose, ankle) {
  const thigh = panda.getObjectByName(`leg-${side}`);
  const shin = panda.getObjectByName(`shin-${side}`);
  const knee = panda.getObjectByName(`knee-${side}`);
  const hip = new THREE.Vector3(sign * 0.56, 0.91, 0.4).applyMatrix4(bodyPose);
  const kneePoint = hip
    .clone()
    .lerp(ankle, 0.5)
    .add(new THREE.Vector3(0, 0.3, 0.1));
  placeLimbSegment(thigh, hip, kneePoint, 0.34, 0.38, 0.055);
  placeLimbSegment(shin, kneePoint, ankle, 0.3, 0.35, 0.055);
  knee.position.copy(kneePoint);
  knee.scale.set(0.285, 0.28, 0.3);
}

function braceFeet(panda, support, scale, bodyPose) {
  support.updateWorldMatrix(true, true);
  panda.updateMatrixWorld(true);
  const surfaces = [];
  support.traverse((object) => {
    if (object.isMesh && object.name === '白色水平栅格片') surfaces.push(object);
  });
  if (!surfaces.length) throw new TypeError('footSupport must contain horizontal louver blades');
  const inverseRotation = panda.quaternion.clone().invert();
  const inward = new THREE.Vector3(0, 0, 1).applyQuaternion(panda.quaternion);
  const ray = new THREE.Raycaster();
  const contacts = [];
  for (const sign of [-1, 1]) {
    const side = sign < 0 ? 'left' : 'right';
    const desired = panda.localToWorld(new THREE.Vector3(sign * 0.62, sign < 0 ? 0.48 : 0.6, 0));
    const blade = surfaces.reduce((nearest, candidate) => {
      const center = new THREE.Box3().setFromObject(candidate).getCenter(new THREE.Vector3());
      const gap = Math.abs(center.y - desired.y);
      return !nearest || gap < nearest.gap ? { mesh: candidate, y: center.y, gap } : nearest;
    }, null);
    desired.y = blade.y;
    ray.set(desired, inward);
    ray.far = 3 * scale;
    const hit = ray.intersectObject(blade.mesh, false)[0];
    if (!hit) throw new TypeError(`${side} foot cannot reach its louver support`);
    const normal = hit.face.normal
      .clone()
      .applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(blade.mesh.matrixWorld));
    contacts.push({ side, sign, point: hit.point, normal });
  }
  // Establish both real contact points before changing the pose. The sole faces
  // the facade, toes point upward and the knees reach forward instead of dangling.
  for (const { side, sign, point, normal } of contacts) {
    const foot = panda.getObjectByName(`foot-${side}`);
    for (let i = 0; i < 2; i++) foot.attach(panda.getObjectByName(`toe-${side}-${i}`));
    foot.scale.z = 0.48;
    // A broad, flattened sole reads as weight against the column rather than a
    // round foot touching it at just one point. Keep the existing faceted shell.
    const vertices = foot.geometry.getAttribute('position');
    for (let i = 0; i < vertices.count; i++) vertices.setY(i, Math.max(vertices.getY(i), -0.6));
    vertices.needsUpdate = true;
    foot.geometry.computeVertexNormals();
    foot.geometry.computeBoundingSphere();
    const intoSupport = normal.clone().negate().applyQuaternion(inverseRotation);
    foot.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), intoSupport);
    foot.geometry.computeBoundingBox();
    const sole = new THREE.Vector3(
      0,
      foot.geometry.boundingBox.min.y * foot.scale.y,
      0,
    ).applyQuaternion(foot.quaternion);
    const contact = panda.worldToLocal(point.clone());
    foot.position.copy(contact).sub(sole).addScaledVector(intoSupport, 0.002);
    poseHindLeg(panda, side, sign, bodyPose, foot.position.clone());
    foot.userData.supportContact = point.toArray();
    foot.userData.supportNormal = normal.toArray();
  }
  panda.userData.rooftopFootSupport = support.name;
}

/**
 * Pose an independent LoomOS panda on a roof edge, facing the roof with its
 * forepaws gripping the eave, back outside and hind feet braced on a louver facade.
 */
export function createRooftopPanda({
  eavePosition,
  outwardDirection,
  footSupport,
  scale = CLIMBER_SCALE,
}) {
  if (!eavePosition?.isVector3 || !outwardDirection?.isVector3) {
    throw new TypeError('eavePosition and outwardDirection must be THREE.Vector3 values');
  }
  if (![...eavePosition.toArray(), ...outwardDirection.toArray()].every(Number.isFinite)) {
    throw new TypeError('eave and outward direction components must be finite');
  }
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new TypeError('scale must be a positive finite number');
  }
  if (footSupport !== undefined && !footSupport?.isObject3D) {
    throw new TypeError('footSupport must be a THREE.Object3D');
  }

  const outward = outwardDirection.clone().setY(0);
  if (!Number.isFinite(outward.lengthSq()) || outward.lengthSq() < 1e-8) {
    throw new TypeError('outwardDirection must have a horizontal direction');
  }
  outward.normalize();
  const inward = outward.clone().negate();

  const panda = createFacetedPanda();
  panda.name = 'LoomOS Rooftop Panda';
  panda.scale.setScalar(scale);
  panda.position.copy(eavePosition).addScaledVector(outward, BODY_OUTSIDE_OFFSET);
  panda.position.y = eavePosition.y + HEAD_CLEARANCE - HEAD_LOCAL_Y * scale;
  // Local +Z is the face/belly side. The tail and rump (-Z) must face the street,
  // while both forepaws reach forward (+Z) onto the roof, as on the IFS climber.
  panda.rotation.y = Math.atan2(inward.x, inward.z);
  panda.userData.rooftopPose = 'eave-climber';
  panda.userData.rooftopEavePosition = eavePosition.toArray();
  panda.userData.rooftopOutwardDirection = outward.toArray();
  const gripHeight = (eavePosition.y + PAW_ABOVE_EAVE - panda.position.y) / scale;
  const gripForward = (BODY_OUTSIDE_OFFSET - PAW_OUTSIDE_OFFSET) / scale;

  const bodyPose = raiseRump(panda);
  for (const sign of [-1, 1]) {
    const side = sign < 0 ? 'left' : 'right';
    const arm = panda.getObjectByName(`arm-${side}`);
    const paw = panda.getObjectByName(`paw-${side}`);
    const forearm = makeFacetedPart(panda, arm, `forearm-${side}`);
    const elbow = makeFacetedPart(panda, arm, `elbow-${side}`);
    paw.position.set(sign * PAW_LOCAL_X, gripHeight, gripForward);

    const shoulder = new THREE.Vector3(sign * 0.86, 1.88, 0.18).applyMatrix4(bodyPose);
    const elbowPoint = new THREE.Vector3(sign * 1.32, 2.2, 0.45).applyMatrix4(bodyPose);
    const wrist = paw.position.clone().add(new THREE.Vector3(-sign * 0.06, -0.18, 0.02));
    placeLimbSegment(arm, shoulder, elbowPoint, 0.285, 0.34, 0.045);
    placeLimbSegment(forearm, elbowPoint, wrist, 0.27, 0.32, 0.045);
    elbow.position.copy(elbowPoint);
    elbow.scale.set(0.255, 0.255, 0.27);
  }

  for (const sign of [-1, 1]) {
    const side = sign < 0 ? 'left' : 'right';
    const leg = panda.getObjectByName(`leg-${side}`);
    makeFacetedPart(panda, leg, `shin-${side}`);
    makeFacetedPart(panda, leg, `knee-${side}`);
    if (!footSupport)
      poseHindLeg(
        panda,
        side,
        sign,
        bodyPose,
        panda.getObjectByName(`foot-${side}`).position.clone(),
      );
  }
  if (footSupport) {
    try {
      braceFeet(panda, footSupport, scale, bodyPose);
    } catch (error) {
      disposePanda(panda);
      throw error;
    }
  }
  return panda;
}
