import * as THREE from 'three';
import {
  ZHI_JIE_SOURCE_ELEMENT_COUNT,
  ZHI_JIE_SOURCE_ELEMENTS,
  ZHI_JIE_SOURCE_SHA256,
} from './zhi-jie-logo-data.js';

const HALO_TEXTURE_WIDTH = 512;
const HALO_TEXTURE_HEIGHT = 192;
const HALO_MARGIN_METERS = 0.035;
const HALO_BLUR_SIGMA = 2.2;
const LED_EMISSIVE_INTENSITY = 0.82;

const pathTokens = (path) =>
  [...path.matchAll(/[A-Za-z]|-?(?:\d+\.?\d*|\.\d+)/g)].map((match) => match[0]);

function parsePath(path, offset) {
  const tokens = pathTokens(path);
  const paths = [];
  let points = [];
  let command = '';
  let index = 0;
  let current = [0, 0];
  let start = [0, 0];
  const number = () => Number(tokens[index++]);
  const point = (x, y) => [x + offset[0], y + offset[1]];

  while (index < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[index])) command = tokens[index++];
    if (command === 'M' || command === 'L') {
      current = [number(), number()];
      if (command === 'M') {
        if (points.length) paths.push({ points, closed: false });
        points = [point(...current)];
        start = [...current];
        command = 'L';
      } else points.push(point(...current));
    } else if (command === 'H') {
      current = [number(), current[1]];
      points.push(point(...current));
    } else if (command === 'V') {
      current = [current[0], number()];
      points.push(point(...current));
    } else if (command === 'Z') {
      if (points.length > 1) points.push(point(...start));
      paths.push({ points, closed: true });
      points = [];
      current = [...start];
      command = '';
    } else {
      throw new Error(`Unsupported SVG path command: ${command}`);
    }
  }
  if (points.length) paths.push({ points, closed: false });
  return paths;
}

const samePoint = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-8;

function strokePolygons(points, closed, width, linecap, linejoin) {
  const radius = width / 2;
  const segments = [];
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < 1e-8) continue;
    const direction = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
    const normal = [-direction[1] * radius, direction[0] * radius];
    const capStart = !closed && index === 1 && linecap === 'square' ? radius : 0;
    const capEnd = !closed && index === points.length - 1 && linecap === 'square' ? radius : 0;
    const start = [a[0] - direction[0] * capStart, a[1] - direction[1] * capStart];
    const end = [b[0] + direction[0] * capEnd, b[1] + direction[1] * capEnd];
    segments.push({
      polygon: [
        [start[0] + normal[0], start[1] + normal[1]],
        [end[0] + normal[0], end[1] + normal[1]],
        [end[0] - normal[0], end[1] - normal[1]],
        [start[0] - normal[0], start[1] - normal[1]],
      ],
      a,
      b,
    });
  }

  const polygons = segments.map(({ polygon }) => polygon);
  const unique = points.filter(
    (point, index) => index === 0 || !samePoint(point, points[index - 1]),
  );
  if (!closed && linecap === 'round' && unique.length > 1) {
    polygons.push(circlePolygon(unique[0], radius, 12), circlePolygon(unique.at(-1), radius, 12));
  }
  const jointCount = closed ? unique.length : Math.max(0, unique.length - 2);
  for (let joint = 0; joint < jointCount; joint += 1) {
    const pointIndex = closed ? joint : joint + 1;
    const previous = unique[(pointIndex - 1 + unique.length) % unique.length];
    const point = unique[pointIndex];
    const next = unique[(pointIndex + 1) % unique.length];
    if (linejoin === 'round') {
      polygons.push(circlePolygon(point, radius, 12));
      continue;
    }
    const incoming = [point[0] - previous[0], point[1] - previous[1]];
    const outgoing = [next[0] - point[0], next[1] - point[1]];
    const cross = incoming[0] * outgoing[1] - incoming[1] * outgoing[0];
    if (Math.abs(cross) < 1e-8) continue;
    const side = cross > 0 ? -1 : 1;
    const inLength = Math.hypot(...incoming);
    const outLength = Math.hypot(...outgoing);
    const first = [
      point[0] - (incoming[1] / inLength) * radius * side,
      point[1] + (incoming[0] / inLength) * radius * side,
    ];
    const second = [
      point[0] - (outgoing[1] / outLength) * radius * side,
      point[1] + (outgoing[0] / outLength) * radius * side,
    ];
    polygons.push([point, first, second]);
  }
  return polygons;
}

