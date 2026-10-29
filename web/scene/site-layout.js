import * as THREE from 'three';

// The supplied screenshot is a visual plan, not a survey. Image right is +X,
// image down is +Z. No true-north bearing or scale bar was supplied.
export const SITE = {
  metresPerPixel: .14,
  imageOrigin: [560,455],
  imageSize: [1051,945],
  videoStartPixel: [590,554],
  videoTargetPixel: [531,478],
  canopyCurvePixels: [[508,482],[590,478],[654,396],[640,308]],
};
export function mapPoint(x,z,y=0){return new THREE.Vector3((x-SITE.imageOrigin[0])*SITE.metresPerPixel,y,(z-SITE.imageOrigin[1])*SITE.metresPerPixel);}
export const oldCenterline=x=>.0038*(x+4)**2-.35;
function curveAt(t){
 const p=SITE.canopyCurvePixels,a=(1-t)**3,b=3*(1-t)**2*t,c=3*(1-t)*t*t,d=t**3;
 return mapPoint(a*p[0][0]+b*p[1][0]+c*p[2][0]+d*p[3][0],a*p[0][1]+b*p[1][1]+c*p[2][1]+d*p[3][1]);
}
export function bendPoint(v){
 const raw=(v.x+17)/32.9,t=Math.max(0,Math.min(1,raw)),point=curveAt(t);
 const ta=Math.max(0,t-.0001),tb=Math.min(1,t+.0001),dir=curveAt(tb).sub(curveAt(ta)).normalize();
 if(raw!==t)point.addScaledVector(dir,(raw-t)*32.9);
 const normal=new THREE.Vector3(-dir.z,0,dir.x),offset=v.z-oldCenterline(v.x);
 return point.addScaledVector(normal,offset).setY(v.y);
}
function bendGeometry(original,worldMatrix){
 const g=original.index?original.toNonIndexed():original.clone();g.applyMatrix4(worldMatrix);
 const p=g.attributes.position,uv=g.attributes.uv,positions=[],uvs=[];
 function append(a,b,c,depth=0){
  const verts=[a,b,c],lengths=[Math.abs(a[0]-b[0]),Math.abs(b[0]-c[0]),Math.abs(c[0]-a[0])],longest=Math.max(...lengths);
  if(longest>.85&&depth<10){const e=lengths.indexOf(longest),i=e,j=(e+1)%3,k=(e+2)%3,mid=verts[i].map((x,n)=>(x+verts[j][n])/2);append(verts[i],mid,verts[k],depth+1);append(mid,verts[j],verts[k],depth+1);return;}
  for(const a of verts){const q=bendPoint(new THREE.Vector3(a[0],a[1],a[2]));positions.push(q.x,q.y,q.z);if(uv)uvs.push(a[3],a[4]);}
 }
 for(let i=0;i<p.count;i+=3){const a=[];for(let j=0;j<3;j++)a.push([p.getX(i+j),p.getY(i+j),p.getZ(i+j),uv?.getX(i+j)||0,uv?.getY(i+j)||0]);append(...a);}
 const result=new THREE.BufferGeometry();result.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));if(uv)result.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));result.computeVertexNormals();result.computeBoundingSphere();return result;
}
// Bake the nonlinear plan into static geometry. Articulated doors retain a rigid
// local frame and hinge, so opening them remains correct after the building bends.
export function bendGroup(source){
 source.updateMatrixWorld(true);
 function copy(node){
  if(node.userData.doorLeaf){
   const oldP=new THREE.Vector3().setFromMatrixPosition(node.matrixWorld),oldX=new THREE.Vector3(1,0,0).applyMatrix4(node.matrixWorld);
   const p=bendPoint(oldP),dir=bendPoint(oldX).sub(p).normalize(),yaw=Math.atan2(-dir.z,dir.x),out=node.clone(true);
   out.position.copy(p);out.rotation.set(0,yaw,0);out.scale.set(1,1,1);out.userData.closedAngle=yaw;return out;
  }
  if(node.isMesh){const out=node.clone(false);out.geometry=bendGeometry(node.geometry,node.matrixWorld);out.position.set(0,0,0);out.rotation.set(0,0,0);out.scale.set(1,1,1);out.updateMatrix();return out;}
  if(node.isLine){const a=node.geometry.attributes.position,points=[];for(let i=0;i<a.count;i++)points.push(bendPoint(new THREE.Vector3().fromBufferAttribute(a,i).applyMatrix4(node.matrixWorld)));const out=node.clone(false);out.geometry=new THREE.BufferGeometry().setFromPoints(points);out.position.set(0,0,0);out.rotation.set(0,0,0);out.scale.set(1,1,1);out.updateMatrix();return out;}
  const out=new THREE.Group();out.name=node.name;out.userData=structuredClone(node.userData);for(const child of node.children)out.add(copy(child));return out;
 }
 return copy(source);
}

