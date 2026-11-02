import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldWeatherHandler } from '../server/world-weather.mjs';

const route = 'https://loom.test/api/world-weather';
const initialNow = Date.parse('2026-10-31T05:00:00Z');
const oneHour = 60 * 60 * 1000;
const dateFormat = (at) => new Date(at).toUTCString();

function weatherPayload({ updatedAt = '2026-10-31T01:18:12Z', rows } = {}) {
  return {
    properties: {
      meta: { updated_at: updatedAt },
      timeseries: rows ?? [
        {
          time: '2026-10-31T04:00:00Z',
          data: {
            instant: {
              details: {
                air_temperature: 17.4,
                relative_humidity: 68,
                cloud_area_fraction: 22,
                wind_speed: 4.2,
                wind_from_direction: 110,
              },
            },
            next_1_hours: {
              summary: { symbol_code: 'partlycloudy_day' },
              details: { precipitation_amount: 0.2 },
            },
          },
        },
      ],
    },
  };
}

function sunPayload(date = '2026-10-31') {
  const nextDate = date === '2026-10-31' ? '2026-11-01' : date;
  return {
    properties: {
      sunrise: { time: `${date}T06:10+08:00` },
      sunset: { time: `${date}T17:21+08:00` },
      nextSunrise: { time: `${nextDate}T06:10+08:00` },
    },
  };
}

function jsonResponse(value, headers = {}) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function fixtureFetch({ weather = weatherPayload(), sun = sunPayload(), onCall } = {}) {
  return async (input, init = {}) => {
    const url = new URL(input);
    const kind = url.pathname.includes('/sunrise/') ? 'sun' : 'weather';
    onCall?.({ url, init, kind });
    return jsonResponse(kind === 'sun' ? sun : weather);
  };
}

async function read(request, handler) {
  const response = await handler(request);
  const body = response.status === 204 || request.method === 'HEAD' ? null : await response.json();
  return { response, body };
}

test('uses only fixed MET endpoints and exact fixed location; normalizes nearby current row', async () => {
  const calls = [];
  const handler = createWorldWeatherHandler({
    now: () => initialNow,
    fetchImpl: fixtureFetch({ onCall: (call) => calls.push(call) }),
    userAgent: 'test-loom-weather/1 https://example.test',
  });
  const { response, body } = await read(new Request(route), handler);

  assert.equal(response.status, 200);
  assert.equal(body.location.longitude, 119.36433054520208);
  assert.equal(body.location.latitude, 26.042010002204606);
  assert.equal(body.location.timeZone, 'Asia/Shanghai');
  assert.equal(body.location.name, '织界 · 福州');
  assert.deepEqual(body.source, {
    name: 'MET Norway',
    url: 'https://api.met.no/',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    kind: 'forecast',
  });
  assert.equal(body.weatherStatus, 'fresh');
  assert.equal(body.sunStatus, 'fresh');
  assert.equal(body.current.time, Date.parse('2026-10-31T04:00:00Z'));
  assert.equal(body.current.temperature, 17.4);
  assert.equal(body.current.humidity, 68);
  assert.equal(body.current.cloudCover, 22);
  assert.equal(body.current.windSpeed, 4.2);
  assert.equal(body.current.windDirection, 110);
  assert.equal(body.current.precipitation, 0.2);
  assert.equal(body.current.precipitationPeriodHours, 1);
  assert.equal(body.current.condition, 'cloudy');
  assert.equal(body.modelUpdatedAt, Date.parse('2026-10-31T01:18:12Z'));
  assert.equal(body.sun.date, '2026-10-31');
  assert.equal(body.sun.sunrise, Date.parse('2026-10-30T22:10:00Z'));
  assert.equal(body.sun.sunset, Date.parse('2026-10-31T09:21:00Z'));
  assert.equal(calls.length, 2);

  const weatherCall = calls.find(({ kind }) => kind === 'weather');
  const sunCall = calls.find(({ kind }) => kind === 'sun');
  assert.equal(weatherCall.url.origin, 'https://api.met.no');
  assert.equal(weatherCall.url.pathname, '/weatherapi/locationforecast/2.0/compact');
  assert.equal(weatherCall.url.searchParams.get('lat'), '26.0420');
  assert.equal(weatherCall.url.searchParams.get('lon'), '119.3643');
  assert.equal(sunCall.url.pathname, '/weatherapi/sunrise/3.0/sun');
  assert.equal(sunCall.url.searchParams.get('date'), '2026-10-31');
  assert.equal(sunCall.url.searchParams.get('offset'), '+08:00');
  for (const call of calls) {
    assert.equal(call.init.method, 'GET');
    assert.equal(call.init.headers.get('user-agent'), 'test-loom-weather/1 https://example.test');
  }
});

