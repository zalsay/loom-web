// Protocol peer, not a motor simulator. Elapsed time finishes a command, never proves motion.
import { randomBytes } from 'node:crypto';
import { authorized, exact, isId, jsonBody, send, server, validateAngles } from './bridge.mjs';

export function createMockDuck({
  deviceToken,
  angles,
  clock = () => Math.floor(performance.now()),
  ready = () => true,
}) {
  validateAngles(angles);
  if (typeof deviceToken !== 'string' || !/^[0-9a-f]{64}$/.test(deviceToken))
    throw Error('invalid device token');
  const sessionId = randomBytes(16).toString('hex'),
    start = clock(),
    rows = new Map();
  const result = (requestId, row) => ({
    v: 1,
    sessionId,
    requestId,
    status: !row ? 'unknown' : clock() < row.end ? 'accepted' : 'command_finished',
    motionVerified: false,
  });
  const srv = server(async (req, res) => {
    if (!authorized(req, deviceToken)) return send(res, 401, { error: 'unauthorized' });
    const uptimeMs = clock() - start;
    if (req.method === 'GET' && req.url === '/control/v1/status')
      return send(res, 200, {
        v: 1,
        sessionId,
        uptimeMs,
        ready: ready() && rows.size < 128 && ![...rows.values()].some((r) => r.end > clock()),
        minDeg: Math.min(angles.left, angles.right),
        centerDeg: angles.center,
        maxDeg: Math.max(angles.left, angles.right),
        motionVerified: false,
      });
    const m = /^\/control\/v1\/status\?id=([A-Za-z0-9_-]{1,64})$/.exec(req.url);
    if (req.method === 'GET' && m) return send(res, 200, result(m[1], rows.get(m[1])));
    if (req.method !== 'POST' || req.url !== '/control/v1')
      return send(res, 404, { error: 'not_found' });
    const c = await jsonBody(req);
    if (
      !exact(c, [
        'v',
        'sessionId',
        'requestId',
        'expiresAtMs',
        'type',
        'joint',
        'angleDeg',
        'durationMs',
      ]) ||
      c.v !== 1 ||
      !isId(c.requestId) ||
      c.type !== 'joint.set' ||
      c.joint !== 'neck' ||
      c.durationMs !== 700 ||
      !Number.isInteger(c.angleDeg) ||
      c.angleDeg < Math.min(angles.left, angles.right) ||
      c.angleDeg > Math.max(angles.left, angles.right) ||
      !Number.isSafeInteger(c.expiresAtMs)
    )
      return send(res, 400, { error: 'invalid_command' });
    if (c.sessionId !== sessionId) return send(res, 409, { error: 'wrong_session' });
    const row = rows.get(c.requestId);
    if (row) {
      if (row.angle !== c.angleDeg || row.expires !== c.expiresAtMs)
        return send(res, 409, { error: 'request_conflict' });
      return send(res, 200, result(c.requestId, row));
    }
    const now = clock();
    if (
      !ready() ||
      c.expiresAtMs <= now - start ||
      c.expiresAtMs > now - start + 5000 ||
      rows.size >= 128 ||
      [...rows.values()].some((r) => r.end > now)
    )
      return send(res, 409, { error: 'not_ready' });
    const data = { angle: c.angleDeg, expires: c.expiresAtMs, end: now + 700 };
    rows.set(c.requestId, data);
    return send(res, 202, result(c.requestId, data));
  });
  return srv;
}
