import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createGateway,
  jsonBody,
  send,
  server,
  validateAngles,
  validateOrigin,
} from '../bridge.mjs';
import { createMockDuck } from '../mock-duck.mjs';
import { startService } from '../serve.mjs';

const padToken = 'test-pad-token-only',
  deviceToken = randomBytes(32).toString('hex'),
  angles = { left: 102, center: 90, right: 78 };
const command = { duckId: 'duck-demo', requestId: 'look_1', direction: 'left' };
const look = '/v1/duck/look';
async function api(origin, path, body, token = padToken) {
  const r = await fetch(origin + path, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  return { code: r.status, ...(await r.json()) };
}
async function listen(s) {
  await new Promise((ok, no) => {
    s.once('error', no);
    s.listen(0, '127.0.0.1', ok);
  });
  return `http://127.0.0.1:${s.address().port}`;
}
const stop = (s) => new Promise((ok) => s.close(ok));

test('real loopback Pad → bridge → mock device; no physical verification or forwarded model fields', async (t) => {
  const s = await startService({ DUCK_PAD_TOKEN: padToken, DUCK_PORT: '0' });
  t.after(s.close);
  assert.equal((await api(s.origin, look, command, 'bad')).code, 401);
  assert.equal((await api(s.origin, look, { ...command, duckId: 'another' })).code, 403);
  for (const extra of [
    { angleDeg: 90 },
    { url: 'http://127.0.0.1' },
    { direction: 'dance' },
    { requestId: '../x' },
  ])
    assert.equal((await api(s.origin, look, { ...command, ...extra })).code, 400);
  assert.deepEqual(await api(s.origin, look, command), {
    code: 202,
    ...command,
    mode: 'simulation',
    status: 'accepted',
    motionVerified: false,
  });
  assert.equal((await api(s.origin, look, command)).status, 'accepted');
  assert.equal((await api(s.origin, look, { ...command, direction: 'right' })).code, 409);
  assert.equal((await api(s.origin, look, { ...command, requestId: 'next' })).code, 409);
  await new Promise((ok) => setTimeout(ok, 710));
  assert.equal((await api(s.origin, look + '/look_1', undefined, 'bad')).code, 401);
  assert.deepEqual(await api(s.origin, look + '/look_1'), {
    code: 200,
    ...command,
    mode: 'simulation',
    status: 'command_finished',
    motionVerified: false,
  });
  assert.equal((await api(s.origin, look, command)).status, 'command_finished');
});

test('mock enforces per-unit range, strict payload, session, expiry, arming and duplicate conflicts', async (t) => {
  let now = 100,
    armed = false;
  const d = createMockDuck({ deviceToken, angles, clock: () => now, ready: () => armed });
  const origin = await listen(d);
  t.after(() => stop(d));
  const path = '/control/v1';
  const call = (cmd) => api(origin, path, cmd, deviceToken);
  const state = await api(origin, path + '/status', undefined, deviceToken);
  assert.equal(state.ready, false);
  assert.equal(state.uptimeMs, 0);
  const cmd = {
    v: 1,
    type: 'joint.set',
    requestId: 'sim',
    joint: 'neck',
    angleDeg: 102,
    durationMs: 700,
    sessionId: state.sessionId,
    expiresAtMs: 1000,
  };
  assert.equal((await api(origin, path, cmd, padToken)).code, 401);
  assert.equal((await call(cmd)).code, 409);
  armed = true;
  for (const extra of [
    { angleDeg: 103 },
    { angleDeg: 90.5 },
    { durationMs: 701 },
    { foo: 'x' },
    { joint: 'wing' },
  ])
    assert.equal((await call({ ...cmd, ...extra })).code, 400);
  for (const extra of [{ sessionId: 'f'.repeat(32) }, { expiresAtMs: 0 }, { expiresAtMs: 5001 }])
    assert.equal((await call({ ...cmd, ...extra })).code, 409);
  assert.equal((await call(cmd)).code, 202);
  assert.equal((await call({ ...cmd, angleDeg: 91 })).code, 409);
  now += 699;
  assert.equal((await call(cmd)).status, 'accepted');
  now++;
  assert.equal(
    (await api(origin, path + '/status?id=sim', undefined, deviceToken)).status,
    'command_finished',
  );
});

test('slight looks use half the signed calibrated travel toward each side on loopback', async (t) => {
  const sessionId = '3'.repeat(32),
    commands = [];
  let requests = 0;
  const peer = server(async (req, res) => {
    requests++;
    if (req.method === 'GET')
      return send(res, 200, {
        v: 1,
        ready: true,
        minDeg: 77,
        centerDeg: 90,
        maxDeg: 103,
        sessionId,
        uptimeMs: 42,
        motionVerified: false,
      });
    const body = await jsonBody(req);
    commands.push(body);
    send(res, 200, {
      v: 1,
      sessionId,
      requestId: body.requestId,
      status: 'command_finished',
      motionVerified: false,
    });
  });
  const origin = await listen(peer);
  t.after(() => stop(peer));
  for (const [left, right, expectedLeft, expectedRight] of [
    [103, 79, 96, 85],
    [79, 103, 85, 96],
    [89, 92, null, 91],
    [92, 89, 91, null],
  ]) {
    const gateway = createGateway({
      mode: 'simulation',
      origin,
      duckId: command.duckId,
      angles: { left, center: 90, right },
      deviceToken,
      padToken,
    });
    const url = await listen(gateway);
    try {
      for (const [direction, angleDeg] of [
        ['slight_left', expectedLeft],
        ['slight_right', expectedRight],
      ]) {
        const before = requests;
        const request = { ...command, requestId: direction, direction };
        const reply = await api(url, look, request);
        if (angleDeg === null) {
          assert.deepEqual(reply, { code: 400, error: 'calibration_too_narrow' });
          assert.equal(requests, before);
        } else {
          assert.deepEqual(reply, {
            code: 200,
            ...request,
            mode: 'simulation',
            status: 'command_finished',
            motionVerified: false,
          });
          assert.equal(requests, before + 2);
          assert.deepEqual(commands.at(-1), {
            v: 1,
            type: 'joint.set',
            requestId: direction,
            joint: 'neck',
            angleDeg,
            durationMs: 700,
            sessionId,
            expiresAtMs: 2542,
          });
        }
      }
    } finally {
      await stop(gateway);
    }
  }
});

test('old journals accept slight looks; lost POST response never retries on restart', async (t) => {
  const sessionId = '1'.repeat(32),
    command = { requestId: 'look_1', duckId: 'duck-demo', direction: 'slight_left' };
  let posts = 0,
    badSession = true,
    armed = false,
    wire,
    calibration = {};
  const peer = server(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer ' + deviceToken);
    if (req.url === '/control/v1/status')
      return send(res, 200, {
        v: 1,
        sessionId,
        ready: armed,
        ...calibration,
        uptimeMs: 99,
        motionVerified: false,
      });
    if (req.method === 'POST') {
      posts++;
      wire = await jsonBody(req);
      return res.destroy();
    }
    assert.equal(req.url, '/control/v1/status?id=look_1');
    return send(res, 200, {
      v: 1,
      sessionId: badSession ? '2'.repeat(32) : sessionId,
      requestId: 'look_1',
      status: 'command_finished',
      motionVerified: false,
    });
  });
  const origin = await listen(peer);
  const dir = await mkdtemp(join(tmpdir(), 'duck-ledger-'));
  const config = {
    mode: 'simulation',
    origin,
    deviceToken,
    padToken,
    angles,
    duckId: 'duck-demo',
    journalPath: join(dir, 'journal'),
  };
  const legacy = {
    requestId: 'old_right',
    direction: 'right',
    status: 'command_finished',
    sessionId,
  };
  const binding = { v: 1, mode: 'simulation', origin, duckId: command.duckId, angles };
  await writeFile(
    config.journalPath,
    `${JSON.stringify({ binding })}\n${JSON.stringify(legacy)}\n`,
  );
  let gateway = createGateway(config);
  let url = await listen(gateway);
  t.after(async () => {
    await stop(gateway);
    await stop(peer);
    await rm(dir, { recursive: true });
  });
  assert.throws(() => createGateway(config), /EEXIST/);
  assert.equal((await api(url, look + '/old_right')).status, 'command_finished');
  assert.equal((await api(url, look, command)).code, 503);
  assert.equal(posts, 0);
  armed = true;
  for (const fields of [
    {},
    { minDeg: 78, centerDeg: 89, maxDeg: 102 },
    { minDeg: 79, centerDeg: 90, maxDeg: 102 },
    { minDeg: 78, centerDeg: 90, maxDeg: 101 },
  ]) {
    calibration = fields;
    assert.equal((await api(url, look, command)).error, 'duck_calibration_mismatch');
    assert.equal(posts, 0);
  }
  calibration = { minDeg: 77, centerDeg: 90, maxDeg: 103 };
  assert.equal((await api(url, look, command)).status, 'unknown');
  assert.equal(posts, 1);
  assert.deepEqual(wire, {
    v: 1,
    type: 'joint.set',
    requestId: 'look_1',
    joint: 'neck',
    angleDeg: 96,
    durationMs: 700,
    sessionId,
    expiresAtMs: 2599,
  });
  await stop(gateway);
  gateway = createGateway(config);
  url = await listen(gateway);
  assert.equal((await api(url, look, command)).status, 'unknown');
  assert.equal((await api(url, look + '/look_1')).status, 'unknown');
  assert.equal((await api(url, look, { ...command, requestId: 'look_2' })).code, 409);
  badSession = false;
  assert.equal((await api(url, look + '/look_1')).status, 'command_finished');
  assert.equal(posts, 1);
});

