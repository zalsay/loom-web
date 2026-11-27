import http from 'node:http';
import { isIPv4 } from 'node:net';
import { timingSafeEqual } from 'node:crypto';
import {
  openSync,
  closeSync,
  existsSync,
  fsyncSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from 'node:fs';
import { dirname, isAbsolute } from 'node:path';

export const isId = (s) => typeof s === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(s);
export const validToken = (s) => typeof s === 'string' && /^[A-Za-z0-9._~+/=-]{16,256}$/.test(s);
export function authorized(req, token) {
  const got = Buffer.from(req.headers.authorization || '');
  const want = Buffer.from(`Bearer ${token}`);
  return got.length === want.length && timingSafeEqual(got, want);
}
const err = (code, message) => Object.assign(new Error(message), { code });
export function send(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
export function server(handler) {
  return http.createServer(
    { requestTimeout: 5000, headersTimeout: 5000, maxHeaderSize: 4096 },
    (req, res) => {
      handler(req, res).catch((e) =>
        send(res, Number.isInteger(e.code) ? e.code : 503, {
          error: Number.isInteger(e.code) ? e.message : 'service_unavailable',
        }),
      );
    },
  );
}
export async function jsonBody(req) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json')
    throw err(415, 'json_required');
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    if ((size += c.length) > 2048) throw err(413, 'body_too_large');
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks));
  } catch {
    throw err(400, 'bad_json');
  }
}
export const exact = (o, keys) =>
  o &&
  typeof o === 'object' &&
  !Array.isArray(o) &&
  Object.keys(o).length === keys.length &&
  keys.every((k) => Object.hasOwn(o, k));
