// Development/test fixture only. No board, model or physical actuators.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export async function startMockDuck() {
  const { wsServer: WebSocketServer } = require('playwright-core/lib/utilsBundle');
  const peer = new WebSocketServer({ host: '127.0.0.1', port: 0, path: '/ws' });
  const frames = [];
  peer.on('connection', (socket) =>
    socket.on('message', (data) => {
      const m = JSON.parse(data.toString());
      frames.push(m);
      if (m.type === 'message' && typeof m.content === 'string' && m.chat_id.length < 32) {
        socket.send(JSON.stringify({ type: 'token', chat_id: m.chat_id, content: '…' }));
        socket.send(
          JSON.stringify({
            type: 'response',
            chat_id: m.chat_id,
            content: '模拟鸭端文字回复，未执行动作',
          }),
        );
      }
    }),
  );
  await new Promise((ok, fail) => {
    peer.once('listening', ok);
    peer.once('error', fail);
  });
  return {
    url: `ws://127.0.0.1:${peer.address().port}/ws`,
    frames,
    close: () => {
      for (const client of peer.clients) client.terminate();
      peer.close();
    },
  };
}
