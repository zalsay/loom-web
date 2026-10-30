import * as THREE from 'three';
import { EMBLEM_SOURCE, EMBLEM_LAYERS } from './emblem-data.js';

function random(seed=73921) {
  return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
}

/** Fine directional fibers, encoded as an embedded normal map, not a remote image. */
export function createFurNormal() {
  const size=256,rand=random(11621),height=new Float32Array(size*size);
  for(let i=0;i<height.length;i++)height[i]=rand()*0.04;
  for(let i=0;i<2600;i++) {
    const x=rand()*size,y=rand()*size,length=5+rand()*12,lean=(rand()-.5)*0.55;
    for(let j=0;j<length;j++) {
      const px=Math.floor(x+lean*j),py=Math.floor(y+j);
      const value=Math.sin(j/length*Math.PI)*(0.18+rand()*0.08);
      for(let dx=-1;dx<=1;dx++)height[((py+size)%size)*size+((px+dx+size)%size)]+=value*(dx===0?1:0.22);
    }
  }
  const bytes=new Uint8Array(size*size*4),n=new THREE.Vector3();
  const at=(x,y)=>height[((y+size)%size)*size+((x+size)%size)];
  for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    n.set(-(at(x+1,y)-at(x-1,y))*1.7,-(at(x,y+1)-at(x,y-1))*1.7,1).normalize();
    const i=(y*size+x)*4;bytes[i]=Math.round((n.x*.5+.5)*255);bytes[i+1]=Math.round((n.y*.5+.5)*255);bytes[i+2]=Math.round((n.z*.5+.5)*255);bytes[i+3]=255;
  }
  const tex=new THREE.DataTexture(bytes,size,size,THREE.RGBAFormat);
  tex.name='procedural short-fiber normal';tex.wrapS=tex.wrapT=THREE.RepeatWrapping;tex.repeat.set(6,6);
  tex.magFilter=THREE.LinearFilter;tex.minFilter=THREE.LinearMipmapLinearFilter;tex.generateMipmaps=true;tex.needsUpdate=true;
  return tex;
}

// Rasterize only occupancy, from the already compiled source contours. No logo re-drawing.
function makeLogoMask() {
  const n=128,mask=new Uint8Array(n*n),[x0,y0,x1,y1]=EMBLEM_SOURCE.crop;
  for(const layer of EMBLEM_LAYERS) {
    const {xy,indices}=layer;
    for(let k=0;k<indices.length;k+=3) {
      const points=[indices[k],indices[k+1],indices[k+2]].map(i=>[(xy[i*2]-x0)/(x1-x0)*n,(xy[i*2+1]-y0)/(y1-y0)*n]);
      const [[ax,ay],[bx,by],[cx,cy]]=points;
      const minX=Math.max(0,Math.floor(Math.min(ax,bx,cx))),maxX=Math.min(n-1,Math.ceil(Math.max(ax,bx,cx)));
      const minY=Math.max(0,Math.floor(Math.min(ay,by,cy))),maxY=Math.min(n-1,Math.ceil(Math.max(ay,by,cy)));
      for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++) {
        const px=x+.5,py=y+.5;
        const a=(bx-ax)*(py-ay)-(by-ay)*(px-ax),b=(cx-bx)*(py-by)-(cy-by)*(px-bx),c=(ax-cx)*(py-cy)-(ay-cy)*(px-cx);
        if((a>=0&&b>=0&&c>=0)||(a<=0&&b<=0&&c<=0))mask[y*n+x]=1;
      }
    }
  }
  const {origin,scale,center}=EMBLEM_SOURCE.svgToModel;
  return (x,y)=>{
    const sx=(x-center[0])/scale+origin[0],sy=origin[1]-(y-center[1])/scale;
    const gx=Math.floor((sx-x0)/(x1-x0)*n),gy=Math.floor((sy-y0)/(y1-y0)*n);
    // Include a two-cell margin for leaning strand tips, but never a rectangular bald patch.
    for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)if(gx+dx>=0&&gx+dx<n&&gy+dy>=0&&gy+dy<n&&mask[(gy+dy)*n+gx+dx])return true;
    return false;
  };
}
let logoMask;
export function isLogoSurface(x,y) { logoMask??=makeLogoMask();return logoMask(x,y); }

