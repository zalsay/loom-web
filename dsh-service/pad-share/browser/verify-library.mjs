// Real firmware renderer + loopback HTTP fixture. Does not claim to test Metalio/iPad hardware.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { chromium, webkit } from 'playwright';
const work = mkdtempSync(join(tmpdir(), 'loom-ipad-library-'));
const binary = join(work, 'render'),
  root = join(work, 'project');
const cwd = fileURLToPath(new URL('..', import.meta.url));
execFileSync(
  process.env.CC || 'cc',
  [
    '-std=gnu11',
    '-Icomponent/test/stubs',
    '-Icomponent/include',
    '-Icomponent',
    'component/library.c',
    'component/snapshot.c',
    'component/upload.c',
    'browser/render-library.c',
    '-o',
    binary,
  ],
  { cwd },
);
mkdirSync(join(root, 'demo/cards'), { recursive: true });
mkdirSync(join(root, 'other/cards'), { recursive: true });
writeFileSync(join(root, 'current.id'), 'demo\n');
writeFileSync(join(root, 'current.html'), '<p>PRIVATE_GLOBAL</p>');
writeFileSync(join(root, 'other/cards/private.html'), 'PRIVATE_OTHER');
for (let i = 1; i <= 14; i++)
  writeFileSync(
    join(root, 'demo/cards', `${String(i).padStart(2, '0')}-实验.html`),
    `<h1>第${i}次实验</h1><p>看一下转轴</p><script>window.ran=true</script><a href="https://example.invalid/test">文字</a>`,
  );
const path = execFileSync(binary, [root, 'ROOT'], { encoding: 'utf8' }).trim();
const serve = createServer((req, res) => {
  const r = spawnSync(binary, [root, req.url], { encoding: 'utf8' });
  if (r.status !== 0) return res.writeHead(404).end();
  res
    .writeHead(200, { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' })
    .end(r.stdout);
});
let b;
try {
  await new Promise((ok) => serve.listen(0, '127.0.0.1', ok));
  const origin = `http://127.0.0.1:${serve.address().port}`;
  b = process.env.TEST_WEBKIT
    ? await webkit.launch()
    : await chromium.launch({ channel: 'chrome' });
  const page = await b.newPage({ viewport: { width: 820, height: 1180 } });
  await page.goto(origin + path);
  const links = page.locator('a[href]');
  assert((await links.count()) >= 13);
  assert.doesNotMatch(await page.locator('body').innerText(), /PRIVATE/);
  const open = async (suffix) => {
    const link = links.filter({ hasText: suffix });
    assert.equal(await link.count(), 1);
    await link.click();
  };
  await open('01-实验');
  assert.equal(await page.locator('h1').filter({ hasText: '第1次实验' }).count(), 1);
  assert.equal(await page.locator('script,a[href^="https:"]').count(), 0);
  await links.first().click();
  await page.locator('a[href$="p2"]').click();
  await open('14-实验');
  assert.match(await page.locator('body').innerText(), /第14次实验/);
  await links.first().click();
  assert.equal(new URL(page.url()).pathname, path + 'p2');
  console.log(
    `PASS ${b.browserType().name()} ${b.version()}: list 14 Chinese cards, first and second page → detail → list, no unrelated card or active source link (real C renderer; loopback fixture).`,
  );
} finally {
  await b?.close();
  serve.closeAllConnections();
  await new Promise((ok) => serve.close(ok));
}
