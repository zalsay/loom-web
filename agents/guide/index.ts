import { getEdgeRuntimeApp } from '../../server/edge-runtime.mjs';

export async function onRequest(context) {
  return getEdgeRuntimeApp().handle(context.request, { makers: context });
}
