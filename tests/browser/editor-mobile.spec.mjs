import { test, expect } from '@playwright/test';

async function openEditor(browser, viewport = { width: 390, height: 844 }) {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: '{}' }),
  );
  await page.goto('/create.html');
  await expect(page.locator('#renderer-loading')).toBeHidden({ timeout: 45_000 });
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

test('mobile editor fits phone, tablet and touch-landscape viewports', async ({ browser }) => {
  const { context, page } = await openEditor(browser);
  for (const viewport of [
    { width: 320, height: 740 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 844, height: 390 },
    { width: 667, height: 375 },
    { width: 926, height: 428 },
  ]) {
    await page.setViewportSize(viewport);
    await expectNoHorizontalOverflow(page);
    await expect(page.locator('.mobile-switch')).toBeVisible();
    await expect(page.locator('#properties-panel')).toBeHidden();
    await expect(page.locator('#assistant-panel')).toBeHidden();
    await expect(page.locator('#scene-title')).toHaveCSS('font-size', '16px');
    await expect(page.locator('#agent-prompt')).toHaveCSS('font-size', '16px');
    await expect(page.locator('#save-status')).toHaveCSS('font-size', '10px');
    if (viewport.width === 320) {
      await expect(page.locator('.save-label-short')).toBeVisible();
      await expect(page.locator('.save-label-full')).toBeHidden();
      await expect(page.locator('.library-label-short')).toBeVisible();
      await expect(page.locator('.library-label-full')).toBeHidden();
    }
  }
  await context.close();
});

test('mobile panels switch, focus, dismiss, and expose thumb-sized controls', async ({
  browser,
}) => {
  const { context, page } = await openEditor(browser, { width: 320, height: 740 });
  await expectTouchTarget(page.locator('#open-library'));
  await expectTouchTarget(page.locator('#save-scene'));
  await expectTouchTarget(page.locator('.mobile-switch [data-panel="properties"]'));
  await expectTouchTarget(page.locator('.mobile-switch [data-panel="canvas"]'));
  await expectTouchTarget(page.locator('.mobile-switch [data-panel="assistant"]'));
  await expectTouchTarget(page.locator('#orbit-mode'));

  await page.locator('.mobile-switch [data-panel="properties"]').tap();
  await expect(page.locator('#properties-panel')).toBeVisible();
  await expect(page.locator('#properties-panel h1')).toBeFocused();
  for (const selector of ['#sky-preset', '#time-of-day', '#sun-intensity', '#frame-material']) {
    const box = await page.locator(selector).boundingBox();
    expect(box.height, `short touch field: ${selector}`).toBeGreaterThanOrEqual(44);
  }
  await page.locator('#close-properties').tap();
  await expect(page.locator('#properties-panel')).toBeHidden();
  await expect(page.locator('.mobile-switch [data-panel="canvas"]')).toBeFocused();

  await page.locator('.mobile-switch [data-panel="assistant"]').tap();
  await expect(page.locator('#assistant-panel')).toBeVisible();
  await expect(page.locator('#assistant-panel h2')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#assistant-panel')).toBeHidden();
  await expect(page.locator('.mobile-switch [data-panel="canvas"]')).toBeFocused();
  await context.close();
});

test('visual viewport sizing listeners survive a BFCache pagehide/pageshow cycle', async ({
  browser,
}) => {
  const { context, page } = await openEditor(browser, { width: 390, height: 844 });
  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    document.documentElement.style.setProperty('--editor-viewport-height', '1px');
    window.dispatchEvent(new Event('resize'));
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--editor-viewport-height')
          .trim(),
      ),
    )
    .not.toBe('1px');

  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    document.documentElement.style.setProperty('--editor-viewport-height', '1px');
    window.dispatchEvent(new Event('resize'));
  });
  await expect
    .poll(() =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--editor-viewport-height')
          .trim(),
      ),
    )
    .not.toBe('1px');
  await context.close();
});

