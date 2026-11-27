// Reuse the original pinned ESP-Claw GUI embedding assets; never modify them.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const read = (name, enc) => readFile(new URL(name, import.meta.url), enc);
const pinned = '../../flashduck-sim/',
  assets = new Map();
for (const line of (await read(pinned + 'runtime.sha256', 'utf8')).trim().split('\n')) {
  const [hash, name] = line.split(/\s+/),
    bytes = await read(pinned + '.runtime/' + name);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, name);
  assets.set('/' + name, bytes);
}
const files = await Promise.all(
  ['contract.lua', 'duck_look.lua', 'trusted_host.lua', 'duck_scan.lua', 'scan_contract.lua'].map(
    async (n) => ({
      path: '/duck/' + n,
      text: await read(n, 'utf8'),
    }),
  ),
);
const spec = JSON.parse(await read('duck_look.json', 'utf8')).function;
assert.equal(spec.name, 'duck_look');
assert.deepEqual(Object.keys(spec.parameters.properties), ['direction']);
assert.deepEqual(spec.parameters.required, ['direction']);
assert.equal(spec.parameters.additionalProperties, false);
assert.deepEqual(spec.parameters.properties.direction.enum, [
  'left',
  'slight_left',
  'center',
  'slight_right',
  'right',
]);
const mime = {
  html: 'text/html',
  js: 'text/javascript',
  wasm: 'application/wasm',
  data: 'application/octet-stream',
};
const gui = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/')
    return res
      .writeHead(200, { 'Content-Type': 'text/html' })
      .end(
        '<script>window.events=[];onmessage=e=>{if(e.origin===location.origin&&e.source===frames[0])events.push(e.data)}</script><iframe src="/esp_claw_sim.html?embedded=1"></iframe>',
      );
  if (!assets.has(path)) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': mime[path.split('.').pop()] }).end(assets.get(path));
});
let browser, bridge;
const replay = process.argv.includes('--loopback'),
  token = randomUUID(),
  id = 'pad-' + randomUUID();
