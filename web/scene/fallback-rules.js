// Overrides for the simplified SVG renderer used when WebGL2 is unavailable.
// That renderer has no depth buffer or shadows, so draw order is set by hand
// and large ground surfaces get flat colors. Rules match mesh names from
// model.js and site-layout.js; in each list the first matching rule wins.

const HIDDEN = /^疏朗树叶$|吊顶格栅|吊顶底板|屋面板接缝/;

// Lower values are painted first.
const DRAW_ORDER = [
  [/^草坪地面$/, -5],
  [/标线|分隔线|沿路缘白线|道路虚线|铺装分缝/, -2],
  [/人行道|路缘/, -4],
  [/沥青|道路|园路|铺装前场/, -3],
];

// Large faces are split so the painter's sort works on smaller pieces.
// The scaled group has its object scale baked into the geometry first.
const TESSELLATE_SCALED = /栅格区封闭内体|封闭侧墙/;
const TESSELLATE = /屋面|顶板|沥青路面|弧形路缘/;

// Roof shells drop the faces pointing one way so they don't paint over each other.
const DROP_FACES = [
  [/屋面顶板与金属压边/, 'down'],
  [/屋面与白色檐口/, 'up'],
];

function match(rules, name) {
  return rules.find(([pattern]) => pattern.test(name))?.[1] ?? null;
}

function flatColor(name, materialName) {
  if (/沥青|园路$/.test(name)) return { color: 0x8a918b, doubleSide: true };
  if (materialName === '市政道路沥青') return { color: 0x7b847d, doubleSide: true };
  if (name === '草坪地面') return { color: 0xa6af7d, doubleSide: false };
  return null;
}

export function fallbackPlan(name, materialName) {
  if (HIDDEN.test(name)) return { hidden: true };
  return {
    hidden: false,
    renderOrder: match(DRAW_ORDER, name),
    flatColor: flatColor(name, materialName),
    flatLawn: name === '草坪地面',
    tessellate: TESSELLATE_SCALED.test(name) ? 'scaled' : TESSELLATE.test(name) ? 'plain' : null,
    dropFaces: match(DROP_FACES, name),
  };
}
