import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createGateway, validToken } from './bridge.mjs';
import { createMockDuck } from './mock-duck.mjs';

const listen = (srv, port) =>
  new Promise((resolve, reject) => {
    srv.once('error', reject);
    srv.listen(port, '127.0.0.1', () => {
      srv.off('error', reject);
      resolve(`http://127.0.0.1:${srv.address().port}`);
    });
  });
const stop = (srv) => (!srv ? undefined : new Promise((resolve) => srv.close(resolve)));
const hardwareVars = [
  'DUCK_ORIGIN',
  'DUCK_DEVICE_TOKEN',
  'DUCK_LEFT_DEG',
  'DUCK_CENTER_DEG',
  'DUCK_RIGHT_DEG',
  'DUCK_JOURNAL',
];
export async function startService(env = process.env) {
  const mode = env.DUCK_MODE ?? 'simulation',
    padToken = env.DUCK_PAD_TOKEN,
    port = env.DUCK_PORT ?? '18921';
  if (!['simulation', 'hardware'].includes(mode) || !validToken(padToken))
    throw Error('valid DUCK_MODE and DUCK_PAD_TOKEN (16–256 bearer characters) required');
  if (env.DUCK_BIND && env.DUCK_BIND !== '127.0.0.1')
    throw Error('loopback listener only; use authenticated TLS reverse proxy for Pad');
  if (!/^\d{1,5}$/.test(port) || Number(port) > 65535) throw Error('invalid DUCK_PORT');
  if (mode === 'simulation' && hardwareVars.some((k) => env[k] !== undefined))
    throw Error('hardware settings require explicit hardware mode');
  const duckId = env.DUCK_ID ?? (mode === 'simulation' ? 'duck-demo' : undefined);
  let peer,
    gateway,
    origin = env.DUCK_ORIGIN,
    deviceToken = env.DUCK_DEVICE_TOKEN;
  let angles = { left: 78, center: 90, right: 102 };
  try {
    if (mode === 'simulation') {
      deviceToken = randomBytes(32).toString('hex');
      peer = createMockDuck({ deviceToken, angles });
      origin = await listen(peer, 0);
    } else {
      if (!hardwareVars.every((k) => typeof env[k] === 'string' && env[k].length))
        throw Error('missing hardware binding, calibration, credentials or journal');
      for (const key of Object.keys(angles)) {
        const s = env[`DUCK_${key.toUpperCase()}_DEG`];
        if (!/^\d{1,3}$/.test(s)) throw Error('invalid calibration');
        angles[key] = Number(s);
      }
    }
    gateway = createGateway({
      mode,
      padToken,
      deviceToken,
      duckId,
      origin,
      angles,
      journalPath: env.DUCK_JOURNAL,
    });
    const gatewayOrigin = await listen(gateway, Number(port));
    return {
      origin: gatewayOrigin,
      mode,
      duckId,
      close: async () => {
        await stop(gateway);
        await stop(peer);
      },
    };
  } catch (e) {
    await stop(gateway);
    await stop(peer);
    throw e;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const s = await startService();
    console.log(JSON.stringify({ origin: s.origin, mode: s.mode, duckId: s.duckId }));
    const close = () => {
      void s.close();
    };
    process.once('SIGTERM', close);
    process.once('SIGINT', close);
  } catch (e) {
    console.error('Direct gateway startup failed:', e.message);
    process.exitCode = 1;
  }
}
