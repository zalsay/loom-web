const LONGITUDE = 119.36433054520208;
const LATITUDE = 26.042010002204606;
const TIME_ZONE = 'Asia/Shanghai';
const WEATHER_URL = '/api/world-weather';
const WEATHER_INTERVAL = 15 * 60 * 1000;
const WEATHER_JITTER = 90 * 1000;
const CACHE_MAX_AGE = WEATHER_INTERVAL;
const REQUEST_TIMEOUT = 12 * 1000;
const TICK_INTERVAL = 1000;
const CURRENT_MAX_AGE = 6 * 60 * 60 * 1000;
const WEATHER_LABELS = {
  clear: '晴朗',
  cloudy: '多云',
  overcast: '阴天',
  fog: '雾',
  rain: '降雨',
  snow: '降雪',
  sleet: '雨夹雪',
  thunder: '雷雨',
  unknown: '天气未知',
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const validNumber = (value) => typeof value === 'number' && Number.isFinite(value);

function shanghaiParts(epoch) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(epoch));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function getWorldSunlight(now, sun) {
  const { sunrise, sunset } = sun || {};
  const start = validNumber(sunrise) ? sunrise : null;
  const end = validNumber(sunset) ? sunset : null;
  if (
    start === null ||
    end === null ||
    end <= start ||
    !sun?.date ||
    sun.date !== formatDate(now) ||
    formatDate(start) !== sun.date ||
    formatDate(end) !== sun.date
  ) {
    return { phase: 'estimated', progress: null, label: '日照未知' };
  }
  const progress = clamp((now - start) / (end - start), 0, 1);
  if (now < start) return { phase: 'night', progress: 0, label: '日出前' };
  if (now > end) return { phase: 'night', progress: 1, label: '日落后' };
  const dawn = now < start + 45 * 60 * 1000;
  const dusk = now > end - 45 * 60 * 1000;
  return {
    phase: dawn ? 'dawn' : dusk ? 'dusk' : 'day',
    progress,
    label: dawn ? '晨光' : dusk ? '暮光' : '日间',
  };
}

export function getShanghaiDate(epoch) {
  return formatDate(epoch);
}

export function isWorldCurrentUsable(current, now = Date.now()) {
  return (
    !!current &&
    validNumber(current.time) &&
    current.time <= now + 5 * 60_000 &&
    now - current.time <= CURRENT_MAX_AGE
  );
}

export function isWorldWeatherCacheExpired(weather, now = Date.now()) {
  if (!weather?.fetchedAt || now - weather.fetchedAt >= CACHE_MAX_AGE) return true;
  const date = formatDate(now);
  const sun = weather.sun;
  if (!sun || sun.date !== date) return true;
  const validEvent = (event) =>
    event === null || (validNumber(event) && formatDate(event) === date);
  if (!validEvent(sun.sunrise) || !validEvent(sun.sunset)) return true;
  return validNumber(sun.sunrise) && validNumber(sun.sunset) && sun.sunset <= sun.sunrise;
}

export function getWeatherConditionLabel(condition) {
  return WEATHER_LABELS[condition] || WEATHER_LABELS.unknown;
}