test('returns null for missing numeric details and accurately labels the six-hour precipitation fallback', async () => {
  const row = {
    time: '2026-10-31T05:00:00Z',
    data: {
      instant: { details: { air_temperature: '17', wind_speed: Infinity } },
      next_6_hours: {
        summary: { symbol_code: 'rain' },
        details: { precipitation_amount: 3.5 },
      },
    },
  };
  const handler = createWorldWeatherHandler({
    now: () => initialNow,
    fetchImpl: fixtureFetch({ weather: weatherPayload({ rows: [row] }) }),
  });
  const { body } = await read(new Request(route), handler);
  assert.equal(body.current.temperature, null);
  assert.equal(body.current.humidity, null);
  assert.equal(body.current.windSpeed, null);
  assert.equal(body.current.precipitation, 3.5);
  assert.equal(body.current.precipitationPeriodHours, 6);
  assert.equal(body.current.symbol, 'rain');
  assert.equal(body.current.condition, 'rain');
});

test('ignores distant future forecast rows instead of presenting a multi-day forecast as current', async () => {
  const distant = {
    time: '2026-11-01T05:00:00Z',
    data: { instant: { details: { air_temperature: 12 } } },
  };
  const handler = createWorldWeatherHandler({
    now: () => initialNow,
    fetchImpl: fixtureFetch({ weather: weatherPayload({ rows: [distant] }) }),
  });
  const { response, body } = await read(new Request(route), handler);
  assert.equal(response.status, 200);
  assert.equal(body.weatherStatus, 'unavailable');
  assert.equal(body.current, null);
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
});

test('prefers latest past forecast over a near-future row and tolerates at most five future minutes', async () => {
  const existing = weatherPayload().properties.timeseries[0];
  const next = {
    time: '2026-10-31T05:04:00Z',
    data: { instant: { details: { air_temperature: 99 } } },
  };
  const handler = createWorldWeatherHandler({
    now: () => initialNow,
    fetchImpl: fixtureFetch({ weather: weatherPayload({ rows: [next, existing] }) }),
  });
  const { body } = await read(new Request(route), handler);
  assert.equal(body.current.time, Date.parse(existing.time));
  assert.equal(body.current.temperature, 17.4);

  const futureHandler = createWorldWeatherHandler({
    now: () => initialNow,
    fetchImpl: fixtureFetch({
      weather: weatherPayload({ rows: [{ ...next, time: '2026-10-31T05:05:00Z' }] }),
    }),
  });
  const future = await read(new Request(route), futureHandler);
  assert.equal(future.body.current.time, Date.parse('2026-10-31T05:05:00Z'));
  const tooFutureHandler = createWorldWeatherHandler({
    now: () => initialNow,
    fetchImpl: fixtureFetch({
      weather: weatherPayload({ rows: [{ ...next, time: '2026-10-31T05:05:01Z' }] }),
    }),
  });
  const tooFuture = await read(new Request(route), tooFutureHandler);
  assert.equal(tooFuture.body.weatherStatus, 'unavailable');
});

