// User-measured INTERNAL distances, in metres. Treat the two unequal sides as
// concentric arc lengths and the width as their radial separation. The overall
// 30 m measurement is a centreline chord, not 30 m plus a rounded end cap.
const pandaSideLength = 7.6;
const oppositeSideLength = 6.5;
const width = 7;
const clearHeight = 2.5;
const angle = (pandaSideLength - oppositeSideLength) / width;
const centerlineLength = (pandaSideLength + oppositeSideLength) / 2;
const centerRadius = centerlineLength / angle;
const startX = -16.73;
const endX = startX + centerlineLength;
const floorY = 0.13;
const entryLength = 1.75;

export const GLASS_ROOM = Object.freeze({
  pandaSideLength,
  oppositeSideLength,
  width,
  clearHeight,
  angle,
  centerRadius,
  innerRadius: centerRadius - width / 2,
  outerRadius: centerRadius + width / 2,
  centerlineLength,
  startX,
  endX,
  centerX: (startX + endX) / 2,
  floorY,
  ceilingY: floorY + clearHeight,
  entryLength,
  storeWidth: centerlineLength - entryLength,
  storeCenterX: (startX + endX - entryLength) / 2,
  partitionX: endX - entryLength,
});

const pavilionStartX = -17;
const chordLength = 30;
const length = 2 * centerRadius * Math.asin(chordLength / (2 * centerRadius));
const pavilionWidth = 7.8;
const columnDepth = 0.48;
const columnOffset = 3.47;
const triangleClearBase = 4;
// Four metres is the clear chord BETWEEN the two white feet, not their outer
// span. Keep the existing estimated foot widths in addition to that opening.
// The inner facade shares angular stations and is proportionally shorter.
const columnFootWidth = 0.48;
const clearArchSpan =
  2 *
  centerRadius *
  Math.asin(triangleClearBase / (2 * (centerRadius + columnOffset + columnDepth / 2)));
const archSpan = clearArchSpan + 2 * columnFootWidth;
const triangleCount = 5.5;
// The diagonals start over the glass room, as in the original pavilion. Their
// last half bay intentionally stops before the rounded end of the whole roof.
const moduleStartX = GLASS_ROOM.startX;
const moduleEndX = moduleStartX + triangleCount * archSpan;
const soffitY = 2.74;
const roofThickness = 0.7;
export const PAVILION = Object.freeze({
  startX: pavilionStartX,
  endX: pavilionStartX + length,
  capCenterX: pavilionStartX + length - pavilionWidth / 2,
  chordLength,
  length,
  width: pavilionWidth,
  roofThickness,
  roofBodyTop: soffitY + roofThickness - 0.045,
  roofBodyDepth: roofThickness - 0.045,
  roofTop: soffitY + roofThickness,
  soffitY,
  columnDepth,
  columnOffset,
  triangleClearBase,
  columnFootWidth,
  clearArchSpan,
  triangleCount,
  archSpan,
  moduleStartX,
  moduleEndX,
  terminalClearLength: pavilionStartX + length - moduleEndX,
});

export const LOUVER = Object.freeze({
  width: 2.2,
  depth: 1.6,
  centerX: (GLASS_ROOM.partitionX + GLASS_ROOM.endX) / 2,
  // A rigid cuboid needs a small curvature allowance at its outer corners.
  centerZ: width / 2 - 2.2 / 2 - 0.02,
});
export const ENTRANCE = Object.freeze({
  clearWidth: 1.6,
  oppositeOffset: 1.6,
  facadeWidth: width - LOUVER.width,
  jambWidth: 0.037,
});
