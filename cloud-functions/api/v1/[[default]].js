import { getEdgeRuntimeApp } from '../../../server/edge-runtime.mjs';

export async function onRequest({ request }) {
  return getEdgeRuntimeApp().handle(request);
}
