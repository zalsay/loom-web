import { createApp } from './app.mjs';
import { loadConfig } from './config.mjs';
import { createChatCompletionsProvider } from './provider.mjs';
import { createEdgeOneBlobStore } from './storage.mjs';

let runtimeApp;

export function getEdgeRuntimeApp() {
  if (!runtimeApp) {
    const config = loadConfig(process.env, { production: process.env.NODE_ENV !== 'development' });
    const provider = config.agentEnabled ? createChatCompletionsProvider(config) : null;
    const store = createEdgeOneBlobStore({ storeName: config.blobStoreName });
    runtimeApp = createApp({ store, config, provider });
  }
  return runtimeApp;
}
