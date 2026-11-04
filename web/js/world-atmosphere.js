const CONDITION_VISUALS = {
  clear: { sky: 0xbfcfb4, fog: 0xdbe3d2, fogNear: 80, fogFar: 210, cloud: 1, sunlight: 1 },
  cloudy: { sky: 0xb4c0b2, fog: 0xcbd2c8, fogNear: 70, fogFar: 185, cloud: 0.87, sunlight: 0.78 },
  overcast: { sky: 0xaeb9b1, fog: 0xc6cdc7, fogNear: 55, fogFar: 160, cloud: 0.75, sunlight: 0.66 },
  fog: { sky: 0xb9c4b8, fog: 0xd6ddd2, fogNear: 24, fogFar: 92, cloud: 0.72, sunlight: 0.64 },
  rain: { sky: 0x91a39f, fog: 0xb9c7c1, fogNear: 38, fogFar: 125, cloud: 0.7, sunlight: 0.58 },
  snow: { sky: 0xc6d0ce, fog: 0xd5dfdc, fogNear: 48, fogFar: 150, cloud: 0.78, sunlight: 0.72 },
  sleet: { sky: 0x9fadaa, fog: 0xc2cfca, fogNear: 36, fogFar: 118, cloud: 0.68, sunlight: 0.58 },
  thunder: { sky: 0x768a89, fog: 0xa5b4b0, fogNear: 32, fogFar: 112, cloud: 0.56, sunlight: 0.48 },
  unknown: { sky: 0xb8c6b3, fog: 0xd5ddd1, fogNear: 80, fogFar: 200, cloud: 0.82, sunlight: 0.8 },
};

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const numeric = (value) => typeof value === 'number' && Number.isFinite(value);
const formatDate = (epoch) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(epoch));

function localMinutes(epoch) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epoch));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return Number(values.hour) * 60 + Number(values.minute);
}

function daylight(state) {
  const now = numeric(state?.now) ? state.now : Date.now();
  const sunrise = state?.sun?.sunrise;
  const sunset = state?.sun?.sunset;
  if (
    numeric(sunrise) &&
    numeric(sunset) &&
    sunset > sunrise &&
    state?.sun?.date === formatDate(now)
  ) {
    const isNight = now < sunrise || now > sunset;
    const progress = clamp((now - sunrise) / (sunset - sunrise), 0, 1);
    const fraction = isNight ? 0 : clamp(Math.sin(Math.PI * progress), 0, 1);
    const twilight =
      now < sunrise || now > sunset
        ? false
        : now - sunrise < 45 * 60_000 || sunset - now < 45 * 60_000;
    return { fraction, twilight, estimated: false, progress, isNight };
  }
  // Missing model sunrise/sunset: a gentle local-clock estimate for Fuzhou only.
  const minutes = localMinutes(now);
  const start = 6 * 60 + 15;
  const end = 17 * 60 + 45;
  const progress = clamp((minutes - start) / (end - start), 0, 1);
  const fraction = minutes < start || minutes > end ? 0 : clamp(Math.sin(Math.PI * progress), 0, 1);
  const twilight = fraction > 0 && (minutes - start < 45 || end - minutes < 45);
  return { fraction, twilight, estimated: true, progress, isNight: fraction === 0 };
}

function color(hex, THREE) {
  return new THREE.Color(hex);
}

