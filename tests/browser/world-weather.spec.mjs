import { test, expect } from '@playwright/test';

const MODEL = 'https://api.met.no/';
const LICENSE = 'https://creativecommons.org/licenses/by/4.0/';

function overlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function makePayload(now, condition = 'clear', overrides = {}) {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
  const event = (time) => {
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    return Date.UTC(year, month - 1, day, hour - 8, minute);
  };
  return {
    location: {
      longitude: 119.36433054520208,
      latitude: 26.042010002204606,
      timeZone: 'Asia/Shanghai',
      name: '织界 · 福州',
    },
    source: { name: 'MET Norway', url: MODEL, licenseUrl: LICENSE, kind: 'forecast' },
    fetchedAt: now,
    modelUpdatedAt: now - 60_000,
    weatherStatus: 'fresh',
    sunStatus: 'fresh',
    current: {
      time: now - 60_000,
      temperature: 23.3,
      humidity: 72,
      cloudCover: 12,
      windSpeed: 1.8,
      windDirection: 95,
      precipitation: 0,
      symbol: condition,
      condition,
    },
    sun: { date, sunrise: event('06:10'), sunset: event('17:21') },
    ...overrides,
  };
}

async function launchWorld(
  browser,
  {
    timezoneId = 'America/New_York',
    viewport = { width: 1440, height: 980 },
    reducedMotion = 'no-preference',
    fallback = false,
    failInitially = false,
    time = '2026-10-31T12:00:00+08:00',
  } = {},
) {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    timezoneId,
    viewport,
    reducedMotion,
  });
  const page = await context.newPage();
  await page.clock.install({ time: new Date(time) });
  if (fallback) {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        if (type === 'webgl2' || type === 'webgl') return null;
        return original.call(this, type, ...args);
      };
    });
  }
  let condition = 'clear';
  let stale = false;
  let staleSunOnly = false;
  let yesterdaySun = false;
  let missingWeatherFields = false;
  let fail = failInitially;
  let requests = 0;
  await page.route('**/api/world-weather', async (route) => {
    requests++;
    if (fail) return route.fulfill({ status: 503, body: 'offline' });
    const now = await page.evaluate(() => Date.now());
    const payload = makePayload(
      now,
      condition,
      stale
        ? { weatherStatus: 'stale', sunStatus: 'stale' }
        : staleSunOnly
          ? { sunStatus: 'stale' }
          : {},
    );
    if (yesterdaySun) payload.sun = makePayload(now - 24 * 60 * 60_000).sun;
    if (missingWeatherFields) {
      payload.current = { ...payload.current, temperature: null, condition: 'unknown' };
      payload.sun = null;
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(payload),
    });
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/world.html');
  await expect(page.locator('#loading')).toHaveClass('hidden', { timeout: 45_000 });
  await expect(page.locator('#world-weather-hud')).toBeVisible();
  await page.evaluate(() => window.loomWorld.weather.refresh());
  return {
    context,
    page,
    errors,
    getRequests: () => requests,
    setCondition(value) {
      condition = value;
      stale = false;
      staleSunOnly = false;
      fail = false;
    },
    setStale() {
      condition = 'rain';
      stale = true;
      staleSunOnly = false;
      fail = false;
    },
    setStaleSunOnly() {
      stale = false;
      staleSunOnly = true;
      fail = false;
    },
    setYesterdaySun() {
      yesterdaySun = true;
    },
    setMissingWeatherFields() {
      missingWeatherFields = true;
      fail = false;
    },
    setFailure() {
      fail = true;
    },
  };
}