test('independent weather and sun fetches deduplicate concurrent requests and share fresh memory cache', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const calls = [];
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    calls.push({ url, init });
    await gate;
    return jsonResponse(url.pathname.includes('/sunrise/') ? sunPayload() : weatherPayload());
  };
  const handler = createWorldWeatherHandler({ now: () => initialNow, fetchImpl });
  const first = read(new Request(route), handler);
  const second = read(new Request(route), handler);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 2);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a.body.current, b.body.current);
  assert.equal(calls.length, 2);
  const cached = await read(new Request(route), handler);
  assert.equal(cached.response.headers.get('cache-control').startsWith('public,'), true);
  assert.equal(calls.length, 2);
});

test('uses Last-Modified and If-Modified-Since for conditional fetch and reuses cached value on 304', async () => {
  let clock = initialNow;
  let weatherCalls = 0;
  let sunCalls = 0;
  const modified = 'Sat, 31 Oct 2026 01:00:00 GMT';
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    if (url.pathname.includes('/sunrise/')) {
      sunCalls += 1;
      if (sunCalls === 1)
        return jsonResponse(sunPayload(), {
          expires: dateFormat(clock + 1000),
          'last-modified': modified,
        });
      assert.equal(init.headers.get('if-modified-since'), modified);
      return new Response(null, {
        status: 304,
        headers: { 'cache-control': 'max-age=600', 'last-modified': modified },
      });
    }
    weatherCalls += 1;
    if (weatherCalls === 1)
      return jsonResponse(weatherPayload(), {
        expires: dateFormat(clock + 1000),
        'last-modified': modified,
      });
    assert.equal(init.headers.get('if-modified-since'), modified);
    return new Response(null, {
      status: 304,
      headers: { 'cache-control': 'max-age=600', 'last-modified': modified },
    });
  };
  const handler = createWorldWeatherHandler({ now: () => clock, fetchImpl });
  const first = await read(new Request(route), handler);
  assert.equal(first.body.weatherStatus, 'fresh');
  clock += 2_000;
  const second = await read(new Request(route), handler);
  assert.equal(second.body.weatherStatus, 'fresh');
  assert.equal(second.body.current.temperature, first.body.current.temperature);
  assert.equal(weatherCalls, 2);
  assert.equal(sunCalls, 2);
  assert.equal(
    second.response.headers.get('cache-control').startsWith('public,'),
    true,
    JSON.stringify(second.body),
  );
});

test('accounts for Age and Date when calculating freshness from upstream Cache-Control', async () => {
  let clock = initialNow;
  let calls = 0;
  const fetchImpl = async (input) => {
    calls += 1;
    const url = new URL(input);
    const headers = {
      date: dateFormat(clock),
      'cache-control': 'max-age=60',
      age: '55',
    };
    return jsonResponse(
      url.pathname.includes('/sunrise/') ? sunPayload() : weatherPayload(),
      headers,
    );
  };
  const handler = createWorldWeatherHandler({ now: () => clock, fetchImpl });
  await read(new Request(route), handler);
  clock += 6_000;
  await read(new Request(route), handler);
  assert.equal(calls, 4);
});

test('serves upstream no-store payload once without retaining it or publicly caching it', async () => {
  let calls = 0;
  const handler = createWorldWeatherHandler({
    now: () => initialNow,
    fetchImpl: async (input) => {
      calls += 1;
      const url = new URL(input);
      return jsonResponse(url.pathname.includes('/sunrise/') ? sunPayload() : weatherPayload(), {
        'cache-control': 'no-store',
      });
    },
  });
  const first = await read(new Request(route), handler);
  assert.equal(first.response.status, 200);
  assert.equal(first.body.weatherStatus, 'fresh');
  assert.equal(first.body.sunStatus, 'fresh');
  assert.equal(first.response.headers.get('cache-control'), 'private, no-store, max-age=0');
  await read(new Request(route), handler);
  assert.equal(calls, 4);
});

