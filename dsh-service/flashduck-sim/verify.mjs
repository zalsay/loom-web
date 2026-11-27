import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const here = new URL('./', import.meta.url),
  read = (p, enc) => readFile(new URL(p, here), enc);
const mime = {
  html: 'text/html',
  js: 'text/javascript',
  data: 'application/octet-stream',
  wasm: 'application/wasm',
};
const assets = new Map();
for (const line of (await read('runtime.sha256', 'utf8')).trim().split('\n')) {
  const [hash, name] = line.split(/\s+/);
  const bytes = await read('.runtime/' + name);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), hash, `runtime hash ${name}`);
  assets.set('/' + name, bytes);
}
const client = await read('client.lua', 'utf8'),
  test = await read('contract.lua', 'utf8');
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/') {
    res.setHeader('Content-Type', 'text/html');
    res.end(
      '<script>window.events=[];onmessage=e=>{if(e.origin===location.origin&&e.source===frames[0])events.push(e.data)}</script><iframe src="/esp_claw_sim.html?embedded=1"></iframe>',
    );
    return;
  }
  const bytes = assets.get(path);
  if (!bytes) {
    res.writeHead(404).end();
    return;
  }
  res.setHeader('Content-Type', mime[path.split('.').pop()]);
  res.end(bytes);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
let browser, gateway, peer;
const results = [];
try {
  browser = await chromium.launch(
    process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' },
  );
  const page = await browser.newPage();
  const local = `http://127.0.0.1:${server.address().port}`;
  const replay = process.argv.includes('--loopback');
  const token = 'simulation-only-' + randomUUID();
  if (replay) {
    const { createDuckBridge, duckChat } = await import('../flashduck/bridge.mjs');
    const { startMockDuck } = await import('../flashduck/mock-peer.mjs');
    peer = await startMockDuck();
    gateway = createDuckBridge({ token, send: duckChat(peer.url), mode: 'simulation' });
    await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
  }
  const origin = replay
    ? `http://127.0.0.1:${gateway.address().port}`
    : 'https://bridge.example.invalid';
  const id = 'sim-' + randomUUID();
  await page.goto(local);
  await page.waitForFunction(() => events.some((e) => e.type === 'esp-claw-sim:ready'));
  async function run(
    name,
    action,
    expected,
    { method = 'POST', status = 202, reply, requestId = id, calls = 1, extra = {} } = {},
  ) {
    const command = { duckId: 'duck-1', requestId, action, ...extra };
    const scenario = { name, origin, command, expected, calls, method };
    const fixture =
      reply ??
      JSON.stringify({ ...command, status: expected, motionVerified: false, mode: 'simulation' });
    const app = {
      id: 'duck',
      entry: '/duck/contract.lua',
      root: '/duck',
      peripherals: [],
      files: [
        ['client.lua', client],
        ['contract.lua', test],
        ['scenario.json', JSON.stringify(scenario)],
      ].map(([path, text]) => ({ path: '/duck/' + path, text })),
      capabilityMocks: {
        http_request: [
          {
            method,
            url: origin + '/v1/duck/commands' + (method === 'GET' ? '/' + requestId : ''),
            status,
            body: fixture,
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
    const events = await page.evaluate(() => window.events);
    const msgs = events.map((e) => e.message ?? '');
    assert(
      events.some((e) => e.type === 'esp-claw-sim:exited' && e.code === 0) &&
        msgs.some((s) => s.includes('DUCK_PASS ' + name + ' ' + expected)),
      JSON.stringify(events),
    );
    results.push({ name, observed: expected, luaCalls: calls, wasmExit: 0 });
    const wire = msgs.find((s) => s.includes('DUCK_WIRE '));
    return wire && JSON.parse(wire.split('DUCK_WIRE ')[1]);
  }
  const left = await run('left-accepted', 'look_left', 'accepted');
  await run('right-replied', 'look_right', 'replied');
  await run('stop-accepted', 'stop', 'accepted');
  await run('unknown-state', 'look_left', 'unknown');
  await run('failed-state', 'look_left', 'failed');
  await run('invalid-action', 'spin', 'invalid_command', { calls: 0 });
  await run('denied', 'look_left', 'http_401', { status: 401, reply: 'Unauthorized' });
  await run('bad-json', 'look_left', 'invalid_response', { reply: '{' });
  await run('wrong-id', 'look_left', 'invalid_response', {
    reply: JSON.stringify({
      action: 'look_left',
      duckId: 'duck-1',
      requestId: 'wrong',
      status: 'accepted',
    }),
  });
  const walk = await run('walk-disabled', 'walk_step', 'http_403', {
    status: 403,
    reply: '{"error":"walk_disabled"}',
    requestId: id + '-w',
  });
  await run('extra-url', 'look_left', 'invalid_command', {
    extra: { url: 'https://other.invalid' },
    calls: 0,
  });
  await run('motion-claim', 'look_left', 'invalid_response', {
    reply: JSON.stringify({
      duckId: 'duck-1',
      requestId: id,
      action: 'look_left',
      status: 'replied',
      mode: 'simulation',
      motionVerified: true,
    }),
  });
  const poll = await run('poll-replied', 'look_left', 'replied', { method: 'GET', status: 200 });
  if (replay) {
    assert.equal(left.url, origin + '/v1/duck/commands');
    const response = await fetch(left.url, {
      method: left.method,
      headers: { 'Content-Type': left.contentType, Authorization: 'Bearer ' + token },
      body: left.body,
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    assert(response.ok, `loopback gateway HTTP ${response.status}`);
    const reply = await response.text(),
      status = JSON.parse(reply).status;
    assert(['accepted', 'replied'].includes(status));
    await run('loopback-replay', 'look_left', status, { status: response.status, reply });
    let final;
    for (let attempt = 0; attempt < 20; attempt++) {
      assert.equal(poll.url, left.url + '/' + id);
      assert.equal(poll.method, 'GET');
      const r = await fetch(poll.url, {
        method: poll.method,
        headers: { Authorization: 'Bearer ' + token },
        redirect: 'error',
        signal: AbortSignal.timeout(1000),
      });
      assert.equal(r.status, 200);
      final = await r.json();
      if (final.status !== 'accepted') break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(final.status, 'replied');
    assert.equal(final.motionVerified, false);
    assert.equal(final.mode, 'simulation');
    await run('loopback-poll', 'look_left', 'replied', {
      method: 'GET',
      status: 200,
      reply: JSON.stringify(final),
    });
    assert.equal(walk.url, left.url);
    const denied = await fetch(walk.url, {
      method: walk.method,
      headers: { 'Content-Type': walk.contentType, Authorization: 'Bearer ' + token },
      body: walk.body,
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    assert.equal(denied.status, 403);
    const reason = await denied.text();
    assert.equal(JSON.parse(reason).error, 'walk_disabled');
    await run('loopback-walk-disabled', 'walk_step', 'http_403', {
      status: 403,
      requestId: id + '-w',
      reply: reason,
    });
    assert.equal(peer.frames.length, 1);
    assert.equal(peer.frames[0].type, 'message');
    console.log(
      'Actual loopback: POST',
      response.status,
      status,
      '→ GET 200',
      final.status,
      '; WS frames:',
      peer.frames.length,
      '; motionVerified:',
      final.motionVerified,
      '(Node replay; not WASM network)',
    );
  }
  console.log(
    JSON.stringify(
      { browser: browser.version(), runtime: 'official ESP-Claw WASM, SHA256 checked', results },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  peer?.close();
  if (gateway) await new Promise((resolve) => gateway.close(resolve));
  await new Promise((resolve) => server.close(resolve));
}