test('fixed Fuzhou weather card stays minimal while retaining Beijing clock and world controls', async ({
  browser,
}) => {
  const app = await launchWorld(browser);
  const { page } = app;
  await expect(page.locator('#world-local-time')).toContainText('12:00');
  await expect(page.locator('#world-local-date')).toHaveText('10月31日');
  await expect(page.locator('#world-weather-condition')).toHaveText('晴朗');
  await expect(page.locator('#world-weather-temperature')).toHaveText('23°');
  await expect(
    page.locator(
      '#world-weather-status, #world-weather-source, #world-weather-license, .weather-attribution',
    ),
  ).toHaveCount(0);
  await expect(page.locator('#world-weather-description')).toHaveCount(0);
  await expect(page.locator('#world-weather-metrics')).toHaveCount(0);
  const visibleCopy = await page.locator('#world-weather-hud').innerText();
  expect(visibleCopy).not.toMatch(
    /湿度|云量|UTC\+8|获取|天气加载中|暂不可用|未知|暂无|缓存待更新|日照待更新|预报时刻|预报\s/,
  );
  expect(visibleCopy).toContain('10月31日');
  const card = await page.evaluate(() => {
    const hud = document.querySelector('#world-weather-hud');
    const temperature = document.querySelector('#world-weather-temperature');
    const clock = document.querySelector('#world-local-time');
    return {
      width: hud.getBoundingClientRect().width,
      height: hud.getBoundingClientRect().height,
      temperature: Number.parseFloat(getComputedStyle(temperature).fontSize),
      clock: Number.parseFloat(getComputedStyle(clock).fontSize),
      readingRight: document.querySelector('.weather-reading').getBoundingClientRect().right,
      clockLeft: clock.getBoundingClientRect().left,
    };
  });
  expect(card.width).toBeLessThanOrEqual(242);
  expect(card.height).toBeLessThanOrEqual(210);
  expect(card.temperature).toBeGreaterThan(card.clock);
  expect(card.readingRight).toBeLessThan(card.clockLeft);
  await expect(page.locator('#world-weather-hud')).toHaveAttribute('data-weather-status', 'fresh');
  await expect(page.locator('#world-weather-hud')).toHaveAttribute('data-sun-status', 'fresh');
  await expect(page.locator('body')).toHaveAttribute('data-world-phase', 'day');
  expect(await page.evaluate(() => window.loomWorld.weather.getState().location.timeZone)).toBe(
    'Asia/Shanghai',
  );
  app.setStaleSunOnly();
  await page.evaluate(() => window.loomWorld.weather.refresh());
  await expect(page.locator('#world-weather-hud')).toHaveAttribute('data-sun-status', 'stale');
  await expect(page.locator('#world-sun-phase')).toHaveText('日间');
  expect(await page.evaluate(() => window.loomWorld.weather.getState().sun)).not.toBeNull();
  app.setCondition('clear');
  await page.evaluate(() => window.loomWorld.weather.refresh());
  const urls = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/world-weather')) urls.push(request.url());
  });

  await page.locator('[data-view="eye"]').click();
  await expect(page.locator('[data-view="eye"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#doors').check();
  await page.locator('#landscape').uncheck();
  expect(await page.evaluate(() => window.loomWorld.model.landscape.visible)).toBe(false);
  expect(app.errors).toEqual([]);
  expect(
    urls.every((url) => new URL(url).pathname === '/api/world-weather' && !new URL(url).search),
  ).toBe(true);
  await app.context.close();
});

test('homepage license link opens accessible MET Norway and Three.js credits', async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await context.newPage();
  await page.goto('/');
  const creditsLink = page.getByRole('link', { name: '许可说明 ↗' });
  await expect(creditsLink).toHaveAttribute('href', './credits.html');
  await creditsLink.click();
  await expect(page).toHaveURL(/\/credits\.html$/);
  await expect(page.getByRole('heading', { name: '许可说明' })).toBeVisible();
  await expect(page.getByText('Data from', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'MET Norway' })).toHaveAttribute('href', MODEL);
  await expect(
    page.getByRole('link', { name: /Creative Commons Attribution 4\.0/ }),
  ).toHaveAttribute('href', LICENSE);
  await expect(page.getByText(/模型预报，并非现场实测/)).toBeVisible();
  await expect(page.getByRole('link', { name: /随项目附带的许可文本/ })).toHaveAttribute(
    'href',
    './vendor/THREE-LICENSE.txt',
  );
  await context.close();
});

