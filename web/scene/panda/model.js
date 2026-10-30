import * as THREE from 'three';
import { createBellyEmblem } from './emblem.js';
import { createFurNormal, addShortFur } from './fur.js';

const HEAD = { x: 1.13, y: 1.00, z: 1.14, cy: 3.04, cz: 0.035 };
const BODY = { x: 1.06, y: 1.13, z: 1.06, cy: 1.43, cz: -0.035 };
const cheekWidth = y => HEAD.x * (1 + 0.095 * Math.exp(-(((y + 0.35) / 0.46) ** 2)));

const muzzleVolume = (x,y) => 0.28*Math.exp(-((x/0.31)**2+((y-2.79)/0.22)**2)) + 0.12*Math.exp(-((x/0.35)**2+((y-2.58)/0.18)**2));

/** Front surface in model coordinates; shared by the mesh and its attached details. */
export function headSurfaceZ(x, y) {
  const v = (y - HEAD.cy) / HEAD.y;
  const front = Math.sqrt(Math.max(0.004, 1 - (x / cheekWidth(v)) ** 2 - v * v));
  return HEAD.cz + HEAD.z * front + muzzleVolume(x,y)*front**0.35;
}
export function bodySurfaceZ(x, y) {
  return BODY.cz + BODY.z * Math.sqrt(Math.max(0.004, 1 - (x / BODY.x) ** 2 - ((y - BODY.cy) / BODY.y) ** 2));
}