test('does not follow device redirects or forward credentials; unknown fences the next ID', async (t) => {
  let hits = 0,
    release,
    announce;
  const started = new Promise((ok) => {
      announce = ok;
    }),
    gate = new Promise((ok) => {
      release = ok;
    });
  const target = server(async (req, res) => {
    hits++;
    send(res, 200, {});
  });
  const other = await listen(target);
  const peer = server(async (req, res) => {
    if (req.url === '/control/v1/status') {
      announce();
      await gate;
      return send(res, 200, {
        v: 1,
        sessionId: 'a'.repeat(32),
        uptimeMs: 55,
        minDeg: 78,
        centerDeg: 90,
        maxDeg: 102,
        ready: true,
        motionVerified: false,
      });
    }
    res.writeHead(307, { Location: other + '/control/v1' });
    res.end('{}');
  });
  const origin = await listen(peer),
    gateway = createGateway({
      mode: 'simulation',
      origin,
      deviceToken,
      padToken,
      angles,
      duckId: 'duck-demo',
    }),
    url = await listen(gateway);
  t.after(async () => {
    release();
    await stop(gateway);
    await stop(peer);
    await stop(target);
  });
  const initial = api(url, look, command);
  await started;
  assert.equal((await api(url, look, { ...command, requestId: 'concurrent' })).code, 409);
  release();
  assert.equal((await initial).status, 'unknown');
  assert.equal((await api(url, look + '/look_1')).status, 'unknown');
  assert.equal((await api(url, look, { ...command, requestId: 'following' })).code, 409);
  assert.equal(hits, 0);
});

test('startup is fail-closed for public/DNS endpoints, missing calibration or implicit hardware', async () => {
  for (const host of [
    'http://8.8.8.8',
    'http://localhost',
    'http://192.168.0.2/path',
    'http://127.0.0.1',
    'http://169.254.169.254',
    'http://192.168.1.1@8.8.8.8',
    'http://0xc0a80101',
    'http://192.168.1.1#hi',
  ])
    assert.throws(() => validateOrigin(host, 'hardware'));
  assert.equal(validateOrigin('http://192.168.4.1:8123', 'hardware'), 'http://192.168.4.1:8123');
  for (const a of [
    {},
    { left: 44, center: 46, right: 48 },
    { left: 90, center: 90, right: 91 },
    { left: 60, center: 90, right: 120 },
  ])
    assert.throws(() => validateAngles(a));
  for (const env of [
    {},
    { DUCK_MODE: 'hardware', DUCK_PAD_TOKEN: padToken },
    { DUCK_PAD_TOKEN: padToken, DUCK_ORIGIN: 'http://192.168.1.1' },
    { DUCK_PAD_TOKEN: padToken, DUCK_BIND: '0.0.0.0' },
  ])
    await assert.rejects(() => startService(env));
});