/** Sample actual existing triangle surfaces; strands stay attached after reshaping. */
function surfaceSampler(mesh,rand) {
  const p=mesh.geometry.getAttribute('position'),normals=mesh.geometry.getAttribute('normal'),index=mesh.geometry.index;
  const faceCount=(index?index.count:p.count)/3,areas=new Float64Array(faceCount),normalMatrix=new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const a=new THREE.Vector3(),b=new THREE.Vector3(),c=new THREE.Vector3(),ab=new THREE.Vector3(),ac=new THREE.Vector3();
  const id=i=>index?index.getX(i):i;let total=0;
  for(let f=0;f<faceCount;f++) {
    a.fromBufferAttribute(p,id(f*3)).applyMatrix4(mesh.matrixWorld);b.fromBufferAttribute(p,id(f*3+1)).applyMatrix4(mesh.matrixWorld);c.fromBufferAttribute(p,id(f*3+2)).applyMatrix4(mesh.matrixWorld);
    total+=ab.subVectors(b,a).cross(ac.subVectors(c,a)).length()*.5;areas[f]=total;
  }
  const na=new THREE.Vector3(),nb=new THREE.Vector3(),nc=new THREE.Vector3();
  return ()=>{
    const target=rand()*total;let lo=0,hi=faceCount-1;
    while(lo<hi){const mid=(lo+hi)>>1;if(areas[mid]<target)lo=mid+1;else hi=mid;}
    const ia=id(lo*3),ib=id(lo*3+1),ic=id(lo*3+2),r=Math.sqrt(rand()),u=1-r,v=r*(1-rand()),w=1-u-v;
    a.fromBufferAttribute(p,ia);b.fromBufferAttribute(p,ib);c.fromBufferAttribute(p,ic);
    const point=a.clone().multiplyScalar(u).addScaledVector(b,v).addScaledVector(c,w).applyMatrix4(mesh.matrixWorld);
    na.fromBufferAttribute(normals,ia);nb.fromBufferAttribute(normals,ib);nc.fromBufferAttribute(normals,ic);
    const normal=na.clone().multiplyScalar(u).addScaledVector(nb,v).addScaledVector(nc,w).applyMatrix3(normalMatrix).normalize();
    return {point,normal};
  };
}

export function addShortFur(panda,ivory,ink) {
  panda.updateMatrixWorld(true);
  const rand=random(),buckets={ivory:[],ink:[]};
  const insideBelly=(x,y)=>(x/.85)**2+((y-1.29)/.86)**2<1.035;
  const insidePatch=(x,y,sign)=>{const a=sign*.34,c=Math.cos(a),s=Math.sin(a),dx=x-sign*.465,dy=y-3.145;return ((dx*c+dy*s)/.285)**2+((-dx*s+dy*c)/.395)**2<1.06;};
  const insideEyes=(x,y)=>[-1,1].some(sign=>((x-sign*.405)/.145)**2+((y-3.16)/.17)**2<1.2);
  const parts=[['head',12500,'ivory'],['torso',9000,'ink'],['belly',8500,'ivory'],['eye-patch-left',800,'ink'],['eye-patch-right',800,'ink'],
    ...['left','right'].flatMap(side=>[[`arm-${side}`,3000,'ink'],[`paw-${side}`,700,'ink'],[`ear-${side}`,1100,'ink'],[`leg-${side}`,800,'ink'],[`foot-${side}`,1000,'ink']]),['tail',400,'ivory'],['tuft',300,'ivory']];
  for(const [name,requested,color] of parts) {
    const part=panda.getObjectByName(name);if(!part)continue;
    const sample=surfaceSampler(part,rand);let made=0;
    for(let attempt=0;attempt<requested*4&&made<requested;attempt++) {
      const {point,normal}=sample(),{x,y,z}=point;
      if(name==='head'&&normal.z>0) {
        if(insidePatch(x,y,-1)||insidePatch(x,y,1))continue;
        if(Math.abs(x)<.34&&y>2.53&&y<3.02)continue;
      }
      if(name.startsWith('eye-patch')&&insideEyes(x,y))continue;
      if(name==='torso'&&normal.z>0&&insideBelly(x,y))continue;
      if(name==='belly'&&isLogoSurface(x,y))continue;
      if(name.startsWith('foot')&&y<.075)continue;
      // Tangential grooming avoids a radial hedgehog silhouette.
      const tangent=new THREE.Vector3((rand()-.5)*.45,-1,(rand()-.5)*.2);
      tangent.addScaledVector(normal,-tangent.dot(normal));if(tangent.lengthSq()<.01)tangent.set(1,0,0).cross(normal);
      tangent.normalize();const direction=normal.clone().multiplyScalar(.48).addScaledVector(tangent,.85).normalize();
      const length=(name.startsWith('eye-patch')?.014:name.startsWith('ear')?.038:.026)*(0.65+rand()*.8);
      // Roots are slightly embedded to hide tiny gaps due to interpolated surface sampling.
      buckets[color].push({point:point.addScaledVector(normal,-.0025),direction,length,width:.0009+rand()*.0008,shade:.78+rand()*.35});made++;
    }
  }
  const group=new THREE.Group();group.name='short-fur';group.userData={kind:'instanced-short-fiber',notSimulation:true};
  const strand=new THREE.ConeGeometry(1,1,3,1,true);strand.translate(0,.5,0);
  const matrix=new THREE.Matrix4(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3(),up=new THREE.Vector3(0,1,0),color=new THREE.Color();
  for(const [key,base] of [['ivory',ivory],['ink',ink]]) {
    const data=buckets[key],material=base.clone();material.normalMap=null;material.vertexColors=false;
    const mesh=new THREE.InstancedMesh(strand,material,data.length);mesh.name=`short-fur-${key}`;
    data.forEach((f,i)=>{rotation.setFromUnitVectors(up,f.direction);scale.set(f.width,f.length,f.width);matrix.compose(f.point,rotation,scale);mesh.setMatrixAt(i,matrix);color.setRGB(f.shade,f.shade,f.shade);mesh.setColorAt(i,color);});
    mesh.instanceMatrix.needsUpdate=true;mesh.instanceColor.needsUpdate=true;mesh.castShadow=false;mesh.receiveShadow=false;
    mesh.computeBoundingBox();mesh.computeBoundingSphere();group.add(mesh);
  }
  panda.add(group);return group;
}