function grain(geometry) {
  const p = geometry.getAttribute('position');
  const colors = [];
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // Subtle vertex pigment variation survives GLB export; no remote texture or custom shader.
    const n = Math.sin(x * 63.1 + z * 7.8) * Math.sin(y * 49.3 - z * 21.7);
    const v = 0.965 + n * 0.025;
    colors.push(v, v, v);
  }
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function curvedPatch(cx, cy, rx, ry, angle, surface, lift = 0.009) {
  const rings = 12, segments = 80;
  const positions = [cx, cy, surface(cx, cy) + lift], uv = [0.5, 0.5], indices = [];
  const c = Math.cos(angle), s = Math.sin(angle);
  for (let j = 1; j <= rings; j++) {
    const r = j / rings;
    for (let i = 0; i < segments; i++) {
      const a = i * Math.PI * 2 / segments;
      const dx = rx * r * Math.cos(a), dy = ry * r * Math.sin(a);
      const x = cx + dx * c - dy * s, y = cy + dx * s + dy * c;
      positions.push(x, y, surface(x, y) + lift);
      uv.push((dx / rx + 1) / 2, (dy / ry + 1) / 2);
      const k = 1 + (j - 1) * segments + i;
      const next = 1 + (j - 1) * segments + (i + 1) % segments;
      if (j === 1) indices.push(0, k, next);
      else indices.push(k - segments, k, next, k - segments, next, next - segments);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(indices); g.computeVertexNormals();
  return grain(g);
}

export function createPanda() {
  const panda = new THREE.Group();
  panda.name = 'LoomOS Panda';
  panda.userData = { version: '0.1.0', kind: 'procedural-character', reference: 'LoomOS-panda-ink-clean.svg', note: 'Artist interpretation of front reference; side and back are newly designed.' };
  const furNormal = createFurNormal();
  const material = (color, extra = {}) => new THREE.MeshPhysicalMaterial({
    color, roughness: 0.95, metalness: 0, sheen: 0.5, sheenRoughness: 0.9, specularIntensity: 0.25,
    normalMap: furNormal, normalScale: new THREE.Vector2(0.32,0.32),
    sheenColor: new THREE.Color(color), vertexColors: true, ...extra,
  });
  const ivory = material('#f2f0e9');
  const ink = material('#252c2e', { sheen: 0.3, sheenColor: new THREE.Color('#525c65'), specularIntensity: 0.15 });
  const innerInk = material('#333b3c');
  const milk = material('#fff9e8', { roughness: 0.48, normalMap: null });
  const pupil = material('#131c18', { roughness: 0.22, clearcoat: 0.25, normalMap: null });
  const sphere = grain(new THREE.SphereGeometry(1, 64, 40));
  const mesh = (name, geometry, mat, parent = panda) => {
    // Explicit tangent frames keep generated DataTextures portable through GLB export.
    if(mat.normalMap && !geometry.getAttribute('tangent')) geometry.computeTangents();
    const obj = new THREE.Mesh(geometry, mat); obj.name = name;
    obj.castShadow = true; obj.receiveShadow = true; parent.add(obj); return obj;
  };
  const blob = (name, position, scale, mat, parent = panda, angle = 0) => {
    const obj = mesh(name, sphere, mat, parent);
    obj.position.set(...position); obj.scale.set(...scale); obj.rotation.z = angle; return obj;
  };
  const line = (name, points, radius, mat, parent = panda, closed = false) => {
    const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)), closed, 'centripetal');
    return mesh(name, grain(new THREE.TubeGeometry(curve, Math.max(24, points.length * 8), radius, 8, closed)), mat, parent);
  };
  const surfaceLine = (name, points, radius, mat, surface, lift = 0.018, parent = panda, closed = false) =>
    line(name, points.map(([x, y]) => [x, y, surface(x, y) + lift]), radius, mat, parent, closed);

  // Complete volumes, not a stack of extruded SVG paths.
  blob('torso', [0, BODY.cy, BODY.cz], [BODY.x, BODY.y, BODY.z], ink);
  for (const sign of [-1, 1]) {
    const side = sign === -1 ? 'left' : 'right';
    blob(`leg-${side}`, [sign * 0.46, 0.48, -0.025], [0.38, 0.47, 0.49], ink);
    blob(`foot-${side}`, [sign * 0.47, 0.225, 0.19], [0.405, 0.225, 0.64], ink);
    blob(`arm-${side}`, [sign * 1.055, 1.53, 0.015], [0.34, 0.81, 0.51], ink, panda, sign * 0.24);
    blob(`paw-${side}`, [sign*1.23,0.86,0.105], [0.29,0.30,0.40], ink);
    for (let i = 0; i < 2; i++) {
      const x = sign * (0.40 + i * 0.16);
      line(`toe-${side}-${i}`, [[x, 0.18, 0.785], [x, 0.24, 0.804], [x + sign * 0.025, 0.31, 0.767]], 0.012, innerInk);
    }
    blob(`ear-${side}`, [sign * 0.79, 3.79, -0.005], [0.345, 0.405, 0.31], ink, panda, sign * -0.20);
    blob(`ear-inner-${side}`, [sign * 0.795, 3.80, 0.260], [0.21, 0.25, 0.045], innerInk, panda, sign * -0.20);
  }
  blob('tail', [0, 0.80, -1.015], [0.24, 0.24, 0.245], ivory);

  const headGeometry = new THREE.SphereGeometry(1, 96, 72);
  const hp = headGeometry.getAttribute('position');
  for (let i = 0; i < hp.count; i++) {
    const x = hp.getX(i), y = hp.getY(i), z = hp.getZ(i);
    const wx=x*cheekWidth(y),wy=y*HEAD.y+HEAD.cy;
    hp.setXYZ(i, wx, wy, z*HEAD.z+HEAD.cz+(z>0?muzzleVolume(wx,wy)*z**0.35:0));
  }
  headGeometry.computeVertexNormals();
  // SphereGeometry has two unreferenced pole vertices. Recomputed normals there
  // are zero, which glTF correctly rejects as non-unit even though they do not render.
  const hn = headGeometry.getAttribute('normal');
  for (let i = 0; i < hn.count; i++) {
    if (hn.getX(i) ** 2 + hn.getY(i) ** 2 + hn.getZ(i) ** 2 < 0.001) {
      hn.setXYZ(i, 0, hp.getY(i) > HEAD.cy ? 1 : -1, 0);
    }
  }
  mesh('head', grain(headGeometry), ivory);
  mesh('belly', curvedPatch(0, 1.29, 0.85, 0.86, 0, bodySurfaceZ), ivory);

  for (const sign of [-1, 1]) {
    const side = sign === -1 ? 'left' : 'right';
    mesh(`eye-patch-${side}`, curvedPatch(sign * 0.465, 3.145, 0.275, 0.385, sign * 0.34, headSurfaceZ), ink);
    const x = sign * 0.405, y = 3.16, z = headSurfaceZ(x, y);
    blob(`eye-${side}`, [x, y, z + 0.033], [0.103, 0.132, 0.047], milk, panda, sign * -0.14);
    blob(`pupil-${side}`, [x - sign * 0.015, y + 0.016, z + 0.076], [0.080, 0.103, 0.030], pupil);
    blob(`catchlight-${side}`, [x - 0.035, y + 0.079, z + 0.110], [0.017, 0.021, 0.008], milk);
    blob(`catchlight-small-${side}`, [x + 0.028, y - 0.020, z + 0.111], [0.007, 0.008, 0.005], milk);
  }
  const noseShape = new THREE.Shape();
  noseShape.moveTo(0, -0.09);
  noseShape.bezierCurveTo(-0.06, -0.075, -0.18, 0.015, -0.17, 0.058);
  noseShape.bezierCurveTo(-0.14, 0.118, 0.14, 0.118, 0.17, 0.058);
  noseShape.bezierCurveTo(0.18, 0.015, 0.06, -0.075, 0, -0.09);
  const noseGeometry = grain(new THREE.ExtrudeGeometry(noseShape, { depth: 0.055, steps: 1, bevelEnabled: true, bevelSegments: 4, bevelSize: 0.026, bevelThickness: 0.025, curveSegments: 20 }));
  const nose = mesh('nose', noseGeometry, pupil);
  nose.position.set(0, 2.86, headSurfaceZ(0, 2.86) + 0.005);
  blob('nose-soft-highlight', [-0.035, 2.92, headSurfaceZ(0, 2.86) + 0.095], [0.075, 0.018, 0.008], innerInk);
  surfaceLine('philtrum', [[0, 2.78], [0.012, 2.72], [0.012, 2.67]], 0.014, ink, headSurfaceZ);
  surfaceLine('smile-left', [[0.012, 2.67], [-0.095, 2.62], [-0.20, 2.635], [-0.255, 2.69]], 0.014, ink, headSurfaceZ);
  surfaceLine('smile-right', [[0.012, 2.67], [0.12, 2.63], [0.24, 2.67], [0.29, 2.74]], 0.014, ink, headSurfaceZ);
  blob('smile-dimple', [0.29, 2.74, headSurfaceZ(0.29, 2.74) + 0.018], [0.027, 0.022, 0.012], innerInk);

  for(const sign of [-1,1])for(let i=0;i<3;i++) {
    const x=sign*(0.12+i*0.055),y=2.78-(i%2)*0.035;
    blob(`muzzle-pore-${sign}-${i}`, [x,y,headSurfaceZ(x,y)+0.009], [0.009,0.007,0.004], innerInk);
  }
  const tuftCurve=new THREE.CatmullRomCurve3([new THREE.Vector3(-.09,4.0,-.03),new THREE.Vector3(-.08,4.14,.02),new THREE.Vector3(.035,4.22,.04),new THREE.Vector3(.14,4.14,.025)]);
  const tuftGeometry=new THREE.TubeGeometry(tuftCurve,40,.085,12,false),tp=tuftGeometry.getAttribute('position');
  for(let j=0;j<=40;j++) {
    const center=tuftCurve.getPointAt(j/40),taper=0.14+0.86*(1-j/40)**0.8;
    for(let k=0;k<=12;k++){const i=j*13+k;tp.setXYZ(i,center.x+(tp.getX(i)-center.x)*taper,center.y+(tp.getY(i)-center.y)*taper,center.z+(tp.getZ(i)-center.z)*taper);}
  }
  tuftGeometry.computeVertexNormals();mesh('tuft',grain(tuftGeometry),ivory);

  panda.add(createBellyEmblem(bodySurfaceZ));
  addShortFur(panda, ivory, ink);
  return panda;
}

export function disposePanda(panda) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  panda.traverse(obj => {
    if (!obj.isMesh) return;
    geometries.add(obj.geometry);
    if(obj.isInstancedMesh)obj.dispose();
    for (const mat of Array.isArray(obj.material) ? obj.material : [obj.material]) materials.add(mat);
  });
  materials.forEach(m=>Object.values(m).forEach(v=>{if(v?.isTexture)textures.add(v);}));
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());textures.forEach(t=>t.dispose());
}