test('serves an initially fetched 3-to-6-hour-old forecast only as stale', async () => {
  const sourceRow = weatherPayload().properties.timeseries[0];
  const handler = createWorldWeatherHandler({
    now: () => initialNow,
    fetchImpl: fixtureFetch({
      weather: weatherPayload({ rows: [{ ...sourceRow, time: '2026-10-31T01:00:00Z' }] }),
    }),
  });
  const { response, body } = await read(new Request(route), handler);

  assert.equal(response.status, 200);
  assert.equal(body.weatherStatus, 'stale');
  assert.equal(body.current.time, Date.parse('2026-10-31T01:00:00Z'));
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');

  const tooOldHandler = createWorldWeatherHandler({
    now: () => initialNow,
    fetchImpl: fixtureFetch({
      weather: weatherPayload({ rows: [{ ...sourceRow, time: '2026-10-30T22:59:59Z' }] }),
    }),
  });
  const tooOld = await read(new Request(route), tooOldHandler);
  assert.equal(tooOld.body.weatherStatus, 'unavailable');
  assert.equal(tooOld.body.current, null);
  assert.equal(tooOld.response.headers.get('cache-control'), 'private, no-store, max-age=0');
});

test('serves a 304-confirmed forecast as stale once its current row reaches three hours old', async () => {
  let clock = Date.parse('2026-10-31T06:59:00Z');
  let weatherCalls = 0;
  const modified = 'Sat, 31 Oct 2026 01:00:00 GMT';
  const handler = createWorldWeatherHandler({
    now: () => clock,
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.pathname.includes('/sunrise/')) return jsonResponse(sunPayload());
      weatherCalls += 1;
      if (weatherCalls === 1)
        return jsonResponse(weatherPayload(), {
          expires: dateFormat(clock + 60_000),
          'last-modified': modified,
        });
      return new Response(null, {
        status: 304,
        headers: { 'cache-control': 'max-age=600', 'last-modified': modified },
      });
    },
  });

  const first = await read(new Request(route), handler);
  assert.equal(first.body.weatherStatus, 'fresh');
  clock += 60_000;
  const second = await read(new Request(route), handler);

  assert.equal(second.response.status, 200);
  assert.equal(second.body.weatherStatus, 'stale');
  assert.equal(second.body.current.time, Date.parse('2026-10-31T04:00:00Z'));
  assert.equal(second.response.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(weatherCalls, 2);
});

test('isolates Shanghai sun data by date and never serves the prior day after midnight', async () => {
  let clock = Date.parse('2026-10-31T15:50:00Z'); // 23:50 in Shanghai.
  const sunDates = [];
  const fetchImpl = (input) => {
    const url = new URL(input);
    if (url.pathname.includes('/sunrise/')) {
      const date = url.searchParams.get('date');
      sunDates.push(date);
      return Promise.resolve(jsonResponse(sunPayload(date)));
    }
    return Promise.resolve(
      jsonResponse(
        weatherPayload({
          rows: [{ time: new Date(clock).toISOString(), data: { instant: { details: {} } } }],
        }),
      ),
    );
  };
  const handler = createWorldWeatherHandler({ now: () => clock, fetchImpl });
  const first = await read(new Request(route), handler);
  assert.equal(first.body.sun.date, '2026-10-31');
  clock += 20 * 60 * 1000;
  const second = await read(new Request(route), handler);
  assert.equal(second.body.sun.date, '2026-11-01');
  assert.deepEqual(sunDates, ['2026-10-31', '2026-11-01']);
});

test('does not accept stale sunrise/sunset values from a different Shanghai date', async () => {
  const handler = createWorldWeatherHandler({
    now: () => initialNow,
    fetchImpl: fixtureFetch({ sun: sunPayload('2026-10-30') }),
  });
  const { body } = await read(new Request(route), handler);
  assert.equal(body.sunStatus, 'unavailable');
  assert.equal(body.sun, null);
});