test('rain and snow change scene visuals, remain capped, and respect reduced motion', async ({
  browser,
}) => {
  const app = await launchWorld(browser);
  const { page } = app;
  app.setCondition('rain');
  await page.evaluate(() => window.loomWorld.weather.refresh());
  await expect(page.locator('#world-weather-condition')).toHaveText('降雨');
  const rain = await page.evaluate(() => {
    const object = window.loomWorld.scene.getObjectByName('World weather particles');
    return {
      count: object?.geometry.attributes.position.count || 0,
      far: window.loomWorld.scene.fog.far,
    };
  });
  expect(rain.count).toBeLessThanOrEqual(256);
  expect(rain.count).toBeGreaterThan(0);
  expect(rain.far).toBeLessThan(210);

  app.setCondition('snow');
  await page.evaluate(() => window.loomWorld.weather.refresh());
  await expect(page.locator('#world-weather-condition')).toHaveText('降雪');
  const snowCount = await page.evaluate(
    () =>
      window.loomWorld.scene.getObjectByName('World weather particles')?.geometry.attributes
        .position.count || 0,
  );
  expect(snowCount).toBeLessThanOrEqual(128);
  expect(snowCount).toBeGreaterThan(0);
  await app.context.close();

  const reduced = await launchWorld(browser, { reducedMotion: 'reduce' });
  reduced.setCondition('thunder');
  await reduced.page.evaluate(() => window.loomWorld.weather.refresh());
  await expect(reduced.page.locator('#world-weather-condition')).toHaveText('雷雨');
  expect(
    await reduced.page.evaluate(() =>
      Boolean(window.loomWorld.scene.getObjectByName('World weather particles')),
    ),
  ).toBe(false);
  await reduced.context.close();
});

test('dusk and night follow same-day sun events; mismatched dates never retain yesterday sun', async ({
  browser,
}) => {
  const app = await launchWorld(browser, { time: '2026-10-31T17:00:00+08:00' });
  const { page } = app;
  await page.evaluate(() => window.loomWorld.weather.refresh());
  await expect(page.locator('#world-sun-phase')).toHaveText('暮光');
  await expect(page.locator('body')).toHaveAttribute('data-world-phase', 'dusk');

  await page.clock.setFixedTime(new Date('2026-10-31T18:00:00+08:00'));
  await page.evaluate(() => window.loomWorld.weather.refresh());
  await expect(page.locator('body')).toHaveAttribute('data-world-phase', 'night');
  const night = await page.evaluate(() => ({
    hemi: window.loomWorld.scene.children.find((item) => item.type === 'HemisphereLight')
      ?.intensity,
    sun: window.loomWorld.scene.children.find((item) => item.type === 'DirectionalLight')
      ?.intensity,
  }));
  expect(night.hemi).toBeGreaterThan(0.5);
  expect(night.sun).toBeGreaterThan(0);

  app.setStale();
  await page.evaluate(() => window.loomWorld.weather.refresh());
  await expect(page.locator('#world-weather-hud')).toHaveAttribute('data-weather-status', 'stale');
  await expect(page.locator('#world-weather-hud')).toHaveAttribute('data-sun-status', 'stale');
  await expect(page.locator('#world-sun-phase')).toHaveText('日落后');
  expect(await page.evaluate(() => window.loomWorld.weather.getState().current)).not.toBeNull();
  expect(await page.evaluate(() => window.loomWorld.weather.getState().sun)).not.toBeNull();

  app.setYesterdaySun();
  await page.clock.setFixedTime(new Date('2026-11-01T00:01:00+08:00'));
  await expect.poll(() => page.locator('#world-sunrise').textContent()).toBe('日出 --:--');
  await expect(page.locator('#world-sunset')).toHaveText('日落 --:--');
  await expect(page.locator('#world-weather-hud')).toHaveAttribute('data-weather-status', 'stale');
  await expect(page.locator('#world-sun-phase')).toHaveText('');
  await app.context.close();
});

