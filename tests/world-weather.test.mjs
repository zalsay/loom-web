import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getShanghaiDate,
  getWeatherConditionLabel,
  getWorldSunlight,
  isWorldCurrentUsable,
  isWorldWeatherCacheExpired,
  normalizeWorldWeather,
} from '../web/js/world-weather.js';

const epoch = (value) => Date.parse(value);

function payload(now, overrides = {}) {
  const date = getShanghaiDate(now);
  const sunrise = epoch(`${date}T06:10:00+08:00`);
  const sunset = epoch(`${date}T17:21:00+08:00`);
  return {
    location: {
      longitude: 119.36433054520208,
      latitude: 26.042010002204606,
      timeZone: 'Asia/Shanghai',
      name: '织界 · 福州',
    },
    source: {
      name: 'MET Norway',
      url: 'https://api.met.no/',
      licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
      kind: 'forecast',
    },
    fetchedAt: now - 30_000,
    weatherStatus: 'fresh',
    sunStatus: 'fresh',
    current: {
      time: now - 15_000,
      temperature: 23.3,
      humidity: 72,
      cloudCover: 12,
      windSpeed: 1.8,
      windDirection: 95,
      precipitation: 0,
      symbol: 'clearsky_day',
      condition: 'clear',
    },
    sun: { date, sunrise, sunset },
    ...overrides,
  };
}

test('Fuzhou wall time and date are fixed to Asia/Shanghai across host timezone dates', () => {
  const beforeShanghaiMidnight = epoch('2026-11-01T15:59:59Z');
  const afterShanghaiMidnight = epoch('2026-11-01T16:00:01Z');

  assert.equal(getShanghaiDate(beforeShanghaiMidnight), '2026-11-01');
  assert.equal(getShanghaiDate(afterShanghaiMidnight), '2026-11-02');
  assert.equal(getShanghaiDate(beforeShanghaiMidnight - 12 * 60 * 60_000), '2026-11-01');
});

test('sunlight phase maps daylight and rejects a previous local date', () => {
  const noon = epoch('2026-10-31T12:00:00+08:00');
  const today = payload(noon).sun;
  assert.equal(getWorldSunlight(noon, today).phase, 'day');
  assert.equal(getWorldSunlight(today.sunset + 1, today).phase, 'night');
  const afterSunset = epoch('2026-10-31T18:21:01+08:00');
  assert.equal(getWorldSunlight(afterSunset, today).phase, 'night');
  assert.equal(getWorldSunlight(epoch('2026-11-01T00:01:00+08:00'), today).phase, 'estimated');
  assert.equal(getWorldSunlight(epoch('2026-11-01T00:01:00+08:00'), today).label, '日照未知');
  assert.deepEqual(getWorldSunlight(noon, null), {
    phase: 'estimated',
    progress: null,
    label: '日照未知',
  });
});

test('payload maps model weather and preserves nullable measurements without inventing clear skies', () => {
  const now = epoch('2026-10-31T12:00:00+08:00');
  const result = normalizeWorldWeather(
    payload(now, {
      current: { ...payload(now).current, temperature: null, condition: 'rain', symbol: 'rain' },
    }),
    now,
  );

  assert.equal(result.current.condition, 'rain');
  assert.equal(result.current.temperature, null);
  assert.equal(result.weatherStatus, 'fresh');
  assert.equal(result.sun.date, '2026-10-31');
  assert.equal(getWeatherConditionLabel('snow'), '降雪');
  assert.equal(getWeatherConditionLabel('not-a-condition'), '天气未知');

  const unavailable = normalizeWorldWeather(payload(now, { current: null }), now);
  assert.equal(unavailable.current, null);
  assert.equal(unavailable.weatherStatus, 'unavailable');
});

test('bad coordinates, missing contract fields, old current data, and yesterday sun are rejected or withheld', () => {
  const now = epoch('2026-11-01T16:01:00Z');
  const valid = payload(now);

  assert.equal(
    normalizeWorldWeather({ ...valid, location: { ...valid.location, longitude: 0 } }, now),
    null,
  );
  assert.equal(
    normalizeWorldWeather({ ...valid, current: { condition: 'clear' } }, now).current,
    null,
  );
  assert.equal(
    normalizeWorldWeather(
      { ...valid, current: { ...valid.current, time: now - 7 * 60 * 60_000 } },
      now,
    ).current,
    null,
  );

  const yesterdaySun = normalizeWorldWeather(
    {
      ...valid,
      sun: payload(now - 24 * 60 * 60_000).sun,
    },
    now,
  );
  assert.equal(yesterdaySun.sun, null);
  assert.equal(yesterdaySun.sunStatus, 'unavailable');
  assert.equal(getWorldSunlight(now, yesterdaySun.sun).phase, 'estimated');
});

test('stale backend data and cache age cannot be presented as fresh', () => {
  const now = epoch('2026-10-31T12:00:00+08:00');
  const stale = normalizeWorldWeather(
    payload(now, { weatherStatus: 'stale', sunStatus: 'stale' }),
    now,
  );
  assert.equal(stale.weatherStatus, 'stale');
  assert.equal(stale.sunStatus, 'stale');

  const aged = normalizeWorldWeather(payload(now, { fetchedAt: now - 16 * 60_000 }), now);
  assert.equal(aged.weatherStatus, 'stale');
  assert.equal(aged.sunStatus, 'stale');
});

test('current weather remains usable only while its observation is within the freshness window', () => {
  const now = epoch('2026-10-31T12:00:00+08:00');
  assert.equal(isWorldCurrentUsable({ time: now - 6 * 60 * 60_000 }, now), true);
  assert.equal(isWorldCurrentUsable({ time: now - 6 * 60 * 60_000 - 1 }, now), false);
  assert.equal(isWorldCurrentUsable({ time: now + 5 * 60_000 + 1 }, now), false);
  assert.equal(isWorldCurrentUsable(null, now), false);
});

test('weather cache expires when same-day sun data is missing or mismatched', () => {
  const now = epoch('2026-10-31T12:00:00+08:00');
  const valid = normalizeWorldWeather(payload(now), now);
  assert.equal(isWorldWeatherCacheExpired(valid, now), false);
  assert.equal(isWorldWeatherCacheExpired({ ...valid, sun: null }, now), true);
  assert.equal(
    isWorldWeatherCacheExpired({ ...valid, sun: { ...valid.sun, date: '2026-10-30' } }, now),
    true,
  );
  assert.equal(
    isWorldWeatherCacheExpired(
      { ...valid, sun: { ...valid.sun, sunrise: epoch('2026-10-30T06:10:00+08:00') } },
      now,
    ),
    true,
  );
});