test('expires weather stale fallback at six hours from either fetch or selected forecast time', async () => {
  let clock = initialNow;
  let weatherShouldFail = false;
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname.includes('/sunrise/')) return jsonResponse(sunPayload());
    if (weatherShouldFail) throw new Error('network failed');
    return jsonResponse(weatherPayload());
  };
  const handler = createWorldWeatherHandler({ now: () => clock, fetchImpl });
  await read(new Request(route), handler);
  clock += 11 * 60 * 1000;
  weatherShouldFail = true;
  const stale = await read(new Request(route), handler);
  assert.equal(stale.body.weatherStatus, 'stale');
  assert.equal(stale.body.current.temperature, 17.4);
  assert.equal(stale.response.headers.get('cache-control'), 'private, no-store, max-age=0');
  clock = Date.parse('2026-10-31T10:01:00Z');
  const expired = await read(new Request(route), handler);
  assert.equal(expired.body.weatherStatus, 'unavailable');
  assert.equal(expired.body.current, null);
});

test('long upstream freshness is capped by the selected weather timestamp', async () => {
  let clock = initialNow;
  let failing = false;
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname.includes('/sunrise/')) return jsonResponse(sunPayload());
    if (failing) throw new Error('forecast unavailable');
    return jsonResponse(weatherPayload(), { expires: dateFormat(clock + 24 * oneHour) });
  };
  const handler = createWorldWeatherHandler({ now: () => clock, fetchImpl });
  const fresh = await read(new Request(route), handler);
  assert.equal(fresh.body.weatherStatus, 'fresh');
  clock = Date.parse('2026-10-31T06:59:00Z');
  const stillFresh = await read(new Request(route), handler);
  assert.equal(stillFresh.body.weatherStatus, 'fresh');
  clock = Date.parse('2026-10-31T07:00:01Z');
  failing = true;
  const stale = await read(new Request(route), handler);
  assert.equal(stale.body.weatherStatus, 'stale');
});

test('times out hanging upstream calls and backs off 429/network failures without retrying each request', async () => {
  let clock = initialNow;
  let calls = 0;
  const fetchImpl = async (input) => {
    calls += 1;
    const url = new URL(input);
    if (url.pathname.includes('/sunrise/'))
      return new Response('rate limited', { status: 429, headers: { 'retry-after': '120' } });
    return new Promise(() => {});
  };
  const handler = createWorldWeatherHandler({ now: () => clock, timeoutMs: 10, fetchImpl });
  const timedOut = await read(new Request(route), handler);
  assert.equal(timedOut.response.status, 503);
  assert.equal(timedOut.body.current, null);
  assert.equal(timedOut.response.headers.get('cache-control'), 'private, no-store, max-age=0');
  assert.equal(calls, 2);
  await read(new Request(route), handler);
  assert.equal(calls, 2);
  clock += 121_000;
  await read(new Request(route), handler);
  assert.equal(calls, 4);
});

test('returns a no-store partial success when just one upstream resource is unavailable', async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname.includes('/sunrise/')) throw new Error('sun unavailable');
    return jsonResponse(weatherPayload());
  };
  const handler = createWorldWeatherHandler({ now: () => initialNow, fetchImpl });
  const { response, body } = await read(new Request(route), handler);
  assert.equal(response.status, 200);
  assert.equal(body.weatherStatus, 'fresh');
  assert.equal(body.sunStatus, 'unavailable');
  assert.ok(body.current);
  assert.equal(body.sun, null);
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0');
});

test('rejects query/path variants and non-GET/HEAD methods; HEAD omits body', async () => {
  let calls = 0;
  const handler = createWorldWeatherHandler({
    now: () => initialNow,
    fetchImpl: fixtureFetch({ onCall: () => calls++ }),
  });
  for (const request of [
    new Request('https://loom.test/api/world-weather/'),
    new Request(`${route}?lat=1`),
    new Request(route, { method: 'POST' }),
  ]) {
    const { response } = await read(request, handler);
    assert.ok([400, 404, 405].includes(response.status));
  }
  assert.equal(calls, 0);
  const head = await read(new Request(route, { method: 'HEAD' }), handler);
  assert.equal(head.response.status, 200);
  assert.equal(head.body, null);
});
