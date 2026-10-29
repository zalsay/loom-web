import { readdir, readFile, access } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const web = path.join(root, 'web');
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((entry) =>
        entry.isDirectory()
          ? files(path.join(directory, entry.name))
          : path.join(directory, entry.name),
      ),
    )
  ).flat();
}
const all = [
  ...(await files(path.join(web, 'js'))),
  ...(await files(path.join(web, 'scene'))),
  ...(await files(path.join(root, 'scripts'))),
];
for (const file of all)
  if (/\.(m?js)$/.test(file)) execFileSync(process.execPath, ['--check', file]);
for (const file of await files(web)) {
  if (!/\.(html|js|css)$/.test(file) || file.includes(`${path.sep}vendor${path.sep}`)) continue;
  const content = await readFile(file, 'utf8');
  const expressions = file.endsWith('.html')
    ? [/\b(?:src|href)="(\.\.?\/[^"?#]+)(?:[?#][^"]*)?"/g]
    : file.endsWith('.js')
      ? [/\bfrom\s+['"](\.\.?\/[^'"]+)['"]/g]
      : [];
  for (const expression of expressions)
    for (const match of content.matchAll(expression))
      await access(path.resolve(path.dirname(file), match[1]));
}
for (const module of [
  'three.module.js',
  'three.core.js',
  'addons/controls/OrbitControls.js',
  'addons/renderers/SVGRenderer.js',
  'addons/renderers/Projector.js',
  'addons/modifiers/TessellateModifier.js',
  'THREE-LICENSE.txt',
])
  await access(path.join(web, 'vendor', module));
// Compare formatting-insensitive copies so the checks pass on both formatted and minified sources.
const stylesheet = (await readFile(path.join(web, 'styles.css'), 'utf8'))
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s*([{}:;,()])\s*/g, '$1');
const homepage = (await readFile(path.join(web, 'index.html'), 'utf8')).replace(/\s+/g, ' ');
const favicon = await readFile(path.join(web, 'favicon.svg'), 'utf8');
const accent = stylesheet.match(/--accent:(#[a-f0-9]{6})/i)?.[1];
assert.ok(accent, 'The website must define its emphasis accent');
assert.match(
  stylesheet,
  /\.serif-accent\{[^}]*color:var\(--accent\)/,
  'Emphasized text must share its accent with the logo background',
);
assert.match(
  stylesheet,
  /\.brand\{[^}]*background:var\(--accent\)/,
  'Logo backgrounds must reuse the website accent',
);
const logoBackgrounds = [...stylesheet.matchAll(/(?:^|})\s*\.brand\{([^}]*)\}/g)].flatMap((rule) =>
  [...rule[1].matchAll(/(?:^|;)background:([^;}]*)/g)].map((match) => match[1]),
);
assert.deepEqual(
  logoBackgrounds,
  ['var(--accent)'],
  'Logo accent must not be overridden by a later background rule',
);
assert.equal(
  (homepage.match(/<img class="brand-logo" src="\.\/assets\/zhi-jie-logo\.svg"/g) || []).length,
  2,
  'Header and footer must use the same Zhi Jie logo',
);
assert.equal(
  favicon.match(/<rect\b[^>]*fill="([^"]+)"/)?.[1],
  accent,
  'Favicon background must match the website accent',
);
console.log(`Validated ${all.length} source files and local resource references.`);
