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
const { createFacetedPanda } = await import('../web/scene/panda-faceted.js');

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

test('torso and belly use real flat triangular panels matching the head', () => {
  const panda = createFacetedPanda();
  try {
    for (const name of ['head', 'torso', 'belly']) {
      const mesh = panda.getObjectByName(name);
      const geometry = mesh.geometry;
      const positions = geometry.getAttribute('position');
      const normals = geometry.getAttribute('normal');
      const colors = geometry.getAttribute('color');
      assert.equal(geometry.index, null, `${name} has independent face vertices`);
      assert.ok(positions.count > 100 && positions.count <= 3000, `${name} is low-poly`);
      assert.equal(mesh.material.flatShading, true);
      const directions = new Set();
      for (let i = 0; i < positions.count; i += 3) {
        for (let j = 1; j <= 2; j++) {
          for (const axis of ['getX', 'getY', 'getZ']) {
            assert.ok(
              Math.abs(normals[axis](i) - normals[axis](i + j)) < 1e-6,
              `${name} has flat face normals`,
            );
            assert.equal(colors[axis](i), colors[axis](i + j), `${name} has one tone per panel`);
          }
        }
        directions.add(
          [normals.getX(i), normals.getY(i), normals.getZ(i)].map((v) => v.toFixed(3)).join(','),
        );
      }
      assert.ok(directions.size > 30, `${name} has distinct oriented planes, not a flat decal`);
    }
  } finally {
    dispose(panda);
  }
});

test('white belly follows the faceted torso without intersections or a floating smooth patch', () => {
  const panda = createFacetedPanda();
  try {
    panda.updateMatrixWorld(true);
    const torso = panda.getObjectByName('torso');
    const belly = panda.getObjectByName('belly');
    const ray = new THREE.Raycaster();
    for (let ring = 0; ring < 12; ring++) {
      const radius = ((ring + 0.5) / 12) * 0.98;
      for (let i = 0; i < 48; i++) {
        const angle = (i / 48) * Math.PI * 2;
        const x = 0.85 * radius * Math.cos(angle);
        const y = 1.29 + 0.86 * radius * Math.sin(angle);
        ray.set(new THREE.Vector3(x, y, 5), new THREE.Vector3(0, 0, -1));
        const bodyHit = ray.intersectObject(torso, false)[0];
        const bellyHit = ray.intersectObject(belly, false)[0];
        assert.ok(bodyHit && bellyHit, `both surfaces cover belly at ${x}, ${y}`);
        const gap = bellyHit.point.z - bodyHit.point.z;
        assert.ok(
          Math.abs(gap - 0.009) < 1e-5,
          `belly follows parent panel with 0.009 lift, got ${gap}`,
        );
        const bodyNormal = bodyHit.face.normal
          .clone()
          .applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(torso.matrixWorld));
        assert.ok(
          bodyNormal.dot(bellyHit.face.normal) > 0.99999,
          'white and black panels are parallel',
        );
      }
    }
  } finally {
    dispose(panda);
  }
});

test('faceted head stays beneath both eye patches across dense interior samples', () => {
  const panda = createFacetedPanda();
  try {
    const head = panda.getObjectByName('head');
    const raycaster = new THREE.Raycaster();
    const samplesPerRing = 160;
    const rings = 32;
    const maxPenetration = { left: -Infinity, right: -Infinity };

    assert.ok(head.geometry.getAttribute('position').count <= 2304, 'head remains low-poly');
    assert.equal(head.material.flatShading, true);

    for (const sign of [-1, 1]) {
      const side = sign < 0 ? 'left' : 'right';
      const patch = panda.getObjectByName(`eye-patch-${side}`);
      const cx = sign * 0.64;
      const cy = 3.24;
      const rx = 0.34;
      const ry = 0.46;
      const rotation = sign * 0.34;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);

      for (let ring = 0; ring < rings; ring++) {
        const radius = (ring + 0.5) / rings;
        for (let i = 0; i < samplesPerRing; i++) {
          const angle = (i / samplesPerRing) * Math.PI * 2;
          const dx = rx * radius * Math.cos(angle);
          const dy = ry * radius * Math.sin(angle);
          const x = cx + dx * cos - dy * sin;
          const y = cy + dx * sin + dy * cos;
          raycaster.set(new THREE.Vector3(x, y, 5), new THREE.Vector3(0, 0, -1));
          const headHit = raycaster.intersectObject(head, false)[0];
          const patchHit = raycaster.intersectObject(patch, false)[0];
          assert.ok(headHit, `${side} head surface hit at radius ${radius}, angle ${angle}`);
          assert.ok(patchHit, `${side} eye patch hit at radius ${radius}, angle ${angle}`);
          assert.ok(
            Math.abs(patchHit.point.z - headHit.point.z - 0.009) < 1e-5,
            'eye patch follows the same head plane without floating',
          );
          maxPenetration[side] = Math.max(maxPenetration[side], headHit.point.z - patchHit.point.z);
        }
      }
    }

    assert.ok(
      maxPenetration.left <= -1e-3 && maxPenetration.right <= -1e-3,
      `head must remain at least 0.001 behind eye patches (maximum protrusion: ${JSON.stringify(maxPenetration)})`,
    );

    for (const name of [
      'eye-left',
      'eye-right',
      'pupil-left',
      'pupil-right',
      'catchlight-left',
      'catchlight-right',
      'catchlight-small-left',
      'catchlight-small-right',
      'nose',
      'nose-soft-highlight',
      'philtrum',
      'smile-left',
      'smile-right',
    ]) {
      const mark = panda.getObjectByName(name);
      assert.ok(mark?.isMesh, `${name} remains present`);
      assert.equal(mark.material.depthTest, true, `${name} retains depth testing`);
    }
  } finally {
    dispose(panda);
  }
});

