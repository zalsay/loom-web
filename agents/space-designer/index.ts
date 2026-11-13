import { getEdgeRuntimeApp, toAgentWebRequest } from '../../server/edge-runtime.mjs';

export async function onRequest({ request }) {
  // Keep the native Agent route self-authenticating; this is not protected by API routing.
  return getEdgeRuntimeApp().handle(toAgentWebRequest(request));
}