test('offline response leaves the Shanghai clock running and never fabricates sunny weather', async ({
  browser,
}) => {
  const app = await launchWorld(browser, { failInitially: true });
  const { page } = app;
  app.setFailure();
  await page.evaluate(() => window.loomWorld.weather.refresh());
  await expect(page.locator('#world-weather-status')).toHaveCount(0);
  await expect(page.locator('#world-weather-condition')).toHaveText('--');
  await expect(page.locator('#world-weather-temperature')).toHaveText('--°');
  await page.clock.setFixedTime(new Date('2026-10-31T12:01:00+08:00'));
  await expect(page.locator('#world-local-time')).toHaveText('12:01');
  await expect(page.locator('#world-sunrise')).toHaveText('日出 --:--');
  await expect(page.locator('#world-sun-phase')).toHaveText('');
  const offlineCopy = await page.locator('#world-weather-hud').innerText();
  expect(offlineCopy).not.toMatch(
    /天气加载中|暂不可用|未知|暂无|缓存待更新|日照待更新|预报时刻|预报\s/,
  );
  app.setMissingWeatherFields();
  await page.evaluate(() => window.loomWorld.weather.refresh());
  await expect(page.locator('#world-weather-condition')).toHaveText('--');
  await expect(page.locator('#world-weather-temperature')).toHaveText('--°');
  await expect(page.locator('#world-sunrise')).toHaveText('日出 --:--');
  await expect(page.locator('#world-sunset')).toHaveText('日落 --:--');
  await expect(page.locator('#world-sun-phase')).toHaveText('');
  expect(await page.evaluate(() => window.loomWorld.weather.getState().current.condition)).toBe(
    'unknown',
  );
  const unknownCopy = await page.locator('#world-weather-hud').innerText();
  expect(unknownCopy).not.toMatch(
    /天气加载中|暂不可用|未知|暂无|缓存待更新|日照待更新|预报时刻|预报\s/,
  );
  await expect(page.locator('#world-sun-marker')).toHaveCSS('opacity', '0');
  expect(app.errors).toEqual([]);
  await app.context.close();
});

test('failed refresh drops retained weather after its six-hour observation window', async ({
  browser,
}) => {
  const app = await launchWorld(browser);
  const { page } = app;
  app.setCondition('rain');
  await page.evaluate(() => window.loomWorld.weather.refresh());
  await expect(page.locator('#world-weather-condition')).toHaveText('降雨');
  expect(
    await page.evaluate(
      () =>
        window.loomWorld.scene.getObjectByName('World weather particles')?.geometry.attributes
          .position.count || 0,
    ),
  ).toBeGreaterThan(0);

  app.setFailure();
  await page.clock.setFixedTime(new Date('2026-10-31T18:00:01+08:00'));
  await page.evaluate(() => window.loomWorld.weather.refresh());

  await expect(page.locator('#world-weather-hud')).toHaveAttribute(
    'data-weather-status',
    'unavailable',
  );
  await expect(page.locator('#world-weather-condition')).toHaveText('--');
  expect(await page.evaluate(() => window.loomWorld.weather.getState().current)).toBeNull();
  expect(
    await page.evaluate(() =>
      Boolean(window.loomWorld.scene.getObjectByName('World weather particles')),
    ),
  ).toBe(false);
  await app.context.close();
});

