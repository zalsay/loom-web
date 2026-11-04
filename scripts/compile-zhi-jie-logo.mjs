import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = await readFile(resolve(root, 'web/assets/zhi-jie-logo.svg'), 'utf8');
const sourceSha256 = createHash('sha256').update(source).digest('hex');

const parseAttributes = (text) =>
  Object.fromEntries(
    [...text.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)].map((match) => [match[1], match[2]]),
  );

const elements = [];
const stack = [];
const defaults = {
  fill: '#000000',
  stroke: 'none',
  strokeWidth: 1,
  linecap: 'butt',
  linejoin: 'miter',
  translateX: 0,
  translateY: 0,
  hidden: false,
};

for (const match of source.matchAll(/<\/?([A-Za-z][\w:-]*)\b([^>]*?)\/?\s*>/g)) {
  const [, tag, body] = match;
  if (match[0].startsWith('</')) {
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      const entry = stack.pop();
      if (entry.tag === tag) break;
    }
    continue;
  }

  const attrs = parseAttributes(body);
  const parent = stack.at(-1)?.state ?? defaults;
  const transform = attrs.transform?.match(/^translate\(\s*(-?[\d.]+)(?:[ ,]+(-?[\d.]+))?\s*\)$/);
  const state = {
    fill: attrs.fill ?? parent.fill,
    stroke: attrs.stroke ?? parent.stroke,
    strokeWidth: Number(attrs['stroke-width'] ?? parent.strokeWidth),
    linecap: attrs['stroke-linecap'] ?? parent.linecap,
    linejoin: attrs['stroke-linejoin'] ?? parent.linejoin,
    translateX: parent.translateX + (transform ? Number(transform[1]) : 0),
    translateY: parent.translateY + (transform ? Number(transform[2] ?? 0) : 0),
    hidden: parent.hidden || tag === 'defs',
  };

  if (['path', 'rect', 'circle'].includes(tag) && !state.hidden) {
    const common = {
      index: elements.length,
      tag,
      transform: [state.translateX, state.translateY],
      fill: state.fill,
      stroke: state.stroke,
      strokeWidth: state.strokeWidth,
      linecap: state.linecap,
      linejoin: state.linejoin,
    };
    if (tag === 'path') elements.push({ ...common, d: attrs.d });
    if (tag === 'rect')
      elements.push({
        ...common,
        x: Number(attrs.x ?? 0),
        y: Number(attrs.y ?? 0),
        width: Number(attrs.width),
        height: Number(attrs.height),
      });
    if (tag === 'circle')
      elements.push({
        ...common,
        cx: Number(attrs.cx),
        cy: Number(attrs.cy),
        r: Number(attrs.r),
      });
  }

  const selfClosing = /\/\s*>$/.test(match[0]);
  if (!selfClosing) stack.push({ tag, state });
}

const output = `// Generated from web/assets/zhi-jie-logo.svg by scripts/compile-zhi-jie-logo.mjs. Do not edit by hand.\nexport const ZHI_JIE_SOURCE_SHA256 =\n  '${sourceSha256}';\nexport const ZHI_JIE_SOURCE_ELEMENT_COUNT = ${elements.length};\n// prettier-ignore\nexport const ZHI_JIE_SOURCE_ELEMENTS = ${JSON.stringify(elements)};\n`;
process.stdout.write(output);