const terminal = (s) => s === 'command_finished' || s === 'failed';
export function validateOrigin(origin, mode) {
  if (
    typeof origin !== 'string' ||
    !/^http:\/\/(?:\d{1,3}\.){3}\d{1,3}(?::[1-9]\d{0,4})?$/.test(origin)
  )
    throw Error('expected literal IPv4 HTTP origin without path');
  const ip = origin.slice(7).split(':')[0];
  if (
    !isIPv4(ip) ||
    (mode === 'simulation'
      ? ip !== '127.0.0.1'
      : !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip))
  )
    throw Error('origin outside configured private network class');
  return new URL(origin).origin;
}
export function validateAngles(angles) {
  const { left, center, right } = angles || {};
  if (
    ![left, center, right].every((x) => Number.isInteger(x) && x >= 45 && x <= 180) ||
    (left - center) * (center - right) <= 0 ||
    Math.abs(left - right) > 28
  )
    throw Error('three ordered calibrated degree samples within 28 degrees required');
}
// No redirects, DNS, proxy, retries or keep-alive reuse on the control hop.
function call(origin, token, path, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      origin + path,
      {
        agent: false,
        method: body ? 'POST' : 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          ...(body && { 'content-type': 'application/json' }),
        },
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('error', reject);
        res.on('data', (c) => {
          if ((size += c.length) > 2048) req.destroy(Error('bad response'));
          else chunks.push(c);
        });
        res.on('end', () => {
          try {
            resolve({ code: res.statusCode, data: JSON.parse(Buffer.concat(chunks)) });
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    const timer = setTimeout(() => req.destroy(Error('control timeout')), timeoutMs);
    req.on('error', reject);
    req.on('close', () => clearTimeout(timer));
    req.end(body ? JSON.stringify(body) : undefined);
  });
}
// Single writer. Persist intent before POST; on crash the unresolved intent blocks new motion.
// After an unclean exit, inspect the duck and verify no live writer before removing .lock.
function ledger(path, binding, targets) {
  const rows = new Map();
  let fd,
    lock,
    poisoned = false,
    closed = false;
  const close = () => {
    closed = true;
    if (fd !== undefined) {
      closeSync(fd);
      fd = undefined;
    }
    if (lock !== undefined) {
      closeSync(lock);
      lock = undefined;
      unlinkSync(path + '.lock');
    }
  };
  if (path) {
    if (!isAbsolute(path)) throw Error('absolute journal path required');
    lock = openSync(path + '.lock', 'wx', 0o600);
    try {
      writeFileSync(lock, String(process.pid));
      const fresh = !existsSync(path);
      fd = openSync(path, 'a+', 0o600);
      if (fresh) {
        writeFileSync(fd, JSON.stringify({ binding }) + '\n');
        fsyncSync(fd);
        const dir = openSync(dirname(path), 'r');
        try {
          fsyncSync(dir);
        } finally {
          closeSync(dir);
        }
      }
      const lines = readFileSync(path, 'utf8').split('\n');
      if (
        lines.pop() !== '' ||
        JSON.stringify(JSON.parse(lines.shift()).binding) !== JSON.stringify(binding)
      )
        throw Error('journal corrupted or binding changed');
      for (const line of lines) {
        const row = JSON.parse(line);
        if (
          !isId(row.requestId) ||
          typeof row.direction !== 'string' ||
          !Object.hasOwn(targets, row.direction) ||
          targets[row.direction] === null ||
          !['unknown', 'accepted', 'command_finished', 'failed'].includes(row.status) ||
          !/^[0-9a-f]{32}$/.test(row.sessionId)
        )
          throw Error('invalid journal row');
        rows.set(row.requestId, row);
      }
    } catch (e) {
      close();
      throw e;
    }
  }
  const save = (row) => {
    if (poisoned || closed) throw Error('journal unavailable');
    if (fd !== undefined) {
      try {
        writeFileSync(fd, JSON.stringify(row) + '\n');
        fsyncSync(fd);
      } catch (e) {
        poisoned = true;
        throw e;
      }
    }
    rows.set(row.requestId, row);
    return row;
  };
  return { rows, save, close };
}
export function createGateway({
  mode,
  origin,
  duckId,
  padToken,
  deviceToken,
  angles,
  journalPath,
  timeoutMs = 1600,
}) {
  if (
    !['simulation', 'hardware'].includes(mode) ||
    !isId(duckId) ||
    !validToken(padToken) ||
    !/^[0-9a-f]{64}$/.test(deviceToken) ||
    padToken === deviceToken
  )
    throw Error('invalid binding or credentials');
  validateAngles(angles);
  origin = validateOrigin(origin, mode);
  angles = Object.freeze({ left: angles.left, center: angles.center, right: angles.right });
  const halfway = (side) => {
    const offset = Math.trunc((side - angles.center) / 2);
    return offset === 0 ? null : angles.center + offset;
  };
  const targets = {
    ...angles,
    slight_left: halfway(angles.left),
    slight_right: halfway(angles.right),
  };
  if (mode === 'hardware' && !journalPath) throw Error('hardware requires persistent journal');
  // Only the original calibration samples bind the journal, never derived positions.
  const log = ledger(journalPath, { v: 1, mode, origin, duckId, angles }, targets);
  const { rows, save } = log;
  let active = false;
  const remote = (path, body) => call(origin, deviceToken, path, body, timeoutMs);
  const reply = (res, row) =>
    send(res, terminal(row.status) ? 200 : 202, {
      duckId,
      requestId: row.requestId,
      direction: row.direction,
      status: row.status,
      mode,
      motionVerified: false,
    });
  const responseStatus = (r, row, post) =>
    r.data?.v === 1 &&
    r.data.requestId === row.requestId &&
    r.data.sessionId === row.sessionId &&
    r.data.motionVerified === false &&
    ['accepted', 'command_finished', 'failed', 'unknown'].includes(r.data.status) &&
    (r.code === 200 || (post && r.code === 202 && r.data.status === 'accepted'))
      ? r.data.status
      : 'unknown';
  const srv = server(async (req, res) => {
    if (!authorized(req, padToken)) throw err(401, 'unauthorized');
    const m = /^\/v1\/duck\/look\/([a-zA-Z0-9_-]{1,64})$/.exec(req.url);
    if (req.method === 'GET' && m) {
      let row = rows.get(m[1]);
      if (!row) throw err(404, 'unknown_id');
      if (!active && !terminal(row.status)) {
        active = true;
        try {
          let status = 'unknown';
          try {
            status = responseStatus(
              await remote('/control/v1/status?id=' + row.requestId),
              row,
              false,
            );
          } catch {}
          if (status !== row.status) row = save({ ...row, status });
        } finally {
          active = false;
        }
      }
      return reply(res, row);
    }
    if (req.method !== 'POST' || req.url !== '/v1/duck/look') throw err(404, 'not_found');
    const body = await jsonBody(req);
    if (
      !exact(body, ['requestId', 'duckId', 'direction']) ||
      !isId(body.requestId) ||
      !isId(body.duckId) ||
      typeof body.direction !== 'string' ||
      !Object.hasOwn(targets, body.direction)
    )
      throw err(400, 'invalid_look');
    if (body.duckId !== duckId) throw err(403, 'duck_not_bound');
    const { requestId, direction } = body;
    const old = rows.get(requestId);
    if (old) {
      if (old.direction !== direction) throw err(409, 'request_conflict');
      return reply(res, old);
    }
    const angleDeg = targets[direction];
    if (angleDeg === null) throw err(400, 'calibration_too_narrow');
    if (active || [...rows.values()].some((r) => !terminal(r.status)))
      throw err(409, 'duck_busy_or_unknown');
    if (rows.size >= 4096) throw err(503, 'journal_full'); // Never evict an ID and permit replay.
    active = true;
    try {
      const { code, data } = await remote('/control/v1/status');
      if (
        code !== 200 ||
        data?.v !== 1 ||
        data.ready !== true ||
        data.motionVerified !== false ||
        typeof data.sessionId !== 'string' ||
        !/^[0-9a-f]{32}$/.test(data.sessionId) ||
        !Number.isSafeInteger(data.uptimeMs) ||
        data.uptimeMs < 0 ||
        !Number.isSafeInteger(data.uptimeMs + 2500)
      )
        throw err(503, 'duck_not_ready');
      const { minDeg, centerDeg, maxDeg } = data;
      // Left/right may be reversed or more conservative than the duck's calibrated endpoints.
      if (
        ![minDeg, centerDeg, maxDeg].every(Number.isInteger) ||
        minDeg < 45 ||
        maxDeg > 180 ||
        !(minDeg < centerDeg && centerDeg < maxDeg) ||
        maxDeg - minDeg > 28 ||
        centerDeg !== angles.center ||
        Math.min(angles.left, angles.right) < minDeg ||
        Math.max(angles.left, angles.right) > maxDeg
      )
        throw err(503, 'duck_calibration_mismatch');
      let row = save({ requestId, direction, sessionId: data.sessionId, status: 'unknown' });
      let status = 'unknown';
      try {
        status = responseStatus(
          await remote('/control/v1', {
            v: 1,
            type: 'joint.set',
            requestId,
            joint: 'neck',
            angleDeg,
            durationMs: 700,
            sessionId: data.sessionId,
            expiresAtMs: data.uptimeMs + 2500,
          }),
          row,
          true,
        );
      } catch {}
      if (status !== row.status) row = save({ ...row, status });
      return reply(res, row);
    } finally {
      active = false;
    }
  });
  srv.once('close', log.close);
  return srv;
}