export function normalizeWorldWeather(payload, now = Date.now()) {
  if (!payload || typeof payload !== 'object') return null;
  if (!Object.hasOwn(payload, 'current') || !Object.hasOwn(payload, 'sun')) return null;
  const location = payload.location;
  if (
    !location ||
    location.timeZone !== TIME_ZONE ||
    location.longitude !== LONGITUDE ||
    location.latitude !== LATITUDE ||
    location.name !== '织界 · 福州' ||
    !['fresh', 'stale', 'unavailable'].includes(payload.weatherStatus) ||
    !['fresh', 'stale', 'unavailable'].includes(payload.sunStatus) ||
    !validNumber(payload.fetchedAt) ||
    payload.fetchedAt > now + 5 * 60_000
  )
    return null;

  const source = payload.source && typeof payload.source === 'object' ? payload.source : {};
  if (
    source.name !== 'MET Norway' ||
    source.kind !== 'forecast' ||
    typeof source.url !== 'string' ||
    typeof source.licenseUrl !== 'string'
  )
    return null;
  const sourceUrl = safeUrl(source.url, 'https://api.met.no/');
  const licenseUrl = safeUrl(source.licenseUrl, 'https://creativecommons.org/licenses/by/4.0/');
  const currentPayload =
    payload.current && typeof payload.current === 'object' ? payload.current : null;
  const currentKeys = [
    'time',
    'temperature',
    'humidity',
    'cloudCover',
    'windSpeed',
    'windDirection',
    'precipitation',
    'symbol',
    'condition',
  ];
  const currentShape =
    currentPayload && currentKeys.every((key) => Object.hasOwn(currentPayload, key));
  const numericKeys = [
    'temperature',
    'humidity',
    'cloudCover',
    'windSpeed',
    'windDirection',
    'precipitation',
  ];
  const currentValuesValid =
    currentShape &&
    numericKeys.every((key) => currentPayload[key] === null || validNumber(currentPayload[key])) &&
    typeof currentPayload.symbol === 'string' &&
    Object.hasOwn(WEATHER_LABELS, currentPayload.condition);
  const validCurrentTime = currentValuesValid && isWorldCurrentUsable(currentPayload, now);
  const current = validCurrentTime
    ? {
        time: currentPayload.time,
        temperature: nullableNumber(currentPayload.temperature),
        humidity: nullableNumber(currentPayload.humidity),
        cloudCover: nullableNumber(currentPayload.cloudCover),
        windSpeed: nullableNumber(currentPayload.windSpeed),
        windDirection: nullableNumber(currentPayload.windDirection),
        precipitation: nullableNumber(currentPayload.precipitation),
        symbol: typeof currentPayload.symbol === 'string' ? currentPayload.symbol.slice(0, 80) : '',
        condition: currentPayload.condition,
      }
    : null;
  const sunPayload = payload.sun && typeof payload.sun === 'object' ? payload.sun : null;
  const expectedDate = shanghaiParts(now);
  const expectedSunDate = `${expectedDate.year}-${expectedDate.month}-${expectedDate.day}`;
  const sunShape =
    sunPayload &&
    typeof sunPayload.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(sunPayload.date) &&
    Object.hasOwn(sunPayload, 'sunrise') &&
    Object.hasOwn(sunPayload, 'sunset');
  const sunEvent = (value) => {
    if (value === null) return null;
    if (!validNumber(value) || formatDate(value) !== expectedSunDate) return undefined;
    return value;
  };
  const sunrise =
    sunShape && sunPayload.date === expectedSunDate ? sunEvent(sunPayload.sunrise) : undefined;
  const sunset =
    sunShape && sunPayload.date === expectedSunDate ? sunEvent(sunPayload.sunset) : undefined;
  const sun =
    sunShape && sunPayload.date === expectedSunDate && sunrise !== undefined && sunset !== undefined
      ? {
          date: expectedSunDate,
          sunrise,
          sunset,
        }
      : null;
  const fetchedAt = payload.fetchedAt;
  const weatherStatus = payload.weatherStatus;
  const sunStatus = payload.sunStatus;
  const staleByAge = now - fetchedAt >= CACHE_MAX_AGE;
  return {
    location: {
      longitude: LONGITUDE,
      latitude: LATITUDE,
      timeZone: TIME_ZONE,
      name: typeof location.name === 'string' ? location.name.slice(0, 40) : '织界 · 福州',
    },
    source: {
      name: typeof source.name === 'string' ? source.name.slice(0, 60) : 'MET Norway',
      url: sourceUrl,
      licenseUrl,
      kind: source.kind === 'forecast' ? 'forecast' : 'forecast',
    },
    fetchedAt,
    modelUpdatedAt: validNumber(payload.modelUpdatedAt) ? payload.modelUpdatedAt : null,
    weatherStatus: !current ? 'unavailable' : staleByAge ? 'stale' : weatherStatus,
    sunStatus: !sun
      ? sunStatus === 'stale'
        ? 'stale'
        : 'unavailable'
      : staleByAge && sunStatus === 'fresh'
        ? 'stale'
        : sunStatus,
    current,
    sun,
    precipitationPeriodHours: validNumber(payload.precipitationPeriodHours)
      ? payload.precipitationPeriodHours
      : null,
  };
}

function nullableNumber(value) {
  return validNumber(value) ? value : null;
}

function safeUrl(value, fallback) {
  if (typeof value !== 'string') return fallback;
  try {
    const url = new URL(value, 'https://api.met.no/');
    return url.protocol === 'https:' ? url.href : fallback;
  } catch {
    return fallback;
  }
}