try {
  if (replay) {
    const { startService } = await import('../serve.mjs');
    bridge = await startService({ DUCK_PAD_TOKEN: token, DUCK_PORT: '0' });
  }
  const origin = bridge?.origin ?? 'https://bridge.example.invalid';
  if (bridge) assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  await new Promise((resolve) => gui.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch(
    process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' },
  );
  console.log(`Chrome ${browser.version()}; pinned ${assets.size} ESP-Claw GUI assets verified`);
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${gui.address().port}`);
  await page.waitForFunction(() => events.some((e) => e.type === 'esp-claw-sim:ready'));
  let passed = 0;
  const row = (direction, status) => ({
    duckId: 'duck-demo',
    requestId: id,
    direction,
    status,
    motionVerified: false,
    mode: 'simulation',
  });
  async function run(name, direction, expected, options = {}) {
    const {
      method = 'POST',
      http = 202,
      body = JSON.stringify({ ...row(direction, expected), unsolicited: 'ignore' }),
      args = { direction },
      requestId = id,
      calls = 1,
      transportFailure = false,
    } = options;
    const success = ['accepted', 'command_finished', 'failed', 'unknown'].includes(expected);
    const s = { origin, args, method, id: requestId, calls, transportFailure, success, expected };
    const app = {
      id: 'duck',
      root: '/duck',
      entry: '/duck/contract.lua',
      peripherals: [],
      files: [...files, { path: '/duck/scenario.json', text: JSON.stringify(s) }],
      capabilityMocks: {
        http_request: [
          {
            method,
            url: origin + '/v1/duck/look' + (method === 'GET' ? '/' + requestId : ''),
            status: http,
            body,
          },
        ],
      },
    };
    await page.evaluate((app) => {
      events.length = 0;
      frames[0].postMessage({ type: 'esp-claw-sim:mountApp', app }, location.origin);
      frames[0].postMessage({ type: 'esp-claw-sim:runApp', path: app.entry }, location.origin);
    }, app);
    await page.waitForFunction(
      () => events.some((e) => ['esp-claw-sim:error', 'esp-claw-sim:exited'].includes(e.type)),
      null,
      { timeout: 15000 },
    );
    const ev = await page.evaluate(() => window.events),
      msgs = ev.map((e) => e.message ?? '');
    const mark = (tag) => {
      const m = msgs.find((v) => v.includes(tag));
      return m && JSON.parse(m.split(tag)[1]);
    };
    assert(
      ev.some((e) => e.type === 'esp-claw-sim:exited' && e.code === 0),
      JSON.stringify(ev),
    );
    const result = mark('RESULT ');
    assert(result && result.motionVerified === false, JSON.stringify(ev));
    assert.equal(result.status ?? result.error, expected);
    passed++;
    console.log(`PASS ${name}: ${expected}; WASM exit=0, Lua capability calls=${calls}`);
    return mark('WIRE ');
  }
  const scanApp = {
    id: 'duck',
    root: '/duck',
    entry: '/duck/scan_contract.lua',
    files,
    peripherals: [],
  };
  await page.evaluate((app) => {
    events.length = 0;
    frames[0].postMessage({ type: 'esp-claw-sim:mountApp', app }, location.origin);
    frames[0].postMessage({ type: 'esp-claw-sim:runApp', path: app.entry }, location.origin);
  }, scanApp);
  await page.waitForFunction(
    () => events.some((e) => ['esp-claw-sim:error', 'esp-claw-sim:exited'].includes(e.type)),
    null,
    { timeout: 15000 },
  );
  const scanEvents = await page.evaluate(() => window.events);
  assert(
    scanEvents.some((e) => e.type === 'esp-claw-sim:exited' && e.code === 0) &&
      scanEvents.some((e) => e.message?.includes('SCAN_PASS')),
    JSON.stringify(scanEvents),
  );
  passed++;
  console.log(
    'PASS scan: ordered / cancellation / unknown / timeout / duplicate (Lua mocks, WASM exit=0)',
  );
  await run('left', 'left', 'accepted');
  const post = await run('slight-left', 'slight_left', 'accepted');
  await run('slight-right', 'slight_right', 'accepted');
  await run('right', 'right', 'accepted');
  await run('center', 'center', 'accepted');
  const get = await run('poll', 'slight_left', 'command_finished', { method: 'GET', http: 200 });
  await run('no-feedback', 'right', 'unknown');
  await run('device-failure', 'center', 'failed', { http: 200 });
  await run('deny-walk', 'walk', 'invalid_arguments', { calls: 0 });
  await run('deny-config', 'right', 'invalid_arguments', {
    calls: 0,
    args: { direction: 'right', duckId: 'other' },
  });
  await run('bad-id', 'center', 'invalid_request_id', { calls: 0, requestId: '../x' });
  await run('unauthorized', 'right', 'http_401', { http: 401 });
  await run('timeout-no-retry', 'left', 'transport_unknown', { transportFailure: true });
  await run('malformed', 'right', 'invalid_response', { body: '{' });
  for (const [name, patch] of Object.entries({
    id: { requestId: 'other' },
    duck: { duckId: 'other' },
    direction: { direction: 'right' },
    motion: { motionVerified: true },
    mode: { mode: 'guessed' },
    status: { status: 'replied' },
  })) {
    await run('reject-' + name, 'left', 'invalid_response', {
      body: JSON.stringify({ ...row('left', 'accepted'), ...patch }),
    });
  }
  if (replay) {
    assert.equal(post.url, origin + '/v1/duck/look');
    assert.equal(get.url, post.url + '/' + id);
    const send = async (wire) => {
      const r = await fetch(wire.url, {
        method: wire.method,
        headers: {
          Authorization: 'Bearer ' + token,
          ...(wire.contentType ? { 'Content-Type': wire.contentType } : {}),
        },
        body: wire.body,
        redirect: 'error',
        signal: AbortSignal.timeout(3000),
      });
      return { http: r.status, body: await r.text() };
    };
    const accepted = await send(post);
    assert.equal(accepted.http, 202);
    assert.equal(JSON.parse(accepted.body).status, 'accepted');
    await run('loopback-post', 'slight_left', 'accepted', accepted);
    let final;
    for (let i = 0; i < 30; i++) {
      final = await send(get);
      if (JSON.parse(final.body).status !== 'accepted') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(final.http, 200);
    assert.equal(JSON.parse(final.body).status, 'command_finished');
    await run('loopback-get', 'slight_left', 'command_finished', { method: 'GET', ...final });
    console.log(
      `Loopback Node replay + Lua parse: POST ${accepted.http} accepted -> GET ${final.http} command_finished, mode=simulation, motionVerified=false`,
    );
  }
  console.log(
    `Passed ${passed} official GUI WASM executions. HTTP mocked inside WASM; no model, hardware or deployment.`,
  );
} finally {
  await browser?.close();
  await bridge?.close();
  if (gui.listening) await new Promise((r) => gui.close(r));
}
