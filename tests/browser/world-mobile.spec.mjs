import { test, expect } from '@playwright/test';

const viewports = [
  { width: 320, height: 780 },
  { width: 390, height: 844 },
  { width: 440, height: 956 },
  { width: 768, height: 1024 },
  { width: 844, height: 390 },
  { width: 667, height: 375 },
  { width: 926, height: 428 },
];

const mobileHostViewports = viewports.filter(({ width }) => width <= 900);

function weatherPayload(now) {
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
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
      symbol: 'clear',
      condition: 'clear',
    },
    sun: {
      date,
      sunrise: new Date(`${date}T06:10:00+08:00`).getTime(),
      sunset: new Date(`${date}T17:21:00+08:00`).getTime(),
    },
  };
}

async function openTouchWorld(
  browser,
  viewport = { width: 390, height: 844 },
  embedded = false,
  fallback = false,
) {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport,
    hasTouch: true,
    ...(test.info().project.name === 'firefox' ? {} : { isMobile: true }),
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  if (fallback) {
    await page.addInitScript(() => {
      const original = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (type, ...args) {
        if (type === 'webgl2' || type === 'webgl') return null;
        return original.call(this, type, ...args);
      };
    });
  }
  await page.route('**/api/world-weather', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(weatherPayload(Date.now())),
    }),
  );
  await page.goto(embedded ? '/world.html?embedded=1' : '/world.html');
  await expect(page.locator('#loading')).toHaveClass('hidden', { timeout: 45_000 });
  await expect.poll(() => page.evaluate(() => window.loomWorld?.ready)).toBe(true);
  return { context, page, errors };
}

function overlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

async function rect(page, selector) {
  return page.locator(selector).evaluate((element) => {
    const { x, y, width, height, top, right, bottom, left } = element.getBoundingClientRect();
    return { x, y, width, height, top, right, bottom, left };
  });
}

async function waitForCameraToSettle(page) {
  let previous = null;
  let stableSamples = 0;
  await expect
    .poll(
      async () => {
        const current = await page.evaluate(() => [
          ...window.loomWorld.camera.position.toArray(),
          ...window.loomWorld.controls.target.toArray(),
        ]);
        if (previous && current.every((value, index) => value === previous[index]))
          stableSamples += 1;
        else stableSamples = 0;
        previous = current;
        return stableSamples;
      },
      { intervals: [50, 100, 150], timeout: 20_000 },
    )
    .toBeGreaterThanOrEqual(3);
}

