import * as THREE from 'three';
import { createFacetedPanda } from '../scene/panda-faceted.js';
import { disposePanda } from '../scene/panda/model.js';
import { createPandaController } from './panda-controller.js';

/** A small, transparent presentation of the existing character and its jump rig. */
export function createPandaMascot(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.75));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-2.6, 2.6, 2.9, -2.9, 0.1, 30);
  camera.position.set(0.2, 2.65, 10);
  camera.lookAt(0, 2.25, 0);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x7c937d, 2.5));
  const key = new THREE.DirectionalLight(0xfff4de, 3.1);
  key.position.set(-4, 7, 5);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xd4e5dd, 1.4);
  rim.position.set(4, 3, -3);
  scene.add(rim);
  const panda = createFacetedPanda();
  panda.rotation.y = -0.16;
  scene.add(panda);
  const rig = createPandaController({ THREE, panda });
  rig.setActive(true);
  const wave = panda.getObjectByName('panda-motion-arm-right');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let frame = 0,
    last = null,
    elapsed = 0,
    lastCycle = -1,
    engaged = false,
    paused = false,
    disposed = false,
    lost = false;

  function pose() {
    const cycle = elapsed % 12;
    rig.update(elapsed * 1000, camera);
    panda.rotation.y = -0.16;
    wave.rotation.z = 0;
    let action = 'idle';
    if (!motion.matches && !engaged) {
      const cycleNumber = Math.floor(elapsed / 12);
      if (cycle >= 0.6 && cycle < 1.4) {
        if (lastCycle !== cycleNumber) {
          rig.jump();
          lastCycle = cycleNumber;
        }
        action = 'jump';
      } else if (cycle >= 3.4 && cycle < 5.4) {
        const progress = (cycle - 3.4) / 2;
        const eased = progress * progress * (3 - 2 * progress);
        panda.rotation.y += eased * Math.PI * 2;
        action = 'spin';
      } else if (cycle >= 7.4 && cycle < 9.4) {
        wave.rotation.z = 1.9 + Math.sin((cycle - 7.4) * 11) * 0.22;
        action = 'wave';
      }
      panda.rotation.z = Math.sin(elapsed * 1.7) * 0.025;
    } else {
      panda.rotation.z = 0;
    }
    canvas.dataset.motion = motion.matches ? 'still' : action;
    canvas.parentElement.style.setProperty(
      '--panda-shadow-scale',
      String(1 - Math.min(0.3, panda.position.y * 0.22)),
    );
    renderer.render(scene, camera);
  }
  function tick(time) {
    frame = 0;
    if (disposed || lost || paused || document.hidden) {
      last = null;
      return;
    }
    if (last !== null) elapsed += Math.min((time - last) / 1000, 0.05);
    last = time;
    pose();
    if (!motion.matches && !engaged) frame = requestAnimationFrame(tick);
  }
  function refresh() {
    cancelAnimationFrame(frame);
    frame = 0;
    last = null;
    if (disposed || lost || paused || document.hidden) return;
    frame = requestAnimationFrame(tick);
  }
  function settle() {
    rig.setActive(false);
    rig.setActive(true);
    refresh();
  }
  function resize() {
    if (disposed || lost) return;
    const width = canvas.clientWidth,
      height = canvas.clientHeight;
    if (!width || !height) return;
    camera.left = -(height ? width / height : 1) * 2.9;
    camera.right = -camera.left;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    if (!paused && !document.hidden) pose();
    refresh();
  }
  function contextLost(event) {
    event.preventDefault();
    lost = true;
    cancelAnimationFrame(frame);
    canvas.closest('.panda-guide').dataset.renderer = 'fallback';
  }
  function contextRestored() {
    lost = false;
    canvas.closest('.panda-guide').dataset.renderer = 'webgl';
    resize();
  }
  canvas.addEventListener('webglcontextlost', contextLost);
  canvas.addEventListener('webglcontextrestored', contextRestored);
  document.addEventListener('visibilitychange', refresh);
  motion.addEventListener('change', settle);
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  return {
    setEngaged(value) {
      engaged = value;
      settle();
    },
    setPaused(value) {
      paused = value;
      refresh();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', refresh);
      motion.removeEventListener('change', settle);
      canvas.removeEventListener('webglcontextlost', contextLost);
      canvas.removeEventListener('webglcontextrestored', contextRestored);
      rig.dispose();
      disposePanda(panda);
      renderer.dispose();
    },
  };
}
