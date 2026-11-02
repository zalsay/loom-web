import { createWorldWeatherHandler } from '../../server/world-weather.mjs';

const handle = createWorldWeatherHandler();

export async function onRequest({ request }) {
  return handle(request);
}
