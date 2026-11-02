import { test, expect } from '@playwright/test';

async function openTouchHome(browser, viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.route('**/api/world-weather', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
  await page.goto('/');
  return { context, page };
}

async function expectNoHorizontalOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scroll, `horizontal overflow at ${dimensions.client}px`).toBeLessThanOrEqual(
    dimensions.client + 1,
  );
}

async function expectTouchTarget(locator) {
  const box = await locator.boundingBox();
  expect(box, `missing visible touch target: ${locator}`).not.toBeNull();
  expect(box.width, `touch target too narrow: ${locator}`).toBeGreaterThanOrEqual(44);
  expect(box.height, `touch target too short: ${locator}`).toBeGreaterThanOrEqual(44);
}

test('touch layouts fit phone, tablet and landscape widths without horizontal scrolling', async ({
  browser,
}) => {
  const { context, page } = await openTouchHome(browser);
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    await expectNoHorizontalOverflow(page);
    await expect(page.locator('.hero-description')).toHaveCSS('font-size', '16px');
    await expect(page.locator('.menu-button')).toBeVisible();
  }
  await context.close();
});

test('homepage buttons, tabs, copy actions and footer links have thumb-sized hit areas', async ({
  browser,
}) => {
  const { context, page } = await openTouchHome(browser, { width: 320, height: 740 });
  await expectTouchTarget(page.locator('.menu-button'));
  await expectTouchTarget(page.locator('.hero-actions .primary'));

  await page.locator('#world-enter').scrollIntoViewIfNeeded();
  await expectTouchTarget(page.locator('#world-enter'));
  await page.locator('#tab-apis').scrollIntoViewIfNeeded();
  await expectTouchTarget(page.locator('#tab-apis'));

  await page.locator('.developer-details > summary').scrollIntoViewIfNeeded();
  await expectTouchTarget(page.locator('.developer-details > summary'));
  await page.locator('.developer-details > summary').tap();
  await expectTouchTarget(page.locator('#code-lua'));
  await expectTouchTarget(page.locator('#copy-example'));
  await expectTouchTarget(page.locator('#copy-clone'));

  await page.locator('.site-footer').scrollIntoViewIfNeeded();
  await expectTouchTarget(page.locator('.footer-top > div a').first());
  await expectTouchTarget(page.locator('.footer-bottom > a'));
  await context.close();
});

test('mobile menu supports touch, outside dismissal, Escape, links, focus and desktop breakpoint', async ({
  browser,
}) => {
  const { context, page } = await openTouchHome(browser);
  const menu = page.locator('.menu-button');
  const nav = page.locator('#mobile-nav');

  await menu.tap();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(nav).toBeVisible();
  await page.locator('#hero-title').tap();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');

  await menu.tap();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeFocused();

  await menu.tap();
  await nav.getByRole('link', { name: '能做什么' }).tap();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#possibilities')).toBeFocused();

  await menu.tap();
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(menu).toBeHidden();
  await expect(nav).toBeHidden();
  await expect(page.locator('.desktop-nav')).toBeVisible();
  await context.close();
});

test('tabs and copy actions work with actual touch taps', async ({ browser }) => {
  const { context, page } = await openTouchHome(browser);
  const permissions = ['clipboard-read', 'clipboard-write'];
  try {
    await context.grantPermissions(permissions);
  } catch {
    // Clipboard permissions differ between browser engines; the live toast and
    // successful copied text below remain the assertion when supported.
  }

  await page.locator('#tab-apis').tap();
  await expect(page.locator('#tab-apis')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#device-content')).toContainText('定时任务');

  await page.locator('.developer-details > summary').tap();
  await expect(page.locator('.developer-details')).toHaveAttribute('open', '');
  await page.locator('#copy-example').tap();
  await expect(page.locator('#toast')).toContainText(/复制好了|请选中文本后复制/);
  const copied = await page.evaluate(async () => navigator.clipboard.readText().catch(() => ''));
  if (copied) expect(copied).toContain('on_create');

  await page.locator('#copy-clone').tap();
  await expect(page.locator('#toast')).toContainText(/复制好了|请选中文本后复制/);
  await context.close();
});

test('immersive world can be entered and exited by touch and restores scroll and focus', async ({
  browser,
}) => {
  const { context, page } = await openTouchHome(browser);
  const stage = page.locator('#world-stage');
  const enter = page.locator('#world-enter');
  await enter.scrollIntoViewIfNeeded();
  const beforeScroll = await page.evaluate(() => window.scrollY);
  await enter.tap();

  await expect(stage).toHaveAttribute('role', 'dialog');
  await expect(page.locator('main > :not(.hero)').first()).toHaveJSProperty('inert', true);
  const close = page.locator('#world-close');
  await expect(close).toBeVisible();
  const closeBox = await close.boundingBox();
  expect(closeBox.width).toBeGreaterThanOrEqual(44);
  expect(closeBox.height).toBeGreaterThanOrEqual(44);
  await expect(close).toBeFocused();
  await close.tap();

  await expect(stage).not.toHaveAttribute('role', 'dialog');
  await expect(enter).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(beforeScroll);

  await enter.tap();
  await expect(stage).toHaveAttribute('role', 'dialog');
  await page.keyboard.press('Escape');

  await expect(stage).not.toHaveAttribute('role', 'dialog');
  await expect(enter).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(beforeScroll);
  await context.close();
});

test('desktop homepage keeps its navigation and avoids horizontal overflow', async ({
  browser,
}) => {
  const { context, page } = await openTouchHome(browser, { width: 1440, height: 980 });
  await expect(page.locator('.desktop-nav')).toBeVisible();
  await expect(page.locator('.menu-button')).toBeHidden();
  await expectNoHorizontalOverflow(page);
  await context.close();
});