function circlePolygon(center, radius, divisions = 16) {
  return Array.from({ length: divisions }, (_, index) => {
    const angle = (index / divisions) * Math.PI * 2;
    return [center[0] + Math.cos(angle) * radius, center[1] + Math.sin(angle) * radius];
  });
}

function elementPolygons(element) {
  const offset = element.transform;
  if (element.tag === 'rect') {
    const x = element.x + offset[0];
    const y = element.y + offset[1];
    return [
      {
        polygon: [
          [x, y],
          [x + element.width, y],
          [x + element.width, y + element.height],
          [x, y + element.height],
        ],
        color: element.fill,
      },
    ];
  }
  if (element.tag === 'circle')
    return [
      {
        polygon: circlePolygon([element.cx + offset[0], element.cy + offset[1]], element.r, 24),
        color: element.fill,
      },
    ];

  const paths = parsePath(element.d, offset);
  const result = [];
  for (const path of paths) {
    if (element.fill !== 'none' && path.points.length >= 3)
      result.push({ polygon: path.points, color: element.fill });
    if (element.stroke !== 'none')
      for (const polygon of strokePolygons(
        path.points,
        path.closed,
        element.strokeWidth,
        element.linecap,
        element.linejoin,
      ))
        result.push({ polygon, color: element.stroke });
  }
  return result;
}

function shapeFromPolygon(polygon) {
  const shape = new THREE.Shape();
  shape.moveTo(polygon[0][0], -polygon[0][1]);
  for (const [x, y] of polygon.slice(1)) shape.lineTo(x, -y);
  shape.closePath();
  return shape;
}

function mergeGeometries(geometries) {
  const attributes = ['position', 'normal', 'uv'];
  const merged = new THREE.BufferGeometry();
  let totalVertices = 0;
  for (const geometry of geometries) totalVertices += geometry.getAttribute('position').count;

  for (const name of attributes) {
    const arrays = geometries.map((geometry) => geometry.getAttribute(name)).filter(Boolean);
    if (arrays.length !== geometries.length) continue;
    const itemSize = arrays[0].itemSize;
    const values = new Float32Array(totalVertices * itemSize);
    let offset = 0;
    for (const attribute of arrays) {
      values.set(attribute.array, offset);
      offset += attribute.array.length;
    }
    merged.setAttribute(name, new THREE.Float32BufferAttribute(values, itemSize));
  }

  let vertexOffset = 0;
  const indices = [];
  for (const geometry of geometries) {
    const attribute = geometry.getAttribute('position');
    const source = geometry.getIndex();
    if (source) {
      for (let index = 0; index < source.count; index += 1)
        indices.push(source.getX(index) + vertexOffset);
    } else {
      for (let index = 0; index < attribute.count; index += 1) indices.push(index + vertexOffset);
    }
    vertexOffset += attribute.count;
  }
  merged.setIndex(indices);
  merged.computeBoundingBox();
  merged.computeBoundingSphere();
  return merged;
}