test('resuming after an inactive Shanghai date rollover refreshes missing same-day sun despite a young cache', async ({
  browser,
}) => {
  const app = await launchWorld(browser, { time: '2026-10-31T23:59:00+08:00' });
  const { page } = app;
  const before = app.getRequests();

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.clock.setFixedTime(new Date('2026-11-01T00:01:00+08:00'));
  await page.waitForTimeout(1100);
  expect(await page.evaluate(() => window.loomWorld.weather.getState().sun)).toBeNull();
  expect(app.getRequests()).toBe(before);

  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => app.getRequests()).toBeGreaterThan(before);
  await expect
    .poll(() => page.evaluate(() => window.loomWorld.weather.getState().sun?.date))
    .toBe('2026-11-01');
  await app.context.close();
});

test('mobile HUD fits above camera controls and SVG fallback keeps a light weather cue', async ({
  browser,
}) => {
  const mobile = await launchWorld(browser, { viewport: { width: 390, height: 844 } });
  const { page } = mobile;
  const measureHud = () =>
    page.evaluate(() => {
      const hud = document.querySelector('#world-weather-hud').getBoundingClientRect();
      const back = document.querySelector('.standalone-back').getBoundingClientRect();
      const tools = document.querySelector('.world-tools').getBoundingClientRect();
      const content = document.querySelector('#world-weather-hud');
      return {
        hud: { left: hud.left, right: hud.right, bottom: hud.bottom, top: hud.top },
        back: { left: back.left, right: back.right, bottom: back.bottom, top: back.top },
        tools: { top: tools.top },
        width: innerWidth,
        contentFits: content.scrollWidth <= content.clientWidth,
      };
    });
  let bounds = await measureHud();
  expect(bounds.hud.left).toBeGreaterThanOrEqual(0);
  expect(bounds.hud.right).toBeLessThanOrEqual(bounds.width);
  expect(bounds.hud.bottom).toBeLessThan(bounds.tools.top);
  expect(bounds.contentFits).toBe(true);
  expect(Math.abs(bounds.hud.top - bounds.back.top)).toBeLessThanOrEqual(1);
  expect(overlap(bounds.hud, bounds.back)).toBe(false);

  await page.setViewportSize({ width: 320, height: 844 });
  bounds = await measureHud();
  expect(bounds.hud.left).toBeGreaterThanOrEqual(0);
  expect(bounds.hud.right).toBeLessThanOrEqual(bounds.width);
  expect(bounds.hud.bottom).toBeLessThan(bounds.tools.top);
  expect(bounds.contentFits).toBe(true);
  expect(Math.abs(bounds.hud.top - bounds.back.top)).toBeLessThanOrEqual(1);
  expect(overlap(bounds.hud, bounds.back)).toBe(false);

  await page.setViewportSize({ width: 844, height: 390 });
  bounds = await measureHud();
  expect(bounds.hud.left).toBeGreaterThanOrEqual(0);
  expect(bounds.hud.right).toBeLessThanOrEqual(bounds.width);
  expect(bounds.hud.bottom).toBeLessThan(bounds.tools.top);
  expect(bounds.contentFits).toBe(true);
  await mobile.context.close();

  const fallback = await launchWorld(browser, { fallback: true });
  fallback.setCondition('snow');
  await fallback.page.evaluate(() => window.loomWorld.weather.refresh());
  await expect(fallback.page.locator('#viewport svg')).toBeVisible();
  await expect(fallback.page.locator('body')).toHaveAttribute('data-renderer', 'compatibility');
  const result = await fallback.page.evaluate(() => ({
    count:
      window.loomWorld.scene.getObjectByName('World weather particles')?.geometry.attributes
        .position.count || 0,
    animation: getComputedStyle(document.querySelector('#world-atmosphere-haze'), '::before')
      .animationName,
    phase: document.body.dataset.worldPhase,
  }));
  expect(result.count).toBeLessThanOrEqual(128);
  expect(result.animation).toBe('fallback-snow');
  expect(result.phase).toBeTruthy();
  expect(fallback.errors).toEqual([]);
  await fallback.context.close();
});
