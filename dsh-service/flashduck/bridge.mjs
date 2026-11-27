import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

// Original Loom intents, not DuckClaw RPC method names. The firmware receives text.
export const intents = Object.freeze({
  look_left: '请仅在原地向左转头一次，不走动、不调用动作序列。',
  look_right: '请仅在原地向右转头一次，不走动、不调用动作序列。',
  walk_step: '请只向前走一步，然后回到站立姿势。不要继续行走。',
  stop: '请不再开始走动，回到 home 站立姿势。',
});
const id = /^[A-Za-z0-9_-]{1,64}$/;
const hash = (v) => createHash('sha256').update(v).digest();
const problem = (status, message) => Object.assign(new Error(message), { status });

// One persistent LAN socket (stock firmware has four slots), one short chat ID per request.
// Do not replay after a send: the duck may already have acted.
export function duckChat(url, { timeoutMs = 20000, Socket = globalThis.WebSocket } = {}) {
  const endpoint = new URL(url);
  if (
    !['ws:', 'wss:'].includes(endpoint.protocol) ||
    endpoint.pathname !== '/ws' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error('expected a fixed DuckClaw /ws endpoint');
  if (typeof Socket !== 'function') throw new Error('WebSocket unavailable; use Node 22+');
  let socket = null,
    ready = false,
    pending = null;
  function finish(status) {
    const job = pending;
    if (!job) return;
    pending = null;
    clearTimeout(job.timer);
    job.resolve(status);
  }
  function disconnect() {
    const old = socket;
    socket = null;
    ready = false;
    finish(pending?.sent ? 'unknown' : 'failed');
    try {
      old?.close();
    } catch {
      /* peer already gone */
    }
  }
  function dispatch() {
    const job = pending;
    if (!job || !ready || job.sent) return;
    job.sent = true;
    try {
      socket.send(
        JSON.stringify({ type: 'message', chat_id: job.chatId, content: intents[job.action] }),
      );
    } catch {
      disconnect();
    }
  }
  const send = (action) =>
    new Promise((resolve) => {
      if (!Object.hasOwn(intents, action) || pending) return resolve('failed');
      const chatId = 'loom_' + randomBytes(10).toString('hex');
      pending = { chatId, action, resolve, sent: false, timer: setTimeout(disconnect, timeoutMs) };
      if (socket) {
        dispatch();
        return;
      }
      try {
        const ws = (socket = new Socket(endpoint.href));
        ws.addEventListener('open', () => {
          if (ws === socket) {
            ready = true;
            dispatch();
          }
        });
        const lost = () => {
          if (ws === socket) disconnect();
        };
        ws.addEventListener('close', lost);
        ws.addEventListener('error', lost);
        ws.addEventListener('message', ({ data }) => {
          if (ws !== socket || !pending?.sent || typeof data !== 'string' || data.length > 16384)
            return;
          try {
            const msg = JSON.parse(data);
            if (
              msg.type === 'response' &&
              msg.chat_id === pending.chatId &&
              typeof msg.content === 'string'
            )
              finish('replied');
          } catch {
            /* ignore unrelated frames */
          }
        });
      } catch {
        disconnect();
      }
    });
  send.close = disconnect;
  return send;
}

// A station-scoped gateway instance. Keep outstanding/uncertain commands out of other stations.
export function createDuckBridge({
  token,
  duckId = 'duck-1',
  send,
  mode = 'simulation',
  allowWalk = false,
  cooldownMs = 1200,
  maxRecords = 1000,
}) {
  if (
    typeof token !== 'string' ||
    token.length < 16 ||
    !id.test(duckId) ||
    typeof send !== 'function'
  )
    throw new Error('invalid gateway configuration');
  const credential = hash('Bearer ' + token),
    records = new Map();
  let busy = false,
    uncertain = false,
    lastSend = -Infinity;
  return createServer(async (req, res) => {
    const json = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify(data));
    };
    try {
      if (!timingSafeEqual(credential, hash(req.headers.authorization ?? '')))
        throw problem(401, 'unauthorized');
      const match = /^\/v1\/duck\/commands\/([A-Za-z0-9_-]{1,64})$/.exec(req.url);
      if (req.method === 'GET' && match) {
        const row = records.get(match[1]);
        if (!row) throw problem(404, 'not_found');
        return json(200, row);
      }
      if (req.method !== 'POST' || req.url !== '/v1/duck/commands') throw problem(404, 'not_found');
      if (req.headers['content-type']?.split(';')[0] !== 'application/json')
        throw problem(415, 'json_required');
      let size = 0;
      const parts = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 2048) throw problem(413, 'body_too_large');
        parts.push(chunk);
      }
      let body;
      try {
        body = JSON.parse(Buffer.concat(parts).toString('utf8'));
      } catch {
        throw problem(400, 'invalid_json');
      }
      if (
        !body ||
        typeof body !== 'object' ||
        Object.keys(body).length !== 3 ||
        !['action', 'requestId', 'duckId'].every((k) => typeof body[k] === 'string') ||
        !id.test(body.requestId) ||
        !Object.hasOwn(intents, body.action)
      )
        throw problem(400, 'invalid_command');
      if (body.duckId !== duckId) throw problem(403, 'wrong_station');
      const { action, requestId } = body,
        existing = records.get(requestId);
      if (existing) {
        if (existing.action !== action) throw problem(409, 'id_conflict');
        return json(200, existing);
      }
      if (action === 'walk_step' && !allowWalk) throw problem(403, 'walk_disabled');
      if (uncertain) throw problem(409, 'inspect_duck_before_rearming');
      if (busy) throw problem(409, 'duck_busy'); // no preemption guarantee on chat transport
      if (Date.now() - lastSend < cooldownMs) throw problem(429, 'cooldown');
      if (records.size >= maxRecords) throw problem(503, 'session_full'); // never evict an ID and replay it
      const row = { duckId, requestId, action, status: 'accepted', mode, motionVerified: false };
      records.set(requestId, row);
      busy = true;
      lastSend = Date.now();
      json(202, row);
      try {
        const result = await send(action);
        row.status = ['replied', 'failed', 'unknown'].includes(result) ? result : 'unknown';
      } catch {
        row.status = 'unknown';
      } finally {
        uncertain = row.status === 'unknown';
        busy = false;
      }
    } catch (err) {
      if (!res.headersSent)
        json(err.status ?? 500, { error: err.status ? err.message : 'internal_error' });
    }
  });
}