function formatClock(epoch) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(epoch));
}

function formatTime(epoch) {
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(epoch));
}

function formatDate(epoch) {
  const parts = shanghaiParts(epoch);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatDateLabel(epoch) {
  const parts = shanghaiParts(epoch);
  return `${Number(parts.month)}月${Number(parts.day)}日`;
}

function updateArc(progress) {
  const arc = document.querySelector('#world-sun-arc-progress');
  const marker = document.querySelector('#world-sun-marker');
  if (!arc || !marker) return;
  if (!validNumber(progress)) {
    arc.style.strokeDasharray = '0 100';
    marker.setAttribute('cx', '9');
    marker.setAttribute('cy', '28');
    return;
  }
  const value = clamp(progress, 0, 1);
  arc.style.strokeDasharray = `${(value * 100).toFixed(2)} 100`;
  const angle = Math.PI * (1 - value);
  marker.setAttribute('cx', (50 + 41 * Math.cos(angle)).toFixed(2));
  marker.setAttribute('cy', (28 - 25 * Math.sin(angle)).toFixed(2));
}

function render(state) {
  const hud = document.querySelector('#world-weather-hud');
  if (!hud) return;
  const time = document.querySelector('#world-local-time');
  const localDate = document.querySelector('#world-local-date');
  const condition = document.querySelector('#world-weather-condition');
  const temperature = document.querySelector('#world-weather-temperature');
  const sunrise = document.querySelector('#world-sunrise');
  const sunset = document.querySelector('#world-sunset');
  const phaseLabel = document.querySelector('#world-sun-phase');
  const locationLabel = document.querySelector('#world-weather-location');
  if (time) time.textContent = formatClock(state.now);
  if (time) time.dateTime = new Date(state.now).toISOString();
  if (localDate) localDate.textContent = formatDateLabel(state.now);
  const current = state.current;
  if (condition) {
    const label = current ? getWeatherConditionLabel(current.condition) : '--';
    condition.textContent = label === '天气未知' ? '--' : label;
  }
  if (temperature)
    temperature.textContent =
      current?.temperature !== null && current?.temperature !== undefined
        ? `${Math.round(current.temperature)}°`
        : '--°';
  const sunlight = getWorldSunlight(state.now, state.sun);
  if (sunrise)
    sunrise.textContent = validNumber(state.sun?.sunrise)
      ? `日出 ${formatTime(state.sun.sunrise)}`
      : '日出 --:--';
  if (sunset)
    sunset.textContent = validNumber(state.sun?.sunset)
      ? `日落 ${formatTime(state.sun.sunset)}`
      : '日落 --:--';
  if (phaseLabel) phaseLabel.textContent = sunlight.phase === 'estimated' ? '' : sunlight.label;
  if (locationLabel) locationLabel.textContent = state.location?.name || '织界 · 福州';
  hud.dataset.weatherStatus = state.weatherStatus;
  hud.dataset.sunStatus = state.sunStatus;
  hud.dataset.phase = sunlight.phase;
  updateArc(sunlight.progress);
}

export function createWorldWeather({
  onChange = () => {},
  isActive = () => true,
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  let running = false;
  let ticker = null;
  let pollTimer = null;
  let requestController = null;
  let requestPromise = null;
  let requestGeneration = 0;
  let state = {
    now: now(),
    current: null,
    sun: null,
    weatherStatus: 'unavailable',
    sunStatus: 'unavailable',
    fetchedAt: null,
    modelUpdatedAt: null,
    source: {
      name: 'MET Norway',
      url: 'https://api.met.no/',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      kind: 'forecast',
    },
    location: {
      longitude: LONGITUDE,
      latitude: LATITUDE,
      timeZone: TIME_ZONE,
      name: '织界 · 福州',
    },
  };
  let wasActive = false;
  let previousDate = formatDate(state.now);
  let lastMinute = Math.floor(state.now / 60_000);

  const publish = () => {
    render(state);
    onChange({
      ...state,
      current: state.current ? { ...state.current } : null,
      sun: state.sun ? { ...state.sun } : null,
    });
  };
  const isExpired = () => isWorldWeatherCacheExpired(state, now());
  const schedulePoll = () => {
    if (!running || !isActive() || pollTimer) return;
    const jitter = Math.floor(Math.random() * WEATHER_JITTER);
    pollTimer = setTimeout(() => {
      pollTimer = null;
      if (!running) return;
      if (isActive()) refresh();
      schedulePoll();
    }, WEATHER_INTERVAL + jitter);
  };
  const refresh = () => {
    if (!running || !isActive()) return state;
    if (requestPromise) return requestPromise;
    const generation = ++requestGeneration;
    const localController = typeof AbortController === 'function' ? new AbortController() : null;
    requestController = localController;
    let timeout = null;
    if (localController) timeout = setTimeout(() => localController.abort(), REQUEST_TIMEOUT);
    const promise = (async () => {
      try {
        const response = await fetchImpl(WEATHER_URL, {
          method: 'GET',
          credentials: 'omit',
          headers: { Accept: 'application/json' },
          signal: localController?.signal,
        });
        if (!response?.ok)
          throw new Error(`Weather request failed (${response?.status || 'network'})`);
        const payload = await response.json();
        const normalized = normalizeWorldWeather(payload, now());
        if (!normalized)
          throw new Error('Weather response did not match the fixed Fuzhou location contract');
        if (!running || generation !== requestGeneration) return state;
        state = { ...normalized, now: now() };
        publish();
      } catch {
        if (running && generation === requestGeneration) {
          const currentNow = now();
          const current = isWorldCurrentUsable(state.current, currentNow) ? state.current : null;
          const keepSun = state.sun?.date === formatDate(currentNow) ? state.sun : null;
          state = {
            ...state,
            now: currentNow,
            current,
            weatherStatus: current ? 'stale' : 'unavailable',
            sunStatus: keepSun ? 'stale' : 'unavailable',
            sun: keepSun,
          };
          publish();
        }
      } finally {
        if (timeout !== null) clearTimeout(timeout);
        if (generation === requestGeneration) {
          requestController = null;
          requestPromise = null;
        }
      }
      return state;
    })();
    requestPromise = promise;
    return promise;
  };
  const tick = () => {
    if (!running) return;
    const currentNow = now();
    const date = formatDate(currentNow);
    const minute = Math.floor(currentNow / 60_000);
    const changedDay = date !== previousDate;
    const changedMinute = minute !== lastMinute;
    const active = !!isActive();
    const becameActive = active && !wasActive;
    document.body.dataset.worldInactive = active ? 'false' : 'true';
    state.now = currentNow;
    const currentExpired = !!state.current && !isWorldCurrentUsable(state.current, currentNow);
    if (currentExpired) {
      state.current = null;
      state.weatherStatus = 'unavailable';
    }
    if (changedDay) {
      previousDate = date;
      if (state.sun?.date !== date) {
        state.sun = null;
        state.sunStatus = 'unavailable';
      }
      if (active) refresh();
    } else if (becameActive && isExpired()) {
      refresh();
    }
    if (active) schedulePoll();
    else if (pollTimer !== null) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
    wasActive = active;
    if (changedMinute || changedDay || currentExpired) {
      lastMinute = minute;
      publish();
    } else {
      render(state);
    }
  };
  const onVisibilityChange = () => {
    if (document.hidden) return;
    const active = !!isActive();
    document.body.dataset.worldInactive = active ? 'false' : 'true';
    if (active && isExpired()) refresh();
    wasActive = active;
  };
  const start = () => {
    if (running) return;
    running = true;
    wasActive = !!isActive();
    document.body.dataset.worldInactive = wasActive ? 'false' : 'true';
    document.addEventListener('visibilitychange', onVisibilityChange);
    ticker = setInterval(tick, TICK_INTERVAL);
    publish();
    if (wasActive) refresh();
    schedulePoll();
  };
  const stop = () => {
    if (!running) return;
    running = false;
    if (ticker !== null) clearInterval(ticker);
    if (pollTimer !== null) clearTimeout(pollTimer);
    ticker = null;
    pollTimer = null;
    document.removeEventListener('visibilitychange', onVisibilityChange);
    requestGeneration++;
    requestController?.abort();
    requestController = null;
    requestPromise = null;
  };

  return {
    start,
    stop,
    refresh,
    getState: () => ({
      ...state,
      location: { ...state.location },
      source: { ...state.source },
      current: state.current ? { ...state.current } : null,
      sun: state.sun ? { ...state.sun } : null,
    }),
  };
}
