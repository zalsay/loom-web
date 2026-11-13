import { test, expect } from '@playwright/test';

async function openCarousel(page) {
  const loads = { world: 0, farm: 0 };
  await page.clock.install();
  await page.route(/\/(world|farm)\.html\?embedded=1$/, async (route) => {
    const name = new URL(route.request().url()).pathname.includes('farm') ? 'farm' : 'world';
    loads[name]++;
    await route.fulfill({
      contentType: 'text/html',
      body: `<script>
        window.messages = [];
        addEventListener('message', event => window.messages.push(event.data));
        window.ready = () => parent.postMessage({type:'loom-world-ready'}, location.origin);
      </script>`,
    });
  });
  await page.goto('/');
  return loads;
}

async function ready(page, name) {
  await expect
    .poll(() => page.frames().some((frame) => frame.url().includes(`/${name}.html`)))
    .toBe(true);
  const frame = page.frames().find((frame) => frame.url().includes(`/${name}.html`));
  await frame.evaluate(() => window.ready());
  await expect(page.locator(`iframe[data-scene="${name}"]`)).toHaveAttribute('data-ready', 'true');
  return frame;
}

test('slow scenes finish loading before rotation and each scene loads only once', async ({
  page,
}) => {
  const loads = await openCarousel(page);
  await page.clock.fastForward(20000);
  await expect(page.locator('[data-hero-slide="0"]')).toHaveAttribute('aria-selected', 'true');
  await ready(page, 'world');
  await expect.poll(() => loads.farm).toBe(1);
  await page.clock.fastForward(20000);
  await expect(page.locator('[data-hero-slide="0"]')).toHaveAttribute('aria-selected', 'true');
  const farm = await ready(page, 'farm');
  await page.clock.fastForward(6500);
  await page.clock.fastForward(200);
  await expect(page.locator('[data-hero-slide="1"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('iframe[data-scene="farm"]')).toHaveAttribute('aria-hidden', 'false');
  await page.clock.fastForward(6500);
  await page.clock.fastForward(200);
  await expect(page.locator('[data-hero-slide="0"]')).toHaveAttribute('aria-selected', 'true');
  await expect
    .poll(() =>
      farm.evaluate(
        () => window.messages.filter((m) => m.type === 'loom-world-visibility').at(-1)?.visible,
      ),
    )
    .toBe(false);
  expect(loads).toEqual({ world: 1, farm: 1 });
});

test('entering a scene pauses rotation until the visitor returns', async ({ page }) => {
  await openCarousel(page);
  await ready(page, 'world');
  await ready(page, 'farm');
  await page.locator('#world-enter').click();
  await page.clock.fastForward(20000);
  await expect(page.locator('body')).toHaveClass(/world-open/);
  await expect(page.locator('[data-hero-slide="0"]')).toHaveAttribute('aria-selected', 'true');
  await page.locator('#world-close').click();
  await page.mouse.move(0, 0);
  await page.locator('#world-enter').blur();
  await page.clock.fastForward(6500);
  await page.clock.fastForward(200);
  await expect(page.locator('[data-hero-slide="1"]')).toHaveAttribute('aria-selected', 'true');
});

test('a failed preload keeps the current scene and offers the matching page on manual selection', async ({
  page,
}) => {
  await openCarousel(page);
  await ready(page, 'world');
  await expect
    .poll(() => page.frames().some((frame) => frame.url().includes('/farm.html')))
    .toBe(true);
  const farm = page.frames().find((frame) => frame.url().includes('/farm.html'));
  await farm.evaluate(() => parent.postMessage({ type: 'loom-world-error' }, location.origin));
  await expect(page.locator('#farm-frame')).toHaveAttribute('data-ready', 'error');
  await page.clock.fastForward(20000);
  await expect(page.locator('[data-hero-slide="0"]')).toHaveAttribute('aria-selected', 'true');
  await page.locator('[data-hero-slide="1"]').click();
  await expect(page.locator('#world-loading a')).toHaveAttribute('href', '/farm.html');
});

test('real 3D scenes become ready once and farm rendering pauses while inactive', async ({
  page,
}, testInfo) => {
  await page.route('**/api/world-weather', (route) => route.fulfill({ status: 503, body: '{}' }));
  const loads = [];
  page.on('request', (request) => {
    if (/\/(world|farm)\.html\?embedded=1$/.test(request.url())) loads.push(request.url());
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#world-frame')).toHaveAttribute('data-ready', 'true', {
    timeout: 45000,
  });
  await expect(page.locator('#farm-frame')).toHaveAttribute('data-ready', 'true', {
    timeout: 45000,
  });
  await page.locator('[data-hero-slide="1"]').click();
  await expect(page.locator('#farm-frame')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#hero-carousel-content')).toHaveAttribute('data-active', '1');
  await page.screenshot({ path: testInfo.outputPath('farm-carousel.png') });
  const farm = page.frames().find((frame) => frame.url().includes('/farm.html'));
  await farm.evaluate(() =>
    window.addEventListener('message', (event) => {
      if (event.data?.type === 'loom-world-visibility') window.sceneVisible = event.data.visible;
    }),
  );
  await farm.evaluate(() => {
    window.farmDraws = 0;
    const gl = document.querySelector('canvas').getContext('webgl2');
    for (const name of [
      'drawElements',
      'drawArrays',
      'drawElementsInstanced',
      'drawArraysInstanced',
    ]) {
      const draw = gl[name].bind(gl);
      gl[name] = (...args) => {
        window.farmDraws++;
        return draw(...args);
      };
    }
  });
  await expect.poll(() => farm.evaluate(() => window.farmDraws)).toBeGreaterThan(0);
  await page.locator('[data-hero-slide="0"]').click();
  await expect.poll(() => farm.evaluate(() => window.sceneVisible)).toBe(false);
  const frozen = await farm.evaluate(() => window.farmDraws);
  await page.waitForTimeout(200);
  expect(await farm.evaluate(() => window.farmDraws)).toBe(frozen);
  await page.locator('[data-hero-slide="1"]').click();
  await expect.poll(() => farm.evaluate(() => window.sceneVisible)).toBe(true);
  await expect.poll(() => farm.evaluate(() => window.farmDraws)).toBeGreaterThan(frozen);
  expect(loads.filter((url) => url.includes('/world.html'))).toHaveLength(1);
  expect(loads.filter((url) => url.includes('/farm.html'))).toHaveLength(1);
  expect(errors).toEqual([]);
});
