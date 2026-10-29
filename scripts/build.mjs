import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { transform } from 'esbuild';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(path.join(root, 'web'), dist, { recursive: true });

// Minify each file in place without bundling, so the import map in world.html still resolves
// modules by their original paths. Legal comments such as the Three.js license are kept.
const files = (await readdir(dist, { recursive: true })).filter((file) => /\.(js|css)$/.test(file));
let before = 0,
  after = 0,
  gzipBefore = 0,
  gzipAfter = 0;
for (const file of files) {
  const target = path.join(dist, file);
  const source = await readFile(target, 'utf8');
  const { code } = await transform(source, {
    loader: file.endsWith('.css') ? 'css' : 'js',
    minify: true,
    sourcefile: file,
  });
  await writeFile(target, code);
  before += Buffer.byteLength(source);
  after += Buffer.byteLength(code);
  gzipBefore += gzipSync(source).length;
  gzipAfter += gzipSync(code).length;
}
const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;
console.log(
  `Built static website in dist/. Minified ${files.length} JS/CSS files: ` +
    `${kb(before)} → ${kb(after)} (gzip ${kb(gzipBefore)} → ${kb(gzipAfter)}).`,
);
