// Chromium exercises the real phone page and sends JPEG bytes over HTTP to a fixture, not a physical Pad.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile, mkdtemp, writeFile, readdir } from 'node:fs/promises';
import { chromium, webkit } from 'playwright';
const fixture = await mkdtemp(join(tmpdir(), 'loom-pad-photo-'));
const compiled = join(fixture, 'save');
execFileSync(
  process.env.CC || 'cc',
  [
    '-std=gnu11',
    '-Icomponent/test/stubs',
    '-Icomponent/include',
    '-Icomponent',
    'component/upload.c',
    'browser/save-photo.c',
    '-o',
    compiled,
  ],
  { cwd: fileURLToPath(new URL('..', import.meta.url)) },
);
await writeFile(join(fixture, 'current.id'), 'demo\n');
const html = await readFile(new URL('./upload-form.html', import.meta.url));
const tokenPath = '/u/' + 'a'.repeat(32) + '/';
let outcome = 'ok';
const uploads = [],
  ids = new Set();
const s = createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === tokenPath) {
    res.writeHead(200, {
      'Content-Type': 'text/html;charset=utf-8',
      'Content-Security-Policy':
        "default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; img-src blob:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    });
    return res.end(html);
  }
  if (req.url !== tokenPath + 'photo' || req.method !== 'POST') return res.writeHead(404).end();
  const parts = [];
  for await (const chunk of req) parts.push(chunk);
  uploads.push({ headers: req.headers, data: Buffer.concat(parts) });
  const key = req.headers['x-upload-id'];
  assert.match(key, /^[0-9a-f]{32}$/);
  if (ids.has(key)) return res.writeHead(409).end();
  ids.add(key);
  if (outcome === 'lost') return res.destroy();
  if (outcome === 'expired') return res.writeHead(404).end();
  if (outcome === 'ok') {
    try {
      execFileSync(compiled, [fixture, String(uploads.at(-1).data.length)], {
        input: uploads.at(-1).data,
      });
    } catch {
      return res.writeHead(415).end();
    }
  }
  res
    .writeHead(201, { 'Content-Type': 'application/json' })
    .end(JSON.stringify({ saved: outcome === 'ok' }));
});
let b;
try {
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  const origin = `http://127.0.0.1:${s.address().port}`;
  b = process.env.TEST_WEBKIT
    ? await webkit.launch()
    : await chromium.launch({ channel: 'chrome' });
  const p = await b.newPage({ viewport: { width: 390, height: 844 } });
  const offsite = [];
  await p.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    offsite.push(route.request().url());
    return route.abort();
  });
  await p.goto(origin + tokenPath);
  const png = Buffer.from(
    await p.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 2600;
      c.height = 1600;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#34c';
      ctx.fillRect(0, 0, 2600, 1600);
      return c.toDataURL().split(',')[1];
    }),
    'base64',
  );
  async function choose() {
    await p
      .locator('#pick')
      .setInputFiles({ name: 'private-photo.png', mimeType: 'image/png', buffer: png });
    await p.waitForFunction(() => !document.querySelector('#send').disabled);
  }
  async function expectText(fragment) {
    await p.waitForFunction(
      (t) => document.querySelector('#status').textContent.includes(t),
      fragment,
    );
  }
  await choose();
  assert.equal(await p.locator('#preview').evaluate((im) => im.naturalWidth), 1600);
  assert.equal(uploads.length, 0);
  await p.locator('#send').click();
  await expectText('已收到并保存');
  const album = join(fixture, 'demo', 'photos');
  assert.deepEqual(await readdir(album), ['00000001.jpg']);
  assert.deepEqual(await readFile(join(album, '00000001.jpg')), uploads[0].data);
  assert.equal(uploads[0].headers.origin, origin);
  assert.equal(uploads[0].headers['content-type'], 'image/jpeg');
  assert.deepEqual([...uploads[0].data.subarray(0, 3)], [255, 216, 255]);
  assert(uploads[0].data.length <= 1048576);
  assert.equal(uploads[0].headers['content-length'], String(uploads[0].data.length));
  assert(!uploads[0].data.includes('private-photo'));
  for (const [mode, text] of [
    ['expired', '重新扫码'],
    ['malformed', '没有收到保存确认'],
    ['lost', '不会自动重传'],
  ]) {
    outcome = mode;
    const n = uploads.length;
    await choose();
    await p.locator('#send').click();
    await expectText(text);
    assert(await p.locator('#send').isDisabled());
    assert.deepEqual(new Set(uploads.slice(n).map((up) => up.headers['x-upload-id'])).size, 1);
  }
  const n = uploads.length;
  await p
    .locator('#pick')
    .setInputFiles({
      name: 'bad.heic',
      mimeType: 'image/heic',
      buffer: Buffer.from('not an image'),
    });
  await expectText('导出 JPEG');
  assert(await p.locator('#send').isDisabled());
  assert.equal(uploads.length, n);
  assert.deepEqual(offsite, []);
  console.log(
    `PASS ${b.browserType().name()} ${b.version()}: local resize 2600→1600, JPEG, explicit upload/ack, expired & ambiguous failures, no automatic resend, unreadable HEIC, no remote requests. actual C JPEG storage byte-for-byte on host filesystem; HTTP fixture, not physical Safari/SD.`,
  );
} finally {
  await b?.close();
  s.closeAllConnections();
  await new Promise((ok) => s.close(ok));
}