test('synthetic pointer cancellation rolls back object and camera gestures', async ({
  browser,
}) => {
  const { context, page } = await openEditor(browser, { width: 390, height: 844 });
  const result = await page.evaluate(async () => {
    const THREE = await import('three');
    const { createSpaceRenderer } = await import('/js/editor/renderer.js');
    const { applyOperations, createDefaultScene } = await import('/js/editor/document.js');
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;width:640px;height:480px';
    document.body.append(host);
    const transforms = [];
    const cameras = [];
    const selections = [];
    const renderer = await createSpaceRenderer({
      container: host,
      onSelect: (value) => selections.push(value),
      onTransform: (value) => transforms.push(value),
      onCameraChange: (value) => cameras.push(value),
    });
    const canvas = host.querySelector('canvas, svg');
    const captureIds = new Set();
    canvas.setPointerCapture = (pointerId) => captureIds.add(pointerId);
    canvas.hasPointerCapture = (pointerId) => captureIds.has(pointerId);
    canvas.releasePointerCapture = (pointerId) => captureIds.delete(pointerId);
    canvas.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 640,
      bottom: 480,
      width: 640,
      height: 480,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const scene = applyOperations(createDefaultScene({ seed: 7204 }), [
      {
        op: 'add_object',
        id: 'touch-bench',
        assetId: 'garden.bench.wood',
        name: '触控回归长椅',
        materialId: 'wood.warm-oak',
        transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      },
    ]);
    renderer.setScene(scene);
    const cameraState = renderer.getCamera();
    const project = (position) => {
      const camera = new THREE.PerspectiveCamera(cameraState.fovDegrees, 640 / 480, 0.25, 400);
      camera.position.fromArray(cameraState.position);
      camera.lookAt(...cameraState.target);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();
      const point = new THREE.Vector3(...position).project(camera);
      return {
        clientX: ((point.x + 1) / 2) * 640,
        clientY: ((1 - point.y) / 2) * 480,
      };
    };
    const benchPoint = project([0, 0.58, 0]);
    const movePoint = project([2, 0, 0]);
    const moveOrigin = scene.objects[0].transform.position;
    const point = (type, pointerId, clientX, clientY) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          pointerId,
          pointerType: 'touch',
          isPrimary: pointerId % 2 === 1,
          button: 0,
          buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
          clientX,
          clientY,
          pageX: clientX,
          pageY: clientY,
        }),
      );

    renderer.setTransformMode('move');
    point('pointerdown', 51, benchPoint.clientX, benchPoint.clientY);
    point('pointermove', 51, movePoint.clientX, movePoint.clientY);
    point('pointerup', 51, movePoint.clientX, movePoint.clientY);
    const afterCommit = transforms.at(-1)?.transform.position;
    const commitsAfterSingleMove = transforms.length;
    renderer.setScene(scene);

    const selectionCountBeforeMultiPointer = selections.length;
    point('pointerdown', 52, benchPoint.clientX, benchPoint.clientY);
    point('pointermove', 52, movePoint.clientX, movePoint.clientY);
    point('pointerdown', 53, benchPoint.clientX + 20, benchPoint.clientY);
    point('pointermove', 52, movePoint.clientX + 30, movePoint.clientY);
    point('pointerup', 52, movePoint.clientX, movePoint.clientY);
    point('pointerup', 53, benchPoint.clientX + 20, benchPoint.clientY);
    const commitsAfterSecondPointer = transforms.length;
    const selectionEventsForMultiPointer = selections.length - selectionCountBeforeMultiPointer;

    point('pointerdown', 54, benchPoint.clientX, benchPoint.clientY);
    point('pointermove', 54, movePoint.clientX, movePoint.clientY);
    point('pointercancel', 54, movePoint.clientX, movePoint.clientY);
    const commitsAfterCancel = transforms.length;

    point('pointerdown', 55, benchPoint.clientX, benchPoint.clientY);
    point('pointermove', 55, movePoint.clientX, movePoint.clientY);
    canvas.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 55 }));
    const commitsAfterLostCapture = transforms.length;

    point('pointerdown', 56, benchPoint.clientX, benchPoint.clientY);
    point('pointermove', 56, movePoint.clientX, movePoint.clientY);
    window.dispatchEvent(new Event('blur'));
    const commitsAfterBlur = transforms.length;
    const restoredScenePosition = scene.objects[0].transform.position;

    point('pointerdown', 57, benchPoint.clientX, benchPoint.clientY);
    point('pointermove', 57, movePoint.clientX, movePoint.clientY);
    point('pointerup', 57, movePoint.clientX, movePoint.clientY);
    const afterRecoveryDrag = transforms.at(-1)?.transform.position;
    const commitsAfterRecoveryDrag = transforms.length;

    renderer.setScene(scene);
    renderer.setTransformMode('orbit');
    const initialCamera = renderer.getCamera();
    const orbitPoint = { x: 320, y: 240 };
    point('pointerdown', 61, orbitPoint.x, orbitPoint.y);
    point('pointermove', 61, orbitPoint.x + 90, orbitPoint.y + 30);
    const changedCamera = renderer.getCamera();
    point('pointercancel', 61, orbitPoint.x + 90, orbitPoint.y + 30);
    point('pointerup', 61, orbitPoint.x + 90, orbitPoint.y + 30);
    const afterOrbitCancel = renderer.getCamera();
    const cameraCommitsAfterCancel = cameras.length;

    point('pointerdown', 62, benchPoint.clientX, benchPoint.clientY);
    point('pointerdown', 63, benchPoint.clientX + 20, benchPoint.clientY);
    point('pointerup', 62, benchPoint.clientX, benchPoint.clientY);
    point('pointerup', 63, benchPoint.clientX + 20, benchPoint.clientY);
    const selectionsAfterMultiPointer = selections.length;

    point('pointerdown', 64, orbitPoint.x, orbitPoint.y);
    point('pointermove', 64, orbitPoint.x + 75, orbitPoint.y + 25);
    canvas.dispatchEvent(new PointerEvent('lostpointercapture', { bubbles: true, pointerId: 64 }));
    const afterOrbitLostCapture = renderer.getCamera();
    const cameraCommitsAfterLostCapture = cameras.length;

    point('pointerdown', 65, orbitPoint.x, orbitPoint.y);
    point('pointermove', 65, orbitPoint.x + 60, orbitPoint.y + 20);
    point('pointerup', 65, orbitPoint.x + 60, orbitPoint.y + 20);
    const cameraCommitsAfterRecovery = cameras.length;
    const afterRecoveredOrbit = renderer.getCamera();
    const captureLossRollback =
      afterOrbitLostCapture.position.every(
        (value, index) => Math.abs(value - afterOrbitCancel.position[index]) < 1e-4,
      ) &&
      afterOrbitLostCapture.target.every(
        (value, index) => Math.abs(value - afterOrbitCancel.target[index]) < 1e-4,
      );

    renderer.setScene(scene);
    point('pointerdown', 66, benchPoint.clientX, benchPoint.clientY);
    point('pointerup', 66, benchPoint.clientX, benchPoint.clientY);
    const result = {
      moveOrigin,
      afterCommit,
      commitsAfterSingleMove,
      commitsAfterSecondPointer,
      commitsAfterCancel,
      commitsAfterLostCapture,
      commitsAfterBlur,
      restoredScenePosition,
      afterRecoveryDrag,
      commitsAfterRecoveryDrag,
      initialCamera,
      changedCamera,
      afterOrbitCancel,
      cameraCommitsAfterCancel,
      selectionEventsForMultiPointer,
      captureLossRollback,
      cameraCommitsAfterLostCapture,
      cameraCommitsAfterRecovery,
      afterRecoveredOrbit,
      recoveredSelection: selections.at(-1),
      cameraCommits: cameras.length,
      transforms: transforms.length,
    };
    renderer.dispose();
    host.remove();
    return result;
  });

  expect(
    result.afterCommit?.some((value, index) => Math.abs(value - result.moveOrigin[index]) > 0.5),
  ).toBe(true);
  expect(result.commitsAfterSingleMove).toBe(1);
  expect(result.commitsAfterSecondPointer).toBe(1);
  expect(result.commitsAfterCancel).toBe(1);
  expect(result.commitsAfterLostCapture).toBe(1);
  expect(result.commitsAfterBlur).toBe(1);
  expect(result.restoredScenePosition).toEqual(result.moveOrigin);
  expect(result.commitsAfterRecoveryDrag).toBe(2);
  expect(result.afterRecoveryDrag).toEqual(result.afterCommit);
  expect(
    result.changedCamera.position.some(
      (value, index) => Math.abs(value - result.initialCamera.position[index]) > 1e-4,
    ),
  ).toBe(true);
  expect(
    result.afterOrbitCancel.position.every(
      (value, index) => Math.abs(value - result.initialCamera.position[index]) < 1e-4,
    ),
  ).toBe(true);
  expect(
    result.afterOrbitCancel.target.every(
      (value, index) => Math.abs(value - result.initialCamera.target[index]) < 1e-4,
    ),
  ).toBe(true);
  expect(result.cameraCommitsAfterCancel).toBe(0);
  expect(result.selectionEventsForMultiPointer).toBe(1);
  expect(result.captureLossRollback).toBe(true);
  expect(result.cameraCommitsAfterLostCapture).toBe(0);
  expect(result.cameraCommitsAfterRecovery).toBe(1);
  expect(
    result.afterRecoveredOrbit.position.some(
      (value, index) => Math.abs(value - result.afterOrbitCancel.position[index]) > 1e-4,
    ),
  ).toBe(true);
  expect(result.recoveredSelection).toBe('touch-bench');
  expect(result.cameraCommits).toBe(1);
  expect(result.transforms).toBe(2);
  await context.close();
});
