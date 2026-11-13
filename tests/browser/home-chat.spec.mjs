import { test, expect } from '@playwright/test';

async function openHome(page) {
  await page.route('**/api/world-weather', (route) => route.fulfill({ status: 503, body: '{}' }));
  await page.goto('/');
}

test('panda welcomes visitors and opens a translucent chat above and left, with focus restoration', async ({
  page,
}) => {
  await openHome(page);
  const toggle = page.getByRole('button', { name: '和小织聊聊', exact: true });
  await expect(toggle).toBeVisible();
  await expect(page.locator('.guide-welcome')).toContainText('点我聊聊');
  await page.getByRole('button', { name: '打开小织的对话' }).click();
  const panel = page.getByRole('dialog', { name: '和小织聊聊' });
  await expect(panel).toBeVisible();
  await expect(page.getByRole('textbox', { name: '想和小织聊什么？' })).toBeFocused();
  const [a, b] = await Promise.all([panel.boundingBox(), toggle.boundingBox()]);
  expect(a.x).toBeLessThan(b.x);
  expect(a.y + a.height).toBeLessThan(b.y + b.height / 2);
  const style = await panel.evaluate((node) => ({
    background: getComputedStyle(node).backgroundColor,
    blur: getComputedStyle(node).backdropFilter || getComputedStyle(node).webkitBackdropFilter,
  }));
  expect(style.background).toMatch(/rgba/);
  expect(style.blur).toContain('blur');
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(toggle).toBeFocused();
});

test('sending streams a real request contract, retains messages when closed, and never auto-sends', async ({
  page,
}) => {
  const calls = [];
  await page.route('**/guide', async (route) => {
    calls.push({ headers: route.request().headers(), body: route.request().postDataJSON() });
    await route.fulfill({
      contentType: 'text/event-stream',
      body: 'event: delta\ndata: {"text":"可以先逛逛织界农场。"}\n\nevent: done\ndata: {}\n\n',
    });
  });
  await openHome(page);
  await page.getByRole('button', { name: '和小织聊聊', exact: true }).click();
  expect(calls).toHaveLength(0);
  const input = page.getByRole('textbox', { name: '想和小织聊什么？' });
  await input.fill('农场里有什么？');
  await page.getByRole('button', { name: '发送消息', exact: true }).click();
  await expect(page.locator('.guide-message--assistant').last()).toContainText(
    '可以先逛逛织界农场。',
  );
  await expect(page.locator('#guide-status')).toHaveText('回复完成');
  expect(calls).toHaveLength(1);
  expect(calls[0].body).toEqual({ message: '农场里有什么？' });
  expect(calls[0].headers['makers-conversation-id']).toMatch(/^[a-zA-Z0-9_.-]{6,36}$/);
  expect(calls[0].headers['x-loom-request']).toBe('1');
  await page.getByRole('button', { name: '收起对话' }).click();
  await page.getByRole('button', { name: '和小织聊聊', exact: true }).click();
  await expect(page.locator('.guide-messages')).toContainText('农场里有什么？');
  expect(calls).toHaveLength(1);
});

test('friendly errors preserve the question for another explicit send', async ({ page }) => {
  let count = 0;
  await page.route('**/guide', async (route) => {
    count++;
    await route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: '{"error":{"code":"chat_unavailable"}}',
    });
  });
  await openHome(page);
  await page.getByRole('button', { name: '和小织聊聊', exact: true }).click();
  const input = page.getByRole('textbox', { name: '想和小织聊什么？' });
  await input.fill('怎么创建空间？');
  await input.press('Enter');
  await expect(page.locator('#guide-status')).toContainText('暂时没连上');
  await expect(input).toHaveValue('怎么创建空间？');
  expect(count).toBe(1);
  await expect(page.getByRole('button', { name: '发送消息', exact: true })).toBeEnabled();
});

test('stop cancels a pending answer without retrying or losing the question', async ({ page }) => {
  let count = 0;
  await page.route('**/guide', async (route) => {
    count++;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route
      .fulfill({ contentType: 'text/event-stream', body: 'event: done\ndata: {}\n\n' })
      .catch(() => {});
  });
  await openHome(page);
  await page.getByRole('button', { name: '和小织聊聊', exact: true }).click();
  const input = page.getByRole('textbox', { name: '想和小织聊什么？' });
  await input.fill('介绍一下织界');
  await input.press('Enter');
  await expect(page.getByRole('button', { name: '停止回复' })).toBeVisible();
  await page.getByRole('button', { name: '停止回复' }).click();
  await expect(page.locator('#guide-status')).toContainText('已停止');
  await expect(input).toHaveValue('介绍一下织界');
  expect(count).toBeLessThanOrEqual(1);
});

test('panda respects reduced motion and remains usable without WebGL, including narrow screens', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (this.matches('[data-panda-canvas]') && /webgl/i.test(type)) return null;
      return original.call(this, type, ...args);
    };
  });
  await openHome(page);
  const toggle = page.getByRole('button', { name: '和小织聊聊', exact: true });
  await expect(page.locator('.guide-fallback')).toBeVisible();
  await toggle.click();
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    await page.setViewportSize(viewport);
    const panel = await page.locator('#guide-panel').boundingBox();
    expect(panel.x).toBeGreaterThanOrEqual(0);
    expect(panel.y).toBeGreaterThanOrEqual(0);
    expect(panel.x + panel.width).toBeLessThanOrEqual(viewport.width);
    expect(panel.y + panel.height).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
});

test('immersive world hides the guide and restores it on exit', async ({ page }) => {
  await openHome(page);
  await page.locator('#world-enter').click();
  await expect(page.locator('.panda-guide')).toBeHidden();
  await page.locator('#world-close').click();
  await expect(page.locator('.panda-guide')).toBeVisible();
});

test('the 3D panda jumps, spins and waves, then settles for reduced motion and page restoration', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    window.pandaContextCount = 0;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      if (this.matches('[data-panda-canvas]') && /webgl/i.test(type)) window.pandaContextCount++;
      return original.call(this, type, ...args);
    };
  });
  await openHome(page);
  const canvas = page.locator('[data-panda-canvas]');
  await expect(page.locator('.panda-guide')).toHaveAttribute('data-renderer', 'webgl');
  await expect(canvas).toHaveAttribute('data-motion', 'jump');
  await expect(canvas).toHaveAttribute('data-motion', 'spin');
  await expect(canvas).toHaveAttribute('data-motion', 'wave');
  expect(await page.evaluate(() => window.pandaContextCount)).toBe(1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(canvas).toHaveAttribute('data-motion', 'still');
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
  });
  await expect(page.locator('.panda-guide')).toHaveAttribute('data-renderer', 'webgl');
  await expect(canvas).toHaveAttribute('data-motion', 'still');
  expect(await page.evaluate(() => window.pandaContextCount)).toBe(2);
  await page.getByRole('button', { name: '和小织聊聊', exact: true }).click();
  await expect(page.locator('#guide-input')).toBeFocused();
});

test('phone composer stays above the software keyboard', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openHome(page);
  await page.getByRole('button', { name: '和小织聊聊', exact: true }).click();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', { value: 400, configurable: true });
    window.visualViewport.dispatchEvent(new Event('resize'));
  });
  const input = await page.locator('#guide-input').boundingBox();
  expect(input.y).toBeGreaterThanOrEqual(0);
  expect(input.y + input.height).toBeLessThan(400);
  await expect(page.locator('#guide-send')).toBeVisible();
});
