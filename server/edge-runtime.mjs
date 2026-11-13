import { createApp } from './app.mjs';
import { loadConfig } from './config.mjs';
import { createChatCompletionsProvider } from './provider.mjs';
import { createEdgeOneBlobStore } from './storage.mjs';

let runtimeApp;

export function toAgentWebRequest(request) {
  if (request instanceof Request) return request;
  // Makers Agent handlers receive parsed JSON and a header record, unlike Cloud Functions.
  const method = request.method || 'POST';
  return new Request(request.url, {
    method,
    headers: new Headers(request.headers),
    signal: request.signal,
    ...(method !== 'GET' && method !== 'HEAD' && request.body !== undefined
      ? { body: JSON.stringify(request.body) }
      : {}),
  });
}

export function getEdgeRuntimeApp() {
  if (!runtimeApp) {
    const config = loadConfig(process.env, { production: process.env.NODE_ENV !== 'development' });
    const provider = config.agentEnabled ? createChatCompletionsProvider(config) : null;
    const store = createEdgeOneBlobStore({ storeName: config.blobStoreName });
    runtimeApp = createApp({ store, config, provider });
  }
  return runtimeApp;
}
