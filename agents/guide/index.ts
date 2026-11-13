import { getEdgeRuntimeApp, toAgentWebRequest } from '../../server/edge-runtime.mjs';

export async function onRequest(context) {
  return getEdgeRuntimeApp().handle(toAgentWebRequest(context.request), { makers: context });
}