test('touch layouts stay within the viewport, preserve the return corner and keep controls off the weather', async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const { context, page, errors } = await openTouchWorld(browser);
  try {
    await expect(page.locator('#world-tools-toggle')).toBeVisible();
    await expect(page.locator('#world-tools-toggle')).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#world-local-time')).toContainText(/\d{2}:\d{2}/);
    await expect(page.locator('#world-weather-temperature')).toContainText('23°');
    await expect(page.locator('#world-sunrise')).toContainText('日出');
    await expect(page.locator('#world-sunset')).toContainText('日落');
    await expect(
      page.locator('#world-weather-status, #world-weather-source, #world-weather-license'),
    ).toHaveCount(0);

    for (const viewport of viewports) {
      const { context: viewportContext, page: viewportPage } = await openTouchWorld(
        browser,
        viewport,
      );
      try {
        const layout = await viewportPage.evaluate(() => {
          const box = (selector) => {
            const { left, top, right, bottom, width, height } = document
              .querySelector(selector)
              .getBoundingClientRect();
            return { left, top, right, bottom, width, height };
          };
          return {
            width: innerWidth,
            height: innerHeight,
            scrollWidth: document.documentElement.scrollWidth,
            scrollHeight: document.documentElement.scrollHeight,
            tools: box('#world-tools'),
            weather: box('#world-weather-hud'),
            back: box('.standalone-back'),
            sunlightLabels: box('.sunlight-labels'),
            sunlightFontSize: parseFloat(
              getComputedStyle(document.querySelector('.sunlight-labels')).fontSize,
            ),
            sunlightFits: (() => {
              const labels = document.querySelector('.sunlight-labels');
              return labels.scrollWidth <= labels.clientWidth;
            })(),
          };
        });
        expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
        expect(layout.scrollHeight).toBeLessThanOrEqual(layout.height);
        expect(layout.tools.left).toBeGreaterThanOrEqual(0);
        expect(layout.tools.right).toBeLessThanOrEqual(layout.width);
        expect(layout.tools.bottom).toBeLessThanOrEqual(layout.height);
        expect(layout.weather.left).toBeGreaterThanOrEqual(0);
        expect(layout.weather.right).toBeLessThanOrEqual(layout.width);
        expect(layout.weather.bottom).toBeLessThanOrEqual(layout.height);
        expect(layout.sunlightLabels.left).toBeGreaterThanOrEqual(layout.weather.left);
        expect(layout.sunlightLabels.right).toBeLessThanOrEqual(layout.weather.right);
        expect(layout.sunlightFontSize).toBeGreaterThanOrEqual(11);
        expect(layout.sunlightFits).toBe(true);
        if (viewport.width <= 900) {
          expect(Math.abs(layout.weather.top - layout.back.top)).toBeLessThanOrEqual(1);
        }
        expect(overlap(layout.weather, layout.back)).toBe(false);
        expect(overlap(layout.tools, layout.weather)).toBe(false);
        expect(overlap(layout.tools, layout.back)).toBe(false);
        expect((await rect(viewportPage, '.standalone-back')).height).toBeGreaterThanOrEqual(44);
        await expect(viewportPage.locator('#world-tools-toggle')).toBeVisible();
      } finally {
        await viewportContext.close();
      }
    }

    await page.setViewportSize({ width: 320, height: 780 });
    await page.touchscreen.tap(
      (await rect(page, '#world-tools-toggle')).x + 40,
      (await rect(page, '#world-tools-toggle')).y + 22,
    );
    await expect(page.locator('#world-tools-toggle')).toHaveAttribute('aria-expanded', 'true');
    const view = await rect(page, '[data-view="aerial"]');
    await page.touchscreen.tap(view.x + view.width / 2, view.y + view.height / 2);
    await expect(page.locator('[data-view="aerial"]')).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ path: test.info().outputPath('world-mobile-320.png') });
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('embedded weather aligns with the host return button without overlap at mobile sizes', async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    ...(test.info().project.name === 'firefox' ? {} : { isMobile: true }),
  });
  const page = await context.newPage();
  await page.route('**/api/world-weather', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(weatherPayload(Date.now())),
    }),
  );

  try {
    await page.goto('/');
    const world = page.frameLocator('#world-frame');
    await expect(world.locator('#loading')).toHaveClass('hidden', { timeout: 45_000 });
    await page.locator('#world-enter').click();
    await expect(page.locator('#world-close')).toBeVisible();
    await expect(world.locator('#world-weather-hud')).toBeVisible();

    for (const viewport of mobileHostViewports) {
      await page.setViewportSize(viewport);
      const layout = await page.evaluate(() => {
        const frame = document.querySelector('#world-frame').getBoundingClientRect();
        const close = document.querySelector('#world-close').getBoundingClientRect();
        const hud = document
          .querySelector('#world-frame')
          .contentDocument.querySelector('#world-weather-hud');
        const weather = hud.getBoundingClientRect();
        return {
          width: innerWidth,
          height: innerHeight,
          scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight,
          back: {
            left: close.left,
            top: close.top,
            right: close.right,
            bottom: close.bottom,
          },
          weather: {
            left: frame.left + weather.left,
            top: frame.top + weather.top,
            right: frame.left + weather.right,
            bottom: frame.top + weather.bottom,
          },
          contentFits: hud.scrollWidth <= hud.clientWidth,
          sunlightFits: (() => {
            const labels = hud.querySelector('.sunlight-labels');
            return labels.scrollWidth <= labels.clientWidth;
          })(),
        };
      });
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.width);
      expect(layout.scrollHeight).toBeLessThanOrEqual(layout.height);
      expect(layout.weather.left).toBeGreaterThanOrEqual(0);
      expect(layout.weather.right).toBeLessThanOrEqual(layout.width);
      expect(layout.weather.bottom).toBeLessThanOrEqual(layout.height);
      expect(Math.abs(layout.weather.top - layout.back.top)).toBeLessThanOrEqual(1);
      expect(overlap(layout.weather, layout.back)).toBe(false);
      expect(layout.contentFits).toBe(true);
      expect(layout.sunlightFits).toBe(true);
    }
  } finally {
    await context.close();
  }
});

