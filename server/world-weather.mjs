const LOCATION = Object.freeze({
  longitude: 119.36433054520208,
  latitude: 26.042010002204606,
  timeZone: 'Asia/Shanghai',
  name: '织界 · 福州',
});
const FORECAST_LATITUDE = '26.0420';
const FORECAST_LONGITUDE = '119.3643';
const WEATHER_URL = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';
const SUN_URL = 'https://api.met.no/weatherapi/sunrise/3.0/sun';
const SOURCE = Object.freeze({
  name: 'MET Norway',
  url: 'https://api.met.no/',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
  kind: 'forecast',
});
const ROUTE = '/api/world-weather';
const MAX_CURRENT_AGE_MS = 3 * 60 * 60 * 1000;
const MAX_CURRENT_FUTURE_MS = 5 * 60 * 1000;
const MAX_WEATHER_AGE_MS = 6 * 60 * 60 * 1000;
const DEFAULT_WEATHER_TTL_MS = 10 * 60 * 1000;
const DEFAULT_SUN_TTL_MS = 60 * 60 * 1000;
const MAX_UPSTREAM_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_USER_AGENT = 'loom-web/1.0 https://github.com/zalsay/loom-web';
const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
};

class UpstreamError extends Error {
  constructor(retryAt = null) {
    super('upstream_unavailable');
    this.retryAt = retryAt;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseTimestamp(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

function finiteOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function conditionForSymbol(symbol) {
  const code = symbol.toLowerCase();
  if (!code || code === 'unknown') return 'unknown';
  if (code.includes('thunder')) return 'thunder';
  if (code.includes('sleet')) return 'sleet';
  if (code.includes('snow')) return 'snow';
  if (code.includes('rain')) return 'rain';
  if (code.includes('fog')) return 'fog';
  if (code.includes('cloudy')) return code.includes('partlycloudy') ? 'cloudy' : 'overcast';
  if (code.includes('clearsky') || code.includes('fair')) return 'clear';
  return 'unknown';
}

function normalizeWeather(payload, at) {
  const properties = payload?.properties;
  if (!isRecord(properties) || !Array.isArray(properties.timeseries)) throw new UpstreamError();

  const candidates = properties.timeseries
    .map((row) => {
      const timestamp = parseTimestamp(row?.time);
      return timestamp === null || !isRecord(row?.data) ? null : { row, timestamp };
    })
    .filter(
      (candidate) =>
        candidate &&
        (candidate.timestamp <= at
          ? at - candidate.timestamp <= MAX_WEATHER_AGE_MS
          : candidate.timestamp - at <= MAX_CURRENT_FUTURE_MS),
    );
  const past = candidates.filter((candidate) => candidate.timestamp <= at);
  past.sort((left, right) => right.timestamp - left.timestamp);
  const future = candidates.filter((candidate) => candidate.timestamp > at);
  future.sort((left, right) => left.timestamp - right.timestamp);
  const selected = past[0] ?? future[0];
  if (!selected || !isRecord(selected.row?.data)) throw new UpstreamError();

  const data = selected.row.data;
  const details = data.instant?.details;
  const nextOneHour = data.next_1_hours;
  const nextSixHours = data.next_6_hours;
  const oneHourPrecipitation = finiteOrNull(nextOneHour?.details?.precipitation_amount);
  const sixHourPrecipitation = finiteOrNull(nextSixHours?.details?.precipitation_amount);
  const precipitation = oneHourPrecipitation ?? sixHourPrecipitation;
  const symbol =
    (typeof nextOneHour?.summary?.symbol_code === 'string' && nextOneHour.summary.symbol_code.trim()
      ? nextOneHour.summary.symbol_code.trim()
      : null) ||
    (typeof nextSixHours?.summary?.symbol_code === 'string' &&
    nextSixHours.summary.symbol_code.trim()
      ? nextSixHours.summary.symbol_code.trim()
      : null) ||
    'unknown';

  return {
    current: {
      time: selected.timestamp,
      temperature: finiteOrNull(details?.air_temperature),
      humidity: finiteOrNull(details?.relative_humidity),
      cloudCover: finiteOrNull(details?.cloud_area_fraction),
      windSpeed: finiteOrNull(details?.wind_speed),
      windDirection: finiteOrNull(details?.wind_from_direction),
      precipitation,
      symbol,
      condition: conditionForSymbol(symbol),
      precipitationPeriodHours:
        precipitation === null ? null : oneHourPrecipitation === null ? 6 : 1,
    },
    modelUpdatedAt: parseTimestamp(properties.meta?.updated_at),
  };
}

function dateInShanghai(at) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: LOCATION.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(at));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function nextShanghaiMidnight(date) {
  const [year, month, day] = date.split('-').map(Number);
  // Asia/Shanghai is UTC+08:00 and has no daylight-saving transitions.
  return Date.UTC(year, month - 1, day + 1) - 8 * 60 * 60 * 1000;
}

function normalizeSun(payload, date) {
  const properties = payload?.properties;
  if (!isRecord(properties)) throw new UpstreamError();
  const sunrise = parseTimestamp(properties.sunrise?.time);
  const sunset = parseTimestamp(properties.sunset?.time);
  if (
    (sunrise === null && sunset === null) ||
    (sunrise !== null && dateInShanghai(sunrise) !== date) ||
    (sunset !== null && dateInShanghai(sunset) !== date) ||
    (sunrise !== null && sunset !== null && sunrise >= sunset)
  )
    throw new UpstreamError();
  return {
    date,
    sunrise,
    sunset,
  };
}

function makeUpstreamUrl(kind, date) {
  const params = new URLSearchParams([
    ['lat', FORECAST_LATITUDE],
    ['lon', FORECAST_LONGITUDE],
  ]);
  if (kind === 'sun') {
    params.set('date', date);
    params.set('offset', '+08:00');
  }
  return `${kind === 'weather' ? WEATHER_URL : SUN_URL}?${params.toString()}`;
}

function retryAtFromHeader(value, at) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) {
    const delay = Number(trimmed) * 1000;
    return Number.isFinite(delay) ? at + delay : null;
  }
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function responseExpiry(headers, at, fallbackMs) {
  const cacheControl = headers.get('cache-control') || '';
  if (/\bno-cache\b/i.test(cacheControl)) return at;
  const ageSeconds = Number(headers.get('age') || 0);
  const ageMs = Number.isFinite(ageSeconds) && ageSeconds > 0 ? ageSeconds * 1000 : 0;

  const maxAge = cacheControl.match(/(?:^|,)\s*max-age\s*=\s*"?(\d+(?:\.\d+)?)"?/i);
  if (maxAge) {
    const duration = Number(maxAge[1]) * 1000;
    if (Number.isFinite(duration)) return at + Math.max(0, duration - ageMs);
  }

  const expires = parseTimestamp(headers.get('expires'));
  if (expires === null) return at + fallbackMs;
  const date = parseTimestamp(headers.get('date'));
  const remaining = (date === null ? expires - at : expires - date) - ageMs;
  return at + Math.max(0, remaining);
}

async function readJson(response) {
  if (!response.body) throw new UpstreamError();
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_UPSTREAM_BYTES) {
        await reader.cancel();
        throw new UpstreamError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new UpstreamError();
  }
}