function sourceColorBytes(color) {
  const value = Number.parseInt(color.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function rasterizePolygon(mask, colors, polygon, width, height, mapPoint, color) {
  const points = polygon.map(mapPoint);
  const minY = Math.max(0, Math.floor(Math.min(...points.map(([, y]) => y))));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(...points.map(([, y]) => y))));
  const rgb = sourceColorBytes(color);
  for (let y = minY; y <= maxY; y += 1) {
    const scanY = y + 0.5;
    const intersections = [];
    for (let index = 0; index < points.length; index += 1) {
      const [x1, y1] = points[index];
      const [x2, y2] = points[(index + 1) % points.length];
      if ((y1 <= scanY && y2 > scanY) || (y2 <= scanY && y1 > scanY))
        intersections.push(x1 + ((scanY - y1) * (x2 - x1)) / (y2 - y1));
    }
    intersections.sort((a, b) => a - b);
    for (let index = 0; index + 1 < intersections.length; index += 2) {
      const startX = Math.max(0, Math.ceil(intersections[index] - 0.5));
      const endX = Math.min(width - 1, Math.floor(intersections[index + 1] - 0.5));
      for (let x = startX; x <= endX; x += 1) {
        const pixel = y * width + x;
        mask[pixel] = 1;
        colors[pixel * 3] = rgb[0];
        colors[pixel * 3 + 1] = rgb[1];
        colors[pixel * 3 + 2] = rgb[2];
      }
    }
  }
}

function gaussianKernel(sigma) {
  const radius = Math.ceil(sigma * 3);
  const kernel = [];
  let total = 0;
  for (let offset = -radius; offset <= radius; offset += 1) {
    const weight = Math.exp(-(offset * offset) / (2 * sigma * sigma));
    kernel.push(weight);
    total += weight;
  }
  return kernel.map((weight) => weight / total);
}

function blurChannel(source, width, height, kernel) {
  const radius = Math.floor(kernel.length / 2);
  const horizontal = new Float32Array(source.length);
  const result = new Float32Array(source.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleX = x + offset;
        if (sampleX >= 0 && sampleX < width)
          value += source[y * width + sampleX] * kernel[offset + radius];
      }
      horizontal[y * width + x] = value;
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = 0;
      for (let offset = -radius; offset <= radius; offset += 1) {
        const sampleY = y + offset;
        if (sampleY >= 0 && sampleY < height)
          value += horizontal[sampleY * width + x] * kernel[offset + radius];
      }
      result[y * width + x] = value;
    }
  }
  return result;
}