test('coarse pointer phone framing opens wider and orientation changes preserve user orbit', async ({
  browser,
}) => {
  const { context, page, errors } = await openTouchWorld(browser, { width: 390, height: 844 });
  try {
    const portraitDistance = await page.evaluate(() =>
      window.loomWorld.camera.position.distanceTo(window.loomWorld.controls.target),
    );
    expect(portraitDistance).toBeGreaterThan(95);
    await page.setViewportSize({ width: 926, height: 428 });
    await expect.poll(() => page.locator('#world-tools-toggle').isVisible()).toBe(true);
    await expect.poll(() => page.evaluate(() => window.loomWorld.camera.aspect)).toBe(926 / 428);
    const landscapeDistance = await page.evaluate(() =>
      window.loomWorld.camera.position.distanceTo(window.loomWorld.controls.target),
    );
    expect(landscapeDistance).toBeLessThan(portraitDistance);

    const canvas = page.locator('#viewport canvas');
    const canvasBox = await canvas.boundingBox();
    await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      canvasBox.x + canvasBox.width / 2 + 90,
      canvasBox.y + canvasBox.height / 2 + 35,
    );
    await page.mouse.up();
    await waitForCameraToSettle(page);
    const orbited = await page.evaluate(() => window.loomWorld.camera.position.toArray());
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => window.loomWorld.camera.aspect)).toBe(390 / 844);
    await waitForCameraToSettle(page);
    const afterResize = await page.evaluate(() => window.loomWorld.camera.position.toArray());
    expect(afterResize).toEqual(orbited);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('touch browsing keeps the single rooftop sculpture fixed without gameplay controls', async ({
  browser,
}) => {
  const { context, page, errors } = await openTouchWorld(browser);
  try {
    await expect(page.locator('#panda-controls, #panda-control-toggle, #panda-stick')).toHaveCount(
      0,
    );
    const before = await page.evaluate(() => {
      const panda = window.loomWorld.model.panda;
      return { position: panda.position.toArray(), rotation: panda.rotation.toArray() };
    });
    await page.locator('#world-tools-toggle').tap();
    await page.locator('[data-view="enclosure"]').tap();
    await expect(page.locator('[data-view="enclosure"]')).toHaveAttribute('aria-pressed', 'true');
    await waitForCameraToSettle(page);
    await page.setViewportSize({ width: 844, height: 390 });
    await expect.poll(() => page.evaluate(() => window.loomWorld.camera.aspect)).toBe(844 / 390);
    const after = await page.evaluate(() => {
      const panda = window.loomWorld.model.panda;
      return { position: panda.position.toArray(), rotation: panda.rotation.toArray() };
    });
    expect(after).toEqual(before);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('embedded touch world keeps its host return corner and hides standalone navigation and fallback gameplay', async ({
  browser,
}) => {
  const { context, page, errors } = await openTouchWorld(
    browser,
    { width: 390, height: 844 },
    true,
  );
  try {
    await expect(page.locator('.standalone-back')).toBeHidden();
    await expect(page.locator('#world-tools-toggle')).toBeHidden();
    await page.evaluate(() =>
      window.postMessage({ type: 'loom-world-mode', interactive: true }, location.origin),
    );
    await expect(page.locator('#world-tools-toggle')).toBeVisible();
    const tools = await rect(page, '#world-tools');
    const hostReturn = { left: 12, top: 12, right: 132, bottom: 56 };
    expect(overlap(tools, hostReturn)).toBe(false);
    await expect(page.locator('#panda-controls, #panda-control-toggle')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('touch fallback keeps only the rooftop sculpture and retains browse controls', async ({
  browser,
}) => {
  const { context, page, errors } = await openTouchWorld(
    browser,
    { width: 390, height: 844 },
    false,
    true,
  );
  try {
    await expect(page.locator('body')).toHaveAttribute('data-renderer', 'compatibility');
    await expect(page.locator('#panda-controls, #panda-control-toggle')).toHaveCount(0);
    const toolsToggle = await rect(page, '#world-tools-toggle');
    await page.touchscreen.tap(
      toolsToggle.x + toolsToggle.width / 2,
      toolsToggle.y + toolsToggle.height / 2,
    );
    await expect(page.locator('[data-view="aerial"]')).toBeVisible();
    await expect(page.locator('[data-view="aerial"]')).toBeEnabled();
    expect(await page.evaluate(() => window.loomWorld.model.panda.userData.rooftopPose)).toBe(
      'eave-climber',
    );
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
