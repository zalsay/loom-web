import * as THREE from 'three';

// Small, repeatable local maps: the farm never needs an external texture request.
export function farmSurface(kind, repeatX = 1, repeatY = 1) {
  const size = 256;
  const bytes = new Uint8Array(size * size * 4);
  const palettes = {
    wood: [190, 155, 111],
    soil: [91, 65, 44],
    gravel: [192, 183, 160],
    grass: [119, 139, 83],
    solar: [34, 54, 70],
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const hash = (Math.imul(x + 17, 374761393) ^ Math.imul(y + 53, 668265263)) >>> 0;
      const noise = ((hash >>> 8) & 255) / 255 - 0.5;
      // All broad waves complete full periods at the texture edge.
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;
      let value;
      if (kind === 'wood') {
        value = Math.sin(v * 22 + Math.sin(u) * 2.2) * 4;
        value += Math.sin(v * 61 + Math.sin(u * 2)) * 2 + noise * 7;
      } else if (kind === 'soil') {
        value = noise * 36 + Math.sin(u * 5) * Math.sin(v * 7) * 6;
      } else if (kind === 'gravel') {
        value = noise * 28 + (hash % 17 === 0 ? -18 : 0);
      } else if (kind === 'solar') {
        value = x % 32 < 2 || y % 64 < 2 ? 72 : x % 8 === 0 ? 15 : noise * 4;
      } else {
        value = noise * 12;
      }
      const base = palettes[kind];
      bytes.set([...base.map((c) => Math.round(c + value)), 255], (y * size + x) * 4);
    }
  }
  const texture = new THREE.DataTexture(bytes, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.repeat.set(repeatX, repeatY);
  texture.needsUpdate = true;
  return texture;
}

export function farmLeafGeometry() {
  const positions = [],
    colors = [],
    indices = [];
  const base = new THREE.Color('#6b8946');
  const tip = new THREE.Color('#b7ca77');
  const color = new THREE.Color();
  for (let row = 0; row <= 8; row++) {
    const t = row / 8;
    const width = Math.sin(Math.PI * t) ** 0.85 * 0.42;
    for (let col = -1; col <= 1; col++) {
      positions.push(col * width, Math.sin(t * Math.PI) * (col === 0 ? 0.16 : 0.04), t);
      color.copy(base).lerp(tip, t * 0.7 + (col === 0 ? 0.15 : 0));
      colors.push(color.r, color.g, color.b);
    }
  }
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 2; col++) {
      const a = row * 3 + col;
      if (row > 0) indices.push(a, a + 3, a + 1);
      if (row < 7) indices.push(a + 1, a + 3, a + 4);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function farmInstances(parent, name, geometry, material, transforms) {
  const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
  mesh.name = name;
  const dummy = new THREE.Object3D();
  transforms.forEach(({ position, rotation = [0, 0, 0], scale = [1, 1, 1], color }, i) => {
    dummy.position.set(...position);
    dummy.rotation.set(...rotation);
    dummy.scale.set(...scale);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    if (color) mesh.setColorAt(i, new THREE.Color(color));
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

export function farmRod(parent, material, from, to, radius = 0.018) {
  const a = new THREE.Vector3(...from),
    b = new THREE.Vector3(...to);
  const delta = b.clone().sub(a);
  const rod = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, delta.length(), 7),
    material,
  );
  rod.position.copy(a).add(b).multiplyScalar(0.5);
  rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
  rod.castShadow = true;
  parent.add(rod);
  return rod;
}