/** Make a compact, source-contour-derived texture with a narrow static falloff. */
function createLedHaloTexture(entries, minX, maxX, minY, maxY, scale) {
  const width = HALO_TEXTURE_WIDTH;
  const height = HALO_TEXTURE_HEIGHT;
  const mask = new Float32Array(width * height);
  const colors = new Uint8Array(width * height * 3);
  const marginUnits = HALO_MARGIN_METERS / scale;
  const bounds = {
    minX: minX - marginUnits,
    maxX: maxX + marginUnits,
    minY: minY - marginUnits,
    maxY: maxY + marginUnits,
  };
  const mapPoint = ([x, y]) => [
    ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * width,
    ((bounds.maxY - y) / (bounds.maxY - bounds.minY)) * height,
  ];

  for (const { primitives } of entries)
    for (const { polygon, color } of primitives)
      rasterizePolygon(mask, colors, polygon, width, height, mapPoint, color);

  const kernel = gaussianKernel(HALO_BLUR_SIGMA);
  const blurredMask = blurChannel(mask, width, height, kernel);
  const premultiplied = [0, 1, 2].map((channel) => {
    const values = new Float32Array(mask.length);
    for (let pixel = 0; pixel < mask.length; pixel += 1)
      values[pixel] = (colors[pixel * 3 + channel] / 255) * mask[pixel];
    return blurChannel(values, width, height, kernel);
  });
  const bytes = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < mask.length; pixel += 1) {
    const offset = pixel * 4;
    for (let channel = 0; channel < 3; channel += 1)
      bytes[offset + channel] = blurredMask[pixel]
        ? Math.round((premultiplied[channel][pixel] / blurredMask[pixel]) * 255)
        : 0;
    const outerFalloff = Math.max(0, blurredMask[pixel] - mask[pixel]);
    bytes[offset + 3] = Math.round(Math.min(1, outerFalloff * 0.72) * 255);
  }

  const texture = new THREE.DataTexture(bytes, width, height, THREE.RGBAFormat);
  texture.name = '织界 LED 轮廓柔光';
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/** Build the complete, source-derived facade mark as individually disposable 3D meshes. */
export function createZhiJieSign({ width = 1.4, depth = 0.025 } = {}) {
  if (!Number.isFinite(width) || width <= 0)
    throw new RangeError('width must be a positive finite number');
  if (!Number.isFinite(depth) || depth <= 0 || depth > 0.04)
    throw new RangeError('depth must be positive and no greater than 0.04 meters');

  const sign = new THREE.Group();
  sign.name = '织界外墙标志';
  sign.userData = {
    brand: '织界',
    source: 'assets/zhi-jie-logo.svg',
    sourceSha256: ZHI_JIE_SOURCE_SHA256,
    sourceElementCount: ZHI_JIE_SOURCE_ELEMENT_COUNT,
  };

  const entries = ZHI_JIE_SOURCE_ELEMENTS.map((element) => ({
    element,
    primitives: elementPolygons(element),
  }));
  const allPoints = entries.flatMap(({ primitives }) =>
    primitives.flatMap(({ polygon }) => polygon),
  );
  const minX = Math.min(...allPoints.map(([x]) => x));
  const maxX = Math.max(...allPoints.map(([x]) => x));
  const minY = Math.min(...allPoints.map(([, y]) => y));
  const maxY = Math.max(...allPoints.map(([, y]) => y));
  const scale = width / (maxX - minX);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const haloTexture = createLedHaloTexture(entries, minX, maxX, minY, maxY, scale);
  const primitiveCount = entries.reduce((sum, { primitives }) => sum + primitives.length, 0);
  const layerRange = Math.min(0.0015, depth * 0.06);
  const layerStep = primitiveCount > 1 ? layerRange / (primitiveCount - 1) : 0;
  let drawOrder = 0;

  for (const { element, primitives } of entries) {
    const elementGroup = new THREE.Group();
    elementGroup.name = `zhi-jie-svg-${String(element.index).padStart(2, '0')}-${element.tag}`;
    elementGroup.userData = { sourceElementIndex: element.index, sourceTag: element.tag };
    sign.add(elementGroup);

    for (const [primitiveIndex, primitive] of primitives.entries()) {
      const geometry = new THREE.ExtrudeGeometry(shapeFromPolygon(primitive.polygon), {
        depth: Math.max(0.0001, (depth - layerRange) / scale),
        bevelEnabled: false,
        curveSegments: 12,
      });
      geometry.translate(0, 0, (drawOrder * layerStep) / scale);
      primitive.geometry = geometry;
      drawOrder += 1;
    }

    const geometry = mergeGeometries(primitives.map(({ geometry }) => geometry));
    for (const primitive of primitives) {
      primitive.geometry.dispose();
      delete primitive.geometry;
    }
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(primitives[0].color).multiplyScalar(0.22),
      emissive: primitives[0].color,
      emissiveIntensity: LED_EMISSIVE_INTENSITY,
      toneMapped: false,
      roughness: 0.48,
      metalness:
        primitives[0].color === '#ffc866' || primitives[0].color === '#4ee5e0' ? 0.14 : 0.03,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(-centerX * scale, centerY * scale, -depth / 2);
    mesh.scale.setScalar(scale);
    mesh.name = `zhi-jie-element-${String(element.index).padStart(2, '0')}`;
    mesh.userData = {
      ledEmitter: true,
      sourceElementIndex: element.index,
      sourceElementOrder: element.index,
      sourceTag: element.tag,
      drawOrder: element.index,
      sourceColors: [...new Set(primitives.map(({ color }) => color))],
    };
    elementGroup.add(mesh);
  }

  const haloWidth = (maxX - minX) * scale + HALO_MARGIN_METERS * 2;
  const haloHeight = (maxY - minY) * scale + HALO_MARGIN_METERS * 2;
  const halo = new THREE.Mesh(
    new THREE.PlaneGeometry(haloWidth, haloHeight),
    new THREE.MeshBasicMaterial({
      map: haloTexture,
      color: 0xffffff,
      transparent: true,
      opacity: 0.42,
      blending: THREE.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
  );
  halo.name = '织界 LED 柔光';
  halo.position.set(0, 0, depth / 2 + 0.001);
  halo.userData = { ledHalo: true };
  sign.add(halo);

  return sign;
}
