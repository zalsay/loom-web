const WALK_SPEED = 2.6;
const RUN_SPEED = 4.8;
const MAX_FRAME_SECONDS = 0.1;
const GRAVITY = 17;
const JUMP_SPEED = 5.8;
const EPSILON = 1e-6;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const finiteOrZero = (value) => (Number.isFinite(value) ? value : 0);

function cloneTransform(object) {
  return {
    position: object.position.clone(),
    quaternion: object.quaternion.clone(),
    scale: object.scale.clone(),
    rotationOrder: object.rotation.order,
  };
}

function restoreTransform(object, transform) {
  object.position.copy(transform.position);
  object.rotation.order = transform.rotationOrder;
  object.quaternion.copy(transform.quaternion);
  object.scale.copy(transform.scale);
}

/**
 * Adds bounded, camera-relative movement and a ground-only jump to the world panda.
 * `THREE` is injected so this module works with the same engine instance as the scene.
 */
export function createPandaController({
  THREE,
  panda,
  reducedMotion = false,
  bounds = { minX: -65, maxX: 65, minZ: -65, maxZ: 65 },
}) {
  if (!THREE || !panda) throw new TypeError('THREE and panda are required');

  const limits = {
    minX: Number.isFinite(bounds.minX) ? bounds.minX : -65,
    maxX: Number.isFinite(bounds.maxX) ? bounds.maxX : 65,
    minZ: Number.isFinite(bounds.minZ) ? bounds.minZ : -65,
    maxZ: Number.isFinite(bounds.maxZ) ? bounds.maxZ : 65,
  };
  const spawn = cloneTransform(panda);
  const floorY = panda.position.y;
  const originalChildren = [...panda.children];
  const childTransforms = new Map(originalChildren.map((child) => [child, cloneTransform(child)]));

  const findChild = (name) => originalChildren.find((child) => child.name === name);
  const pivots = new Map();
  const createPivot = (name, x, y, z = 0) => {
    const pivot = new THREE.Group();
    pivot.name = `panda-motion-${name}`;
    pivot.position.set(x, y, z);
    panda.add(pivot);
    pivots.set(name, pivot);
    return pivot;
  };

  // These anchors sit at the shoulders and hips. Attaching preserves the meshes' world
  // transforms, while paws/feet/toes inherit the same swing as their limb.
  panda.updateMatrixWorld(true);
  for (const [side, sign] of [
    ['left', -1],
    ['right', 1],
  ]) {
    const arm = createPivot(`arm-${side}`, sign * 0.84, 2.08, 0.015);
    const paw = findChild(`paw-${side}`);
    const armMesh = findChild(`arm-${side}`);
    if (armMesh) arm.attach(armMesh);
    if (paw) arm.attach(paw);

    const leg = createPivot(`leg-${side}`, sign * 0.42, 0.7, 0.04);
    for (const name of [
      `leg-${side}`,
      `foot-${side}`,
      ...originalChildren
        .filter((child) => child.name.startsWith(`toe-${side}-`))
        .map((child) => child.name),
    ]) {
      const part = findChild(name);
      if (part) leg.attach(part);
    }
  }
  panda.updateMatrixWorld(true);

  let active = false;
  let inputX = 0;
  let inputForward = 0;
  let running = false;
  let grounded = true;
  let jumpVelocity = 0;
  let jumpElapsed = 0;
  let jumpHeight = 0;
  let lastTimeMs = null;
  let gaitPhase = 0;
  let disposed = false;
  let lastCameraForward = new THREE.Vector3(0, 0, -1);

  const cameraDirection = new THREE.Vector3();
  const horizontalForward = new THREE.Vector3();
  const horizontalRight = new THREE.Vector3();
  const desired = new THREE.Vector3();

  const inputMagnitude = () => Math.hypot(inputX, inputForward);
  const clearInput = () => {
    inputX = 0;
    inputForward = 0;
    running = false;
  };
  const setLimbPose = (stride = 0) => {
    const amplitude = reducedMotion ? 0.1 : 0.34;
    let changed = false;
    for (const [side, sign] of [
      ['left', -1],
      ['right', 1],
    ]) {
      const arm = pivots.get(`arm-${side}`);
      const leg = pivots.get(`leg-${side}`);
      const armAngle = stride * amplitude * sign;
      const legAngle = -stride * amplitude * sign;
      if (arm) {
        if (Math.abs(arm.rotation.x - armAngle) > EPSILON) changed = true;
        arm.rotation.x = armAngle;
      }
      if (leg) {
        if (Math.abs(leg.rotation.x - legAngle) > EPSILON) changed = true;
        leg.rotation.x = legAngle;
      }
    }
    return changed;
  };

  function setActive(value) {
    if (disposed) return;
    const next = Boolean(value);
    active = next;
    lastTimeMs = null;
    if (!next) {
      clearInput();
      grounded = true;
      jumpVelocity = 0;
      jumpElapsed = 0;
      jumpHeight = 0;
      panda.position.y = floorY;
      gaitPhase = 0;
      setLimbPose();
    }
  }

  function setMovement(x, forward) {
    if (disposed) return;
    inputX = clamp(finiteOrZero(Number(x)), -1, 1);
    inputForward = clamp(finiteOrZero(Number(forward)), -1, 1);
  }

  function setRunning(value) {
    if (disposed) return;
    running = Boolean(value);
  }

  function jump() {
    if (disposed || !active || !grounded) return false;
    grounded = false;
    jumpVelocity = JUMP_SPEED;
    jumpElapsed = 0;
    jumpHeight = 0;
    return true;
  }

  function reset() {
    if (disposed) return;
    clearInput();
    panda.position.copy(spawn.position);
    panda.rotation.order = spawn.rotationOrder;
    panda.quaternion.copy(spawn.quaternion);
    panda.scale.copy(spawn.scale);
    grounded = true;
    jumpVelocity = 0;
    jumpElapsed = 0;
    jumpHeight = 0;
    gaitPhase = 0;
    lastTimeMs = null;
    setLimbPose();
  }

  function pause() {
    if (disposed) return;
    clearInput();
    lastTimeMs = null;
  }

  function update(timeMs, camera) {
    if (disposed || !active || !Number.isFinite(timeMs)) return false;

    const previousX = panda.position.x;
    const previousY = panda.position.y;
    const previousZ = panda.position.z;
    const previousHeading = panda.rotation.y;
    const dt = lastTimeMs === null ? 0 : clamp((timeMs - lastTimeMs) / 1000, 0, MAX_FRAME_SECONDS);
    lastTimeMs = timeMs;

    const magnitude = inputMagnitude();
    if (magnitude > EPSILON) {
      cameraDirection.set(0, 0, -1);
      if (camera && typeof camera.getWorldDirection === 'function') {
        camera.getWorldDirection(cameraDirection);
      }
      horizontalForward.set(cameraDirection.x, 0, cameraDirection.z);
      if (horizontalForward.lengthSq() > EPSILON) {
        horizontalForward.normalize();
        lastCameraForward.copy(horizontalForward);
      } else {
        horizontalForward.copy(lastCameraForward);
      }
      horizontalRight.set(-horizontalForward.z, 0, horizontalForward.x);

      desired
        .copy(horizontalRight)
        .multiplyScalar(inputX)
        .addScaledVector(horizontalForward, inputForward);
      if (desired.lengthSq() > EPSILON) {
        const strength = Math.min(1, magnitude);
        desired.normalize();
        panda.rotation.y = Math.atan2(desired.x, desired.z);
        const distance = (running ? RUN_SPEED : WALK_SPEED) * strength * dt;
        panda.position.x = clamp(panda.position.x + desired.x * distance, limits.minX, limits.maxX);
        panda.position.z = clamp(panda.position.z + desired.z * distance, limits.minZ, limits.maxZ);
      }
    }

    if (!grounded && dt > 0) {
      jumpElapsed += dt;
      jumpVelocity = JUMP_SPEED - GRAVITY * jumpElapsed;
      jumpHeight = JUMP_SPEED * jumpElapsed - 0.5 * GRAVITY * jumpElapsed ** 2;
      if (jumpHeight <= 0) {
        jumpHeight = 0;
        jumpVelocity = 0;
        jumpElapsed = 0;
        grounded = true;
      }
    }

    const dx = panda.position.x - previousX;
    const dz = panda.position.z - previousZ;
    const traveled = Math.hypot(dx, dz);
    const isStepping = traveled > EPSILON;
    let bob = 0;
    let poseChanged = false;
    if (isStepping && dt > 0) {
      gaitPhase += dt * (running ? 10 : 7.4) * Math.min(1, magnitude);
      if (!reducedMotion && grounded) bob = Math.abs(Math.sin(gaitPhase * 2)) * 0.022;
      poseChanged = setLimbPose(Math.sin(gaitPhase));
    } else {
      poseChanged = setLimbPose();
      gaitPhase = 0;
    }
    panda.position.y = floorY + jumpHeight + bob;

    return (
      Math.abs(panda.position.x - previousX) > EPSILON ||
      Math.abs(panda.position.y - previousY) > EPSILON ||
      Math.abs(panda.position.z - previousZ) > EPSILON ||
      Math.abs(panda.rotation.y - previousHeading) > EPSILON ||
      poseChanged
    );
  }

  function getState() {
    return {
      active,
      moving: active && inputMagnitude() > EPSILON,
      running: active && inputMagnitude() > EPSILON && running,
      grounded,
      position: { x: panda.position.x, y: panda.position.y, z: panda.position.z },
      heading: panda.rotation.y,
      jumpHeight,
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    active = false;
    clearInput();
    grounded = true;
    jumpHeight = 0;
    jumpElapsed = 0;
    jumpVelocity = 0;
    lastTimeMs = null;
    // Return only the original parts moved under our pivots; leave unrelated additions alone.
    const ownedPivots = new Set(pivots.values());
    for (const child of originalChildren) {
      if (child.parent !== panda) {
        child.removeFromParent();
        panda.add(child);
      }
      restoreTransform(child, childTransforms.get(child));
    }
    for (const pivot of ownedPivots) panda.remove(pivot);
    const extras = panda.children.filter((child) => !originalChildren.includes(child));
    panda.children = [...originalChildren, ...extras];
    restoreTransform(panda, spawn);
    panda.updateMatrixWorld(true);
  }

  return { setActive, setMovement, setRunning, jump, reset, pause, update, getState, dispose };
}