async function withTimeout(task, timeoutMs) {
  const controller = new AbortController();
  let timer;
  const interrupted = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new UpstreamError());
    }, timeoutMs);
  });
  // Avoid an unhandled rejection if the upstream task settles before the timer.
  interrupted.catch(() => {});
  try {
    return await Promise.race([Promise.resolve().then(() => task(controller.signal)), interrupted]);
  } finally {
    clearTimeout(timer);
  }
}

function safeUserAgent(value) {
  return typeof value === 'string' && value.trim() && !/[\r\n]/.test(value)
    ? value.trim()
    : DEFAULT_USER_AGENT;
}

function makeState() {
  return { entry: null, flight: null, failures: 0, retryAt: 0 };
}

function canUseStale(kind, entry, at) {
  if (!entry || at >= entry.staleUntilAt) return false;
  if (kind === 'sun') return at < entry.localDayEndsAt;
  return (
    at - entry.fetchedAt <= MAX_WEATHER_AGE_MS &&
    at - entry.value.current.time <= MAX_WEATHER_AGE_MS &&
    entry.value.current.time <= at + MAX_CURRENT_FUTURE_MS
  );
}

function classifyEntry(kind, state, at) {
  const entry = state.entry;
  if (entry && at < entry.expiresAt) {
    if (kind === 'sun' ? at < entry.localDayEndsAt : canUseStale(kind, entry, at))
      return { status: 'fresh', entry };
  }
  if (canUseStale(kind, entry, at)) return { status: 'stale', entry };
  return { status: 'unavailable', entry: null };
}

