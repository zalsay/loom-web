import http from 'node:http';
import { readFile, stat, mkdir, open } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/app.mjs';
import { createFileStore } from '../server/storage.mjs';
import { createChatCompletionsProvider } from '../server/provider.mjs';
import { loadConfig } from '../server/config.mjs';
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(project, process.argv.includes('--dist') ? 'dist' : 'web');
const portFlag = process.argv.indexOf('--port');
const port = Number(portFlag >= 0 ? process.argv[portFlag + 1] : process.env.PORT || 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid HTTP port');
// Local only by default; set HOST=0.0.0.0 to test from a phone on the same network.
const host = process.env.HOST || '127.0.0.1';
if (process.env.NODE_ENV === 'production')
  throw new Error('Use EdgeOne handlers in production, not the local development server.');
const dataDirectory = path.resolve(project, '.loom-data');
await mkdir(dataDirectory, { recursive: true, mode: 0o700 });
const secretPath = path.join(dataDirectory, 'dev-cookie-secret');
let localSecret;
try {
  const secretFile = await open(secretPath, 'wx', 0o600);
  try {
    await secretFile.writeFile(randomBytes(32).toString('hex'));
  } finally {
    await secretFile.close();
  }
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
}
localSecret = (await readFile(secretPath, 'utf8')).trim();
const localOrigin = process.env.LOOM_ORIGIN || `http://localhost:${port}`;
const config = loadConfig(
  {
    ...process.env,
    LOOM_ORIGIN: localOrigin,
    LOOM_COOKIE_SECRET: process.env.LOOM_COOKIE_SECRET || localSecret,
  },
  { production: false },
);
const app = createApp({
  store: createFileStore(path.join(dataDirectory, 'objects')),
  config,
  provider: config.agentEnabled ? createChatCompletionsProvider(config) : null,
});
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.woff2': 'font/woff2',
  '.glb': 'model/gltf-binary',
  '.txt': 'text/plain; charset=utf-8',
};
http
  .createServer(async (request, response) => {
    const disconnect = new AbortController();
    response.on('close', () => {
      if (!response.writableEnded) disconnect.abort();
    });
    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname === '/space-designer' || pathname.startsWith('/api/')) {
        const headers = new Headers();
        for (const [name, value] of Object.entries(request.headers)) {
          if (Array.isArray(value)) for (const entry of value) headers.append(name, entry);
          else if (value !== undefined) headers.set(name, value);
        }
        const input = new Request(new URL(request.url, localOrigin), {
          method: request.method,
          headers,
          signal: disconnect.signal,
          ...(!['GET', 'HEAD'].includes(request.method)
            ? { body: Readable.toWeb(request), duplex: 'half' }
            : {}),
        });
        const output = await app.handle(input);
        response.statusCode = output.status;
        for (const [name, value] of output.headers)
          if (name !== 'set-cookie') response.setHeader(name, value);
        const cookies = output.headers.getSetCookie();
        if (cookies.length) response.setHeader('set-cookie', cookies);
        if (!output.body || request.method === 'HEAD') {
          response.end();
          return;
        }
        const reader = output.body.getReader();
        try {
          while (!disconnect.signal.aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!response.write(value))
              await once(response, 'drain', { signal: disconnect.signal });
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
        response.end();
        return;
      }
      if (!['GET', 'HEAD'].includes(request.method)) {
        response.writeHead(405).end('Method not allowed');
        return;
      }
      let file = path.resolve(root, '.' + pathname);
      if (file !== root && !file.startsWith(root + path.sep)) {
        response.writeHead(403).end('Forbidden');
        return;
      }
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      const bytes = await readFile(file);
      response.writeHead(200, {
        'Content-Type': types[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch {
      if (disconnect.signal.aborted) return;
      if (response.headersSent) {
        response.end();
        return;
      }
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('页面不存在');
    }
  })
  .listen(port, host, () => console.log(`Loom OS website: http://localhost:${port}`));