test('sculpture has a broad head and muzzle, restrained black eyes, and no fur tuft', () => {
  const panda = createFacetedPanda();
  try {
    panda.updateMatrixWorld(true);
    const bounds = (name) => new THREE.Box3().setFromObject(panda.getObjectByName(name));
    const head = bounds('head').getSize(new THREE.Vector3());
    const nose = bounds('nose').getSize(new THREE.Vector3());
    assert.ok(head.x >= 2.6, 'broad sculpture head, not the narrow mascot head');
    assert.ok(nose.x >= 0.6, 'wide angular nose');
    assert.equal(panda.getObjectByName('tuft'), undefined, 'clean sculptural crown');
    assert.equal(panda.getObjectByName('short-fur'), undefined);
    assert.equal(!!panda.getObjectByName('smile-dimple'), false);
    assert.ok(
      panda.getObjectByName('smile-left').material.color.r > 0.2,
      'mouth is a subtle sculpted crease rather than a black cartoon grin',
    );
    for (const side of ['left', 'right']) {
      const eye = panda.getObjectByName(`eye-${side}`);
      assert.ok(eye.material.color.getHex() < 0x404040, 'no white cartoon sclera');
      const patch = panda.getObjectByName(`eye-patch-${side}`);
      assert.equal(patch.geometry.index, null, 'eye markings share real head panels');
      assert.equal(patch.material.flatShading, true);
      assert.ok(
        panda.getObjectByName(`catchlight-${side}`).material.color.r > 0.7,
        'black eyes do not recolour the shared pale catchlight material',
      );
    }
    const ray = new THREE.Raycaster(new THREE.Vector3(0.42, 2.78, 5), new THREE.Vector3(0, 0, -1));
    const hit = ray.intersectObject(panda.getObjectByName('head'), false)[0];
    assert.ok(hit.point.z > 1.18, 'muzzle extends across the cheeks, not only under the nose');
    const highlight = panda.getObjectByName('nose-soft-highlight');
    ray.set(
      new THREE.Vector3(highlight.position.x, highlight.position.y, 5),
      new THREE.Vector3(0, 0, -1),
    );
    const noseHit = ray.intersectObject(panda.getObjectByName('nose'), false)[0];
    assert.ok(
      noseHit && Math.abs(highlight.position.z - noseHit.point.z - 0.002) < 1e-5,
      'nose highlight touches the nose rather than floating in profile',
    );
  } finally {
    dispose(panda);
  }
});

test('the climbing sculpture has an ivory rump and a black shoulder band on the same mesh', () => {
  const panda = createFacetedPanda();
  try {
    const torso = panda.getObjectByName('torso');
    assert.ok(torso.material.color.r > 0.7, 'rump is white, not an all-black mascot back');
    const p = torso.geometry.getAttribute('position');
    const c = torso.geometry.getAttribute('color');
    let white = 0,
      black = 0;
    for (let i = 0; i < p.count; i += 3) {
      const ys = [p.getY(i), p.getY(i + 1), p.getY(i + 2)];
      assert.ok(
        Math.min(...ys) >= 0.38 - 1e-6 || Math.max(...ys) <= 0.38 + 1e-6,
        'shoulder edge is clipped through panels, not a sawtooth of whole triangles',
      );
      const y = ys.reduce((a, b) => a + b, 0) / 3;
      if (y < -0.2) {
        assert.ok(c.getX(i) > 0.85);
        white++;
      }
      if (y > 0.55) {
        assert.ok(c.getX(i) < 0.04);
        black++;
      }
    }
    assert.ok(white > 10 && black > 10);
  } finally {
    dispose(panda);
  }
});