function classifyTransientEntry(kind, entry, at) {
  if (kind !== 'weather' || at < entry.value.current.time + MAX_CURRENT_AGE_MS)
    return { status: 'fresh', entry };
  if (canUseStale(kind, entry, at)) return { status: 'stale', entry };
  return { status: 'unavailable', entry: null };
}

function createFailureBackoff(state, error, at) {
  state.failures += 1;
  const exponentialDelay = Math.min(30_000 * 2 ** Math.min(state.failures - 1, 10), 5 * 60_000);
  state.retryAt = Math.max(at + exponentialDelay, error?.retryAt ?? 0);
}

export function createWorldWeatherHandler({
  fetchImpl = fetch,
  now = Date.now,
  userAgent = process.env.LOOM_WEATHER_USER_AGENT || DEFAULT_USER_AGENT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  const requestTimeoutMs =
    Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
  const upstreamAgent = safeUserAgent(userAgent);
  const weatherState = makeState();
  const sunStates = new Map();

  async function refresh(kind, state, date) {
    const headers = new Headers({ accept: 'application/json', 'user-agent': upstreamAgent });
    if (state.entry?.lastModified) headers.set('if-modified-since', state.entry.lastModified);
    try {
      const result = await withTimeout(async (signal) => {
        const response = await fetchImpl(makeUpstreamUrl(kind, date), {
          method: 'GET',
          headers,
          signal,
          redirect: 'error',
        });
        if (response.status === 304) return { response, payload: null };
        if (!response.ok) {
          const retryAt =
            response.status === 429
              ? retryAtFromHeader(response.headers.get('retry-after'), now())
              : null;
          void response.body?.cancel().catch(() => {});
          throw new UpstreamError(retryAt);
        }
        return { response, payload: await readJson(response) };
      }, requestTimeoutMs);

      const checkedAt = now();
      const response = result.response;
      const upstreamNoReuse = /\b(?:no-store|no-cache)\b/i.test(
        response.headers.get('cache-control') || '',
      );
      let transientEntry = null;
      if (response.status === 304) {
        if (!state.entry) throw new UpstreamError();
        const headersAt = responseExpiry(
          response.headers,
          checkedAt,
          kind === 'weather' ? DEFAULT_WEATHER_TTL_MS : DEFAULT_SUN_TTL_MS,
        );
        const localDayEndsAt = kind === 'sun' ? nextShanghaiMidnight(date) : Infinity;
        state.entry = {
          ...state.entry,
          checkedAt,
          lastModified: response.headers.get('last-modified') || state.entry.lastModified,
          expiresAt:
            kind === 'weather'
              ? Math.min(
                  headersAt,
                  state.entry.fetchedAt + MAX_WEATHER_AGE_MS,
                  state.entry.value.current.time + MAX_CURRENT_AGE_MS,
                  state.entry.value.current.time + MAX_WEATHER_AGE_MS,
                )
              : Math.min(headersAt, localDayEndsAt),
          staleUntilAt:
            kind === 'weather'
              ? Math.min(
                  state.entry.fetchedAt + MAX_WEATHER_AGE_MS,
                  state.entry.value.current.time + MAX_WEATHER_AGE_MS,
                )
              : localDayEndsAt,
          localDayEndsAt,
        };
        if (upstreamNoReuse || state.entry.expiresAt <= checkedAt) {
          transientEntry = { ...state.entry, cacheable: false };
          state.entry = null;
        }
      } else {
        const value =
          kind === 'weather'
            ? normalizeWeather(result.payload, checkedAt)
            : normalizeSun(result.payload, date);
        const rawExpiry = responseExpiry(
          response.headers,
          checkedAt,
          kind === 'weather' ? DEFAULT_WEATHER_TTL_MS : DEFAULT_SUN_TTL_MS,
        );
        const localDayEndsAt = kind === 'sun' ? nextShanghaiMidnight(date) : Infinity;
        const weatherStaleUntil =
          kind === 'weather'
            ? Math.min(checkedAt + MAX_WEATHER_AGE_MS, value.current.time + MAX_WEATHER_AGE_MS)
            : Infinity;
        const entry = {
          value,
          fetchedAt: checkedAt,
          checkedAt,
          lastModified: response.headers.get('last-modified'),
          expiresAt:
            kind === 'weather'
              ? Math.min(rawExpiry, weatherStaleUntil, value.current.time + MAX_CURRENT_AGE_MS)
              : Math.min(rawExpiry, localDayEndsAt),
          staleUntilAt: kind === 'weather' ? weatherStaleUntil : localDayEndsAt,
          localDayEndsAt,
        };
        if (upstreamNoReuse || entry.expiresAt <= checkedAt) {
          transientEntry = { ...entry, cacheable: false };
          state.entry = null;
        } else {
          state.entry = entry;
        }
      }
      state.failures = 0;
      state.retryAt = 0;
      return transientEntry ? { entry: transientEntry } : null;
    } catch (error) {
      createFailureBackoff(state, error, now());
      return null;
    }
  }

  async function getResource(kind, date) {
    let state;
    if (kind === 'weather') state = weatherState;
    else {
      state = sunStates.get(date);
      if (!state) {
        state = makeState();
        sunStates.set(date, state);
      }
      for (const [oldDate, oldState] of sunStates) {
        if (oldDate !== date && !oldState.flight) sunStates.delete(oldDate);
      }
    }

    const at = now();
    let result = classifyEntry(kind, state, at);
    if (result.status === 'fresh') return result;
    if (state.retryAt > at) return result;

    if (!state.flight) {
      const flight = refresh(kind, state, date).finally(() => {
        if (state.flight === flight) state.flight = null;
      });
      state.flight = flight;
    }
    const refreshed = await state.flight;
    result = classifyEntry(kind, state, now());
    if (result.status === 'unavailable' && refreshed?.entry)
      result = classifyTransientEntry(kind, refreshed.entry, now());
    return result;
  }

  function jsonResponse(
    request,
    status,
    payload,
    cacheControl = 'private, no-store, max-age=0',
    extra = {},
  ) {
    const headers = new Headers({ ...JSON_HEADERS, 'cache-control': cacheControl, ...extra });
    return new Response(request.method.toUpperCase() === 'HEAD' ? null : JSON.stringify(payload), {
      status,
      headers,
    });
  }

  return async function handle(request) {
    const method = request.method.toUpperCase();
    let url;
    try {
      url = new URL(request.url);
    } catch {
      return jsonResponse(request, 400, { error: { code: 'invalid_request' } });
    }
    if (url.pathname !== ROUTE) return jsonResponse(request, 404, { error: { code: 'not_found' } });
    if (url.search || url.href.includes('?'))
      return jsonResponse(request, 400, { error: { code: 'query_not_allowed' } });
    if (method !== 'GET' && method !== 'HEAD')
      return jsonResponse(request, 405, { error: { code: 'method_not_allowed' } }, undefined, {
        allow: 'GET, HEAD',
      });

    const requestAt = now();
    const date = dateInShanghai(requestAt);
    const [weather, firstSun] = await Promise.all([
      getResource('weather', null),
      getResource('sun', date),
    ]);
    let sun = firstSun;
    let servingDate = dateInShanghai(now());
    if (sun.entry?.value.date !== servingDate) {
      sun = await getResource('sun', servingDate);
      servingDate = dateInShanghai(now());
    }
    if (sun.entry?.value.date !== servingDate) sun = { status: 'unavailable', entry: null };
    const servingWeather =
      weather.entry?.cacheable === false ? weather : classifyEntry('weather', weatherState, now());
    const weatherValue = servingWeather.entry?.value ?? null;
    const sunValue = sun.entry?.value ?? null;
    const allUnavailable = servingWeather.status === 'unavailable' && sun.status === 'unavailable';
    const cacheSeconds = Math.min(
      ...[servingWeather, sun].map((item) =>
        item.status === 'fresh'
          ? Math.max(0, Math.floor((item.entry.expiresAt - now()) / 1000))
          : 0,
      ),
    );
    const payload = {
      location: LOCATION,
      source: SOURCE,
      fetchedAt: servingWeather.entry?.fetchedAt ?? sun.entry?.fetchedAt ?? now(),
      weatherFetchedAt: servingWeather.entry?.fetchedAt ?? null,
      sunFetchedAt: sun.entry?.fetchedAt ?? null,
      servedAt: now(),
      weatherStatus: servingWeather.status,
      sunStatus: sun.status,
      current: servingWeather.status === 'unavailable' ? null : (weatherValue?.current ?? null),
      sun: sunValue,
      modelUpdatedAt: weatherValue?.modelUpdatedAt ?? null,
    };
    const hasFailure =
      servingWeather.status !== 'fresh' ||
      sun.status !== 'fresh' ||
      servingWeather.entry?.cacheable === false ||
      sun.entry?.cacheable === false;
    const cacheControl = hasFailure
      ? 'private, no-store, max-age=0'
      : `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}, must-revalidate`;
    return jsonResponse(request, allUnavailable ? 503 : 200, payload, cacheControl);
  };
}
