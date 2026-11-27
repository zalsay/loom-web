import { createDuckBridge, duckChat } from './bridge.mjs';
import { isIPv4 } from 'node:net';
const mode = process.env.DUCK_MODE ?? 'simulation';
const token = process.env.LOOM_DUCK_TOKEN;
if (!token || token.length < 16) throw new Error('Set LOOM_DUCK_TOKEN (at least 16 characters)');
if (!['simulation', 'hardware'].includes(mode)) throw new Error('unsupported DUCK_MODE');
let peer, endpoint;
if (mode === 'simulation') {
  const { startMockDuck } = await import('./mock-peer.mjs');
  peer = await startMockDuck();
  endpoint = peer.url;
} else {
  const ip = process.env.DUCK_LAN_IP ?? '';
  if (
    process.env.DUCK_ARM !== 'supervised' ||
    !isIPv4(ip) ||
    !/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(ip)
  )
    throw new Error('Hardware requires explicit supervised arming and fixed private DUCK_LAN_IP');
  endpoint = `ws://${ip}:18789/ws`;
}
const send = duckChat(endpoint);
const server = createDuckBridge({
  token,
  mode,
  duckId: process.env.DUCK_ID ?? 'duck-1',
  send,
  allowWalk: process.env.DUCK_ALLOW_WALK === '1',
});
server.requestTimeout = 10000;
server.headersTimeout = 8000;
server.listen(Number(process.env.PORT ?? 8795), '127.0.0.1', () =>
  console.log(`Loom duck gateway ${mode} http://127.0.0.1:${server.address().port}`),
);
function stop() {
  server.close();
  server.closeAllConnections();
  send.close();
  peer?.close();
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