export function createWorldAtmosphere({
  THREE,
  scene,
  camera,
  renderer,
  hemi,
  sun,
  fill,
  compatibilityMode = false,
  reducedMotion = false,
}) {
  const originalBackground = scene.background;
  const originalFog = scene.fog;
  const originalHemiIntensity = hemi.intensity;
  const originalHemiSky = hemi.color.clone();
  const originalHemiGround = hemi.groundColor.clone();
  const originalSunIntensity = sun.intensity;
  const originalSunColor = sun.color.clone();
  const originalSunPosition = sun.position.clone();
  const originalFillIntensity = fill.intensity;
  const originalFillColor = fill.color.clone();
  const ownedBackground = new THREE.Color(0xdbe3d2);
  const ownedFog = originalFog || new THREE.Fog(0xdbe3d2, 80, 210);
  const originalFogColor = ownedFog.color.clone();
  const originalFogNear = ownedFog.near;
  const originalFogFar = ownedFog.far;
  const baseHemi = originalHemiIntensity;
  const baseSun = originalSunIntensity;
  const baseFill = originalFillIntensity;
  const baselineSun = originalSunColor.clone();
  const baselineFill = originalFillColor.clone();
  const baselineHemiSky = originalHemiSky.clone();
  const baselineHemiGround = originalHemiGround.clone();
  const output = renderer?.domElement;
  const originalOutputBackground = output?.style?.backgroundColor || '';
  let current = null;
  let particleKind = null;
  let particleObject = null;
  let particleGeometry = null;
  let particleMaterial = null;
  let positions = null;
  let velocities = null;
  const lookAhead = new THREE.Vector3();
  const focus = new THREE.Vector3();
  let previousTime = null;
  let disposed = false;
  let indoor = false;
  let lastVisual = '';

  scene.background = ownedBackground;
  scene.fog = ownedFog;
  if (compatibilityMode) document.body.dataset.renderer = 'compatibility';
  else delete document.body.dataset.renderer;

  function removeParticles() {
    if (!particleObject) return;
    scene.remove(particleObject);
    particleGeometry?.dispose();
    particleMaterial?.dispose();
    particleObject = null;
    particleGeometry = null;
    particleMaterial = null;
    positions = null;
    velocities = null;
    particleKind = null;
  }

  function createParticles(kind) {
    removeParticles();
    // SVG repaints the whole architectural model per frame. Its precipitation
    // is a CSS overlay instead, never a reason to rebuild thousands of paths.
    if (!kind || reducedMotion || compatibilityMode) return;
    particleKind = kind;
    const count = compatibilityMode ? (kind === 'rain' ? 44 : 30) : kind === 'rain' ? 128 : 104;
    positions = new Float32Array(count * 3);
    velocities = new Float32Array(count);
    for (let index = 0; index < count; index++) {
      positions[index * 3] = (Math.random() - 0.5) * 94;
      positions[index * 3 + 1] = Math.random() * 38;
      positions[index * 3 + 2] = (Math.random() - 0.5) * 90;
      velocities[index] = kind === 'rain' ? 18 + Math.random() * 11 : 1.5 + Math.random() * 2.8;
    }
    particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    if (kind === 'rain') {
      const endpoints = new Float32Array(count * 6);
      particleObject = new THREE.LineSegments(
        new THREE.BufferGeometry(),
        new THREE.LineBasicMaterial({
          color: 0xd7ecec,
          transparent: true,
          opacity: 0.46,
          depthWrite: false,
        }),
      );
      // Each falling streak is a short independent segment.
      particleGeometry.dispose();
      particleGeometry = particleObject.geometry;
      particleGeometry.setAttribute('position', new THREE.BufferAttribute(endpoints, 3));
      positions = endpoints;
      for (let index = 0; index < count; index++) {
        const slot = index * 6;
        positions[slot] = (Math.random() - 0.5) * 94;
        positions[slot + 1] = Math.random() * 38;
        positions[slot + 2] = (Math.random() - 0.5) * 90;
        positions[slot + 3] = positions[slot] + 0.06;
        positions[slot + 4] = positions[slot + 1] - 0.85;
        positions[slot + 5] = positions[slot + 2];
      }
      particleMaterial = particleObject.material;
    } else {
      particleMaterial = new THREE.PointsMaterial({
        color: 0xf4fbff,
        size: compatibilityMode ? 0.72 : 0.42,
        transparent: true,
        opacity: 0.78,
        depthWrite: false,
        sizeAttenuation: true,
      });
      particleObject = new THREE.Points(particleGeometry, particleMaterial);
    }
    particleObject.name = 'World weather particles';
    particleObject.frustumCulled = false;
    scene.add(particleObject);
    if (kind === 'rain') updateRainStreaks();
  }

  function updateRainStreaks() {
    if (particleKind !== 'rain' || !positions || !particleGeometry) return;
    const count = positions.length / 6;
    for (let index = 0; index < count; index++) {
      const slot = index * 6;
      positions[slot + 3] = positions[slot] + 0.06;
      positions[slot + 4] = positions[slot + 1] - 0.85;
      positions[slot + 5] = positions[slot + 2];
    }
  }

  function applyLighting(state) {
    scene.fog = ownedFog;
    const condition = CONDITION_VISUALS[state?.current?.condition] || CONDITION_VISUALS.unknown;
    const sunState = daylight(state);
    const daylightLevel = sunState.fraction;
    const cloud = condition.cloud;
    const illumination = condition.sunlight * (0.58 + 0.42 * cloud);
    const night = sunState.isNight;
    const dayScale = 0.1 + 0.9 * Math.sqrt(daylightLevel);
    const sky = color(condition.sky, THREE);
    const nightSky = color(0x263342, THREE);
    const dawnSky = color(0xe4b08e, THREE);
    const moodSky = night ? nightSky : sunState.twilight ? sky.lerp(dawnSky, 0.32) : sky;
    ownedBackground.copy(moodSky).lerp(nightSky, night ? 0 : (1 - cloud) * 0.04);
    if (compatibilityMode && output?.style)
      output.style.backgroundColor = ownedBackground.getStyle();
    ownedFog.color.set(condition.fog);
    if (night) ownedFog.color.lerp(nightSky, 0.32);
    ownedFog.near = condition.fogNear;
    ownedFog.far = condition.fogFar;
    if (!compatibilityMode) {
      const nightLift = 0.34;
      hemi.intensity = Math.max(
        0.82,
        baseHemi * (night ? nightLift : (0.55 + dayScale * 0.45) * illumination),
      );
      sun.intensity = Math.max(0.08, baseSun * dayScale * illumination);
      fill.intensity = Math.max(0.28, baseFill * (night ? 0.82 : 0.65 + dayScale * 0.35));
      hemi.color
        .copy(baselineHemiSky)
        .lerp(
          color(night ? 0x8295af : 0xffe2be, THREE),
          sunState.twilight ? 0.34 : night ? 0.3 : 0.05,
        );
      hemi.groundColor
        .copy(baselineHemiGround)
        .lerp(color(night ? 0x394655 : 0x73694f, THREE), night ? 0.35 : 0.12);
      sun.color
        .copy(baselineSun)
        .lerp(
          color(sunState.twilight ? 0xffb36f : night ? 0x8ea4ce : 0xffffff, THREE),
          sunState.twilight ? 0.52 : night ? 0.68 : 0.06,
        );
      fill.color
        .copy(baselineFill)
        .lerp(color(night ? 0x8ca4c7 : 0xe2f0f3, THREE), night ? 0.65 : 0.08);
    } else {
      // SVG fallback has no real lighting; its sky/fog and the CSS haze still carry the day/weather shift.
      hemi.color.copy(baselineHemiSky);
      hemi.groundColor.copy(baselineHemiGround);
      sun.color.copy(baselineSun);
      fill.color.copy(baselineFill);
      hemi.intensity = Math.max(0.62, baseHemi * (night ? 0.82 : illumination));
      sun.intensity = Math.max(0.15, baseSun * (night ? 0.7 : illumination));
      fill.intensity = Math.max(0.1, baseFill * (night ? 0.8 : illumination));
    }
    const height = -8 + daylightLevel * 88;
    // Visual-only sun arc: timing follows local sunrise/sunset, but its azimuth is not a surveyed north bearing.
    const azimuth = sunState.progress * Math.PI;
    sun.position.set(-Math.cos(azimuth) * 56, Math.max(7, height), Math.sin(azimuth) * 52 + 8);
    document.body.dataset.worldPhase = night
      ? 'night'
      : sunState.twilight
        ? sunState.progress < 0.5
          ? 'dawn'
          : 'dusk'
        : 'day';
    document.body.dataset.worldCondition = state?.current?.condition || 'unknown';
    const signature = `${state?.current?.condition || 'unknown'}:${document.body.dataset.worldPhase}:${condition.fogNear}:${condition.fogFar}`;
    const changed = signature !== lastVisual;
    lastVisual = signature;
    return changed;
  }

  function setConditions(state) {
    if (disposed) return;
    current = state && typeof state === 'object' ? state : null;
    applyLighting(current);
    if (indoor) {
      // The isolated laboratory keeps its own neutral room light. Weather data
      // still updates the HUD, but outdoor fog, rain and night tint stay outside.
      ownedBackground.set(0xe6e8e3);
      scene.fog = null;
      hemi.intensity = compatibilityMode ? 0.9 : 2.1;
      hemi.color.set(0xf2f4ed);
      hemi.groundColor.set(0xb5b8ae);
      sun.intensity = compatibilityMode ? 0.15 : 0.22;
      sun.color.copy(baselineSun);
      fill.intensity = compatibilityMode ? 0.1 : 0.65;
      fill.color.copy(baselineFill);
      if (compatibilityMode && output?.style)
        output.style.backgroundColor = ownedBackground.getStyle();
    }
    const nextKind = indoor
      ? null
      : current?.current?.condition === 'rain' ||
          current?.current?.condition === 'sleet' ||
          current?.current?.condition === 'thunder'
        ? 'rain'
        : current?.current?.condition === 'snow'
          ? 'snow'
          : null;
    if (nextKind !== particleKind) createParticles(nextKind);
  }

  function setIndoor(value) {
    if (disposed || indoor === !!value) return;
    indoor = !!value;
    previousTime = null;
    setConditions(current);
  }

  function update(timeMs) {
    if (disposed || !particleObject || !positions) {
      previousTime = numeric(timeMs) ? timeMs : previousTime;
      return false;
    }
    const time = numeric(timeMs) ? timeMs : (previousTime ?? 0);
    const delta = previousTime === null ? 0 : clamp((time - previousTime) / 1000, 0, 0.05);
    previousTime = time;
    if (delta <= 0) return false;
    camera.getWorldDirection(lookAhead);
    focus
      .copy(camera.position)
      .addScaledVector(lookAhead, Math.min(70, camera.position.length() * 0.62));
    const count = particleKind === 'rain' ? positions.length / 6 : positions.length / 3;
    const rain = particleKind === 'rain';
    const floor = Math.max(2, Math.min(15, focus.y + (camera.position.y > 80 ? 20 : 11)));
    const ceiling = floor + (camera.position.y > 80 ? 54 : 30);
    particleObject.position.set(focus.x, floor, focus.z);
    for (let index = 0; index < count; index++) {
      const slot = index * (rain ? 6 : 3);
      let y = positions[slot + 1];
      y -= velocities[index] * delta;
      if (y < 0) {
        y = ceiling - floor + Math.random() * 7;
        positions[slot] = (Math.random() - 0.5) * 94;
        positions[slot + 2] = (Math.random() - 0.5) * 90;
      }
      positions[slot + 1] = y;
      if (rain) {
        positions[slot + 3] = positions[slot] + 0.06;
        positions[slot + 4] = y - 0.85;
        positions[slot + 5] = positions[slot + 2];
      }
    }
    particleGeometry.attributes.position.needsUpdate = true;
    return true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    removeParticles();
    scene.background = originalBackground;
    scene.fog = originalFog;
    if (originalFog) {
      originalFog.color.copy(originalFogColor);
      originalFog.near = originalFogNear;
      originalFog.far = originalFogFar;
    }
    hemi.intensity = originalHemiIntensity;
    hemi.color.copy(originalHemiSky);
    hemi.groundColor.copy(originalHemiGround);
    sun.intensity = originalSunIntensity;
    sun.color.copy(originalSunColor);
    sun.position.copy(originalSunPosition);
    fill.intensity = originalFillIntensity;
    fill.color.copy(originalFillColor);
    if (compatibilityMode && output?.style) output.style.backgroundColor = originalOutputBackground;
    delete document.body.dataset.worldPhase;
    delete document.body.dataset.worldCondition;
    delete document.body.dataset.renderer;
  }

  return { setConditions, setIndoor, update, dispose };
}
