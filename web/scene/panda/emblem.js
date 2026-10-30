import * as THREE from 'three';
import { TessellateModifier } from 'three/addons/modifiers/TessellateModifier.js';
import { EMBLEM_SOURCE, EMBLEM_LAYERS } from './emblem-data.js';

/** The original artwork, conformed to the belly. No substitute tubes or detached bridges. */
export function createBellyEmblem(surface) {
  const emblem = new THREE.Group();
  emblem.name = 'loom-emblem';
  emblem.userData = { ...EMBLEM_SOURCE, interpretation:'surface-conforming SVG relief' };
  const { origin, scale, center } = EMBLEM_SOURCE.svgToModel;
  const tessellator = new TessellateModifier(0.04, 16);
  for (const [rank, layer] of EMBLEM_LAYERS.entries()) {
    const positions = [];
    for (let i=0; i<layer.xy.length; i+=2) {
      positions.push((layer.xy[i]-origin[0])*scale+center[0],(origin[1]-layer.xy[i+1])*scale+center[1],0);
    }
    // SVG's downward Y is mirrored into model space: reverse the triangle winding too.
    const indices = [];
    for (let i=0; i<layer.indices.length; i+=3) indices.push(layer.indices[i],layer.indices[i+2],layer.indices[i+1]);
    const planar = new THREE.BufferGeometry();
    planar.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    planar.setIndex(indices);
    // Split broad SVG triangles BEFORE projection so their interiors cannot cut into the belly.
    const geometry = tessellator.modify(planar);planar.dispose();
    const points=geometry.getAttribute('position'),normals=new Float32Array(points.count*3);
    const lift=0.012+rank*0.00008;
    const n=new THREE.Vector3(),eps=0.0001;
    for(let i=0;i<points.count;i++) {
      const x=points.getX(i),y=points.getY(i);
      points.setZ(i,surface(x,y)+lift);
      n.set(-(surface(x+eps,y)-surface(x-eps,y))/(2*eps),-(surface(x,y+eps)-surface(x,y-eps))/(2*eps),1).normalize();
      n.toArray(normals,i*3);
    }
    geometry.setAttribute('normal',new THREE.BufferAttribute(normals,3));
    const material=new THREE.MeshStandardMaterial({color:layer.color,roughness:0.9,metalness:0,
      polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-rank});
    const patch=new THREE.Mesh(geometry,material);
    patch.name=`emblem-svg-${String(layer.sourceIndex).padStart(3,'0')}`;
    patch.userData={sourcePathIndex:layer.sourceIndex,paintOrder:rank};
    patch.receiveShadow=true;
    // Ordered pigment layers should never cast false shadows onto each other.
    patch.castShadow=false;
    emblem.add(patch);
  }
  return emblem;
}