export const ROAD_PATHS = {
 east:[[997,-65],[1004,140],[1001,375],[985,625],[959,850],[936,1030]],
 diagonal:[[-100,618],[135,714],[360,815],[610,933],[930,1080]],
 inner:[[573,-35],[563,116],[523,242],[425,319],[308,344],[208,329],[143,275]],
 branch:[[205,330],[265,391],[349,420],[426,417],[491,376],[544,320],[605,299]],
 connector:[[305,343],[318,392],[391,449],[465,471],[511,471]],
 southern:[[364,647],[466,710],[548,776],[648,827],[759,824],[853,754]],
};
function smooth(points){return new THREE.CatmullRomCurve3(points.map(p=>mapPoint(...p)),false,'catmullrom',.35);}
function flatMesh(parent,name,points,y,material){const shape=new THREE.Shape();points.forEach((p,i)=>{const v=mapPoint(...p);i?shape.lineTo(v.x,v.z):shape.moveTo(v.x,v.z);});shape.closePath();const geometry=new THREE.ShapeGeometry(shape);geometry.rotateX(Math.PI/2);geometry.translate(0,y,0);geometry.computeVertexNormals();const mesh=new THREE.Mesh(geometry,material);mesh.name=name;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
export function addSiteGround(ground,materials){
 const {asphalt,curb,line}=materials,paver=new THREE.MeshStandardMaterial({name:'浅灰园路砖',color:0xc1c4b5,roughness:.95,side:THREE.DoubleSide});
 const road=new THREE.MeshStandardMaterial({name:'市政道路沥青',color:0x737d78,map:asphalt.map,roughness:1,side:THREE.DoubleSide});
 const edge=new THREE.MeshStandardMaterial({name:'道路路缘石',color:0xd1d2c4,roughness:.97,side:THREE.DoubleSide});
 const roadMark=line.clone();roadMark.name='道路白色标线';roadMark.polygonOffset=true;roadMark.polygonOffsetFactor=-1;roadMark.polygonOffsetUnits=-4;roadMark.depthWrite=false;
 const paths=[];
 function ribbon(name,pixels,width,material,y=.0,range=[-width/2,width/2]){
  const curve=smooth(pixels),positions=[],uv=[],segments=110;
  for(let i=0;i<=segments;i++){const t=i/segments,p=curve.getPoint(t),d=curve.getTangent(t),n=new THREE.Vector3(-d.z,0,d.x).normalize();for(let j=0;j<2;j++){const v=p.clone().addScaledVector(n,range[j]);positions.push(v.x,y,v.z);uv.push(i/segments*18,j);}}
  const indices=[];for(let i=0;i<segments;i++){let a=i*2;indices.push(a,a+2,a+1,a+1,a+2,a+3);}const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();const m=new THREE.Mesh(g,material);m.name=name;m.userData={stripRange:[...range],elevation:y};m.receiveShadow=true;ground.add(m);return curve;
 }
 for(const [key,width] of [['east',13.5],['diagonal',13.0]]){
  const pixels=ROAD_PATHS[key],name=key==='east'?'右侧主路':'下方斜向道路',half=width/2;
  // Road, curbs and sidewalks occupy adjacent bands rather than stacked sheets.
  for(const sign of [-1,1]){
   const range=(a,b)=>sign<0?[-b,-a]:[a,b],side=sign<0?'左':'右';
   ribbon(name+side+'侧路缘',pixels,.20,edge,.045,range(half,half+.20));
   ribbon(name+side+'侧人行道',pixels,2.55,paver,.060,range(half+.20,half+2.75));
  }
  const curve=ribbon(name,pixels,width,road,.025);paths.push({curve,width:width+5.7});
  for(let i=.015;i<.99;i+=.032){const a=curve.getPoint(i),b=curve.getPoint(Math.min(i+.014,1)),d=b.clone().sub(a);const mark=new THREE.Mesh(new THREE.PlaneGeometry(.10,d.length()),roadMark);mark.rotation.x=-Math.PI/2;mark.rotation.z=Math.atan2(d.x,d.z);mark.position.copy(a).add(b).multiplyScalar(.5);mark.position.y=.045;mark.name='道路虚线';ground.add(mark);}
 }
 for(const [key,width] of [['inner',1.6],['branch',1.5],['connector',2.0],['southern',1.5]]){
  const pixels=ROAD_PATHS[key],half=width/2;
  for(const [side,range] of [['左',[-half-.07,-half]],['右',[half,half+.07]]])ribbon('园内曲线路缘 '+side+' '+key,pixels,.07,edge,.015,range);
  const curve=ribbon('浅灰园路 '+key,pixels,width,paver,.015);paths.push({curve,width:width+.3});
 }
 const forecourt=[[276,350],[350,355],[420,337],[472,305],[538,283],[585,301],[572,344],[533,381],[494,419],[450,448],[380,445],[336,416],[280,409]];
 const plaza=flatMesh(ground,'内弧侧不规则铺装前场',forecourt,.018,paver);
 // Subtle joints, clipped visually within the irregular paved forecourt.
 for(const pixels of [[[329,367],[381,435]],[[373,357],[426,442]],[[420,340],[468,424]],[[467,316],[507,390]]])ribbon('前场铺装分缝',pixels,.025,new THREE.MeshBasicMaterial({color:0xa9b19f,side:THREE.DoubleSide}),.022);
 const samplePoints=paths.flatMap(p=>Array.from({length:90},(_,i)=>({point:p.curve.getPoint(i/89),half:p.width/2})));
 function isPaved(x,z){if(samplePoints.some(s=>(s.point.x-x)**2+(s.point.z-z)**2<(s.half+.2)**2))return true;
  let inside=false;const px=x/SITE.metresPerPixel+560,pz=z/SITE.metresPerPixel+455;for(let i=0,j=forecourt.length-1;i<forecourt.length;j=i++){const a=forecourt[i],b=forecourt[j];if((a[1]>pz)!==(b[1]>pz)&&px<(b[0]-a[0])*(pz-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside;
 }
 return {isPaved,paths,plaza};
}
export function nearCanopy(x,z,padding=6){for(let i=0;i<=48;i++){const p=curveAt(i/48);if((p.x-x)**2+(p.z-z)**2<padding**2)return true;}return false;}
export function localView(position,target){return {position:bendPoint(new THREE.Vector3(...position)).toArray(),target:bendPoint(new THREE.Vector3(...target)).toArray()};}
