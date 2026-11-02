/**
 * Adapts the panda control panel and keyboard into unit movement/action events.
 * Lifecycle and panda/camera state remain owned by the caller.
 */
export function createPandaInput({
  onEnter = () => {},
  onExit = () => {},
  onMove = () => {},
  onRun = () => {},
  onJump = () => {},
  onReset = () => {},
  root = document,
} = {}) {
  const doc = root.ownerDocument ?? root;
  const win = doc.defaultView ?? window;
  const launch = root.querySelector('#panda-control-toggle');
  const panel = root.querySelector('#panda-controls');
  const stick = root.querySelector('#panda-stick');
  const thumb = root.querySelector('#panda-stick-thumb');
  const jumpButton = root.querySelector('#panda-jump');
  const runButton = root.querySelector('#panda-run');
  const resetButton = root.querySelector('#panda-reset');
  const exitButton = root.querySelector('#panda-exit');

  let active = false;
  let disposed = false;
  let stickPointerId = null;
  let stickVector = { x: 0, forward: 0 };
  let stickOffset = { x: 0, y: 0 };
  let lastMove = { x: 0, forward: 0 };
  const heldKeys = new Set();
  const runPointers = new Set();
  const runActivationKeys = new Set();
  const jumpActivationKeys = new Set();
  const listeners = [];

  function listen(target, type, handler, options) {
    if (!target) return;
    target.addEventListener(type, handler, options);
    listeners.push(() => target.removeEventListener(type, handler, options));
  }

  function isEditableTarget(target) {
    return Boolean(
      target?.isContentEditable ||
        target?.closest?.(
          'input, select, textarea, [contenteditable=""], [contenteditable="true"]',
        ),
    );
  }

  function runIsHeld() {
    return (
      runPointers.size > 0 ||
      runActivationKeys.size > 0 ||
      heldKeys.has('ShiftLeft') ||
      heldKeys.has('ShiftRight') ||
      heldKeys.has('Shift')
    );
  }

  function syncRun() {
    if (!runButton) return;
    const pressed = active && runIsHeld();
    runButton.classList.toggle('is-pressed', pressed);
    runButton.setAttribute('aria-pressed', String(pressed));
    onRun(pressed);
  }

  function emitMove() {
    if (!active) return;
    let x = stickVector.x;
    let forward = stickVector.forward;
    if (heldKeys.has('KeyA') || heldKeys.has('ArrowLeft')) x -= 1;
    if (heldKeys.has('KeyD') || heldKeys.has('ArrowRight')) x += 1;
    if (heldKeys.has('KeyW') || heldKeys.has('ArrowUp')) forward += 1;
    if (heldKeys.has('KeyS') || heldKeys.has('ArrowDown')) forward -= 1;

    const magnitude = Math.hypot(x, forward);
    if (magnitude > 1) {
      x /= magnitude;
      forward /= magnitude;
    }
    if (x === lastMove.x && forward === lastMove.forward) return;
    lastMove = { x, forward };
    onMove(x, forward);
  }

  function updateThumb() {
    if (!thumb) return;
    thumb.style.transform = `translate(${stickOffset.x}px, ${stickOffset.y}px)`;
  }

  function clearStick(emit = true) {
    const hadVector = stickVector.x !== 0 || stickVector.forward !== 0;
    stickPointerId = null;
    stickVector = { x: 0, forward: 0 };
    stickOffset = { x: 0, y: 0 };
    stick?.classList.remove('is-dragging');
    updateThumb();
    if (emit && hadVector) emitMove();
  }

  function updateStickFromPointer(event) {
    const bounds = stick.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const travel = Math.max(1, Math.min(bounds.width, bounds.height) * 0.25);
    let dx = event.clientX - centerX;
    let dy = event.clientY - centerY;
    const distance = Math.hypot(dx, dy);
    if (distance > travel) {
      dx = (dx / distance) * travel;
      dy = (dy / distance) * travel;
    }
    stickOffset = { x: dx, y: dy };
    stickVector = { x: dx / travel, forward: -dy / travel };
    updateThumb();
    emitMove();
  }

  function releaseRunPointer(pointerId) {
    if (!runPointers.delete(pointerId)) return;
    syncRun();
  }

  function releaseAllPointers() {
    if (stickPointerId !== null && stick?.hasPointerCapture?.(stickPointerId)) {
      try {
        stick.releasePointerCapture(stickPointerId);
      } catch {
        // A lost pointer capture is already equivalent to release.
      }
    }
    clearStick(false);
    for (const pointerId of [...runPointers]) {
      if (runButton?.hasPointerCapture?.(pointerId)) {
        try {
          runButton.releasePointerCapture(pointerId);
        } catch {
          // Pointer capture may already have been canceled by the browser.
        }
      }
      runPointers.delete(pointerId);
    }
  }

  function release() {
    if (disposed) return;
    const wasRunning = active && runIsHeld();
    releaseAllPointers();
    heldKeys.clear();
    runActivationKeys.clear();
    jumpActivationKeys.clear();
    if (lastMove.x !== 0 || lastMove.forward !== 0) {
      lastMove = { x: 0, forward: 0 };
      onMove(0, 0);
    }
    if (wasRunning || runButton?.getAttribute('aria-pressed') === 'true') syncRun();
    else if (runButton) {
      runButton.classList.remove('is-pressed');
      runButton.setAttribute('aria-pressed', 'false');
    }
  }

  function setActive(nextActive) {
    if (disposed) return;
    const next = Boolean(nextActive);
    if (active === next) return;
    const wasActive = active;
    active = next;
    doc.body?.classList.toggle('panda-playing', active);
    if (panel) panel.hidden = !active;
    launch?.setAttribute('aria-expanded', String(active));
    if (!active) release();
    if (active) stick?.focus();
    else if (wasActive) launch?.focus();
  }

  function onKeyDown(event) {
    if (
      !active ||
      doc.hidden ||
      event.ctrlKey ||
      event.metaKey ||
      event.altKey ||
      isEditableTarget(event.target)
    )
      return;

    const code = event.code || event.key;
    if (event.target === runButton && (code === 'Space' || code === 'Enter')) {
      event.preventDefault();
      if (!event.repeat && !runActivationKeys.has(code)) {
        runActivationKeys.add(code);
        syncRun();
      }
      return;
    }

    if (event.target === jumpButton && (code === 'Space' || code === 'Enter')) {
      event.preventDefault();
      if (!event.repeat && !jumpActivationKeys.has(code)) {
        jumpActivationKeys.add(code);
        onJump();
      }
      return;
    }
    if (code === 'ShiftLeft' || code === 'ShiftRight' || event.key === 'Shift') {
      if (!event.repeat) {
        heldKeys.add(code === 'Shift' ? 'Shift' : code);
        syncRun();
      }
      return;
    }

    const movement =
      code === 'KeyW' ||
      code === 'KeyA' ||
      code === 'KeyS' ||
      code === 'KeyD' ||
      code === 'ArrowUp' ||
      code === 'ArrowDown' ||
      code === 'ArrowLeft' ||
      code === 'ArrowRight';
    if (movement) {
      event.preventDefault();
      if (!heldKeys.has(code) && !event.repeat) {
        heldKeys.add(code);
        emitMove();
      }
      return;
    }
    if (code === 'Space' || event.key === ' ') {
      if (event.target?.closest?.('button, a')) return;
      event.preventDefault();
      if (!event.repeat) onJump();
    }
  }

  function onKeyUp(event) {
    if (!active) return;
    const code = event.code || event.key;
    let changedMove = false;
    if (heldKeys.delete(code)) changedMove = true;
    if (event.key === 'Shift') heldKeys.delete('Shift');
    if (changedMove) emitMove();
    if (code === 'ShiftLeft' || code === 'ShiftRight' || code === 'Shift') syncRun();
    if (runActivationKeys.delete(code)) syncRun();
    jumpActivationKeys.delete(code);
  }

  listen(launch, 'click', () => {
    if (!active && !doc.hidden) onEnter();
  });
  listen(exitButton, 'click', () => {
    if (active && !doc.hidden) onExit();
  });
  listen(resetButton, 'click', () => {
    if (active && !doc.hidden) onReset();
  });
  listen(jumpButton, 'click', () => {
    if (active && !doc.hidden) onJump();
  });

  listen(stick, 'pointerdown', (event) => {
    if (
      !active ||
      doc.hidden ||
      stickPointerId !== null ||
      (event.pointerType === 'mouse' && event.button !== 0)
    )
      return;
    event.preventDefault();
    stickPointerId = event.pointerId;
    stick.classList.add('is-dragging');
    try {
      stick.setPointerCapture(event.pointerId);
    } catch {
      // The pointer may have ended before capture was granted.
    }
    updateStickFromPointer(event);
  });
  listen(stick, 'pointermove', (event) => {
    if (!active || doc.hidden || event.pointerId !== stickPointerId) return;
    event.preventDefault();
    updateStickFromPointer(event);
  });
  const finishStick = (event) => {
    if (event.pointerId !== stickPointerId) return;
    clearStick();
  };
  listen(stick, 'pointerup', finishStick);
  listen(stick, 'pointercancel', finishStick);
  listen(stick, 'lostpointercapture', finishStick);

  listen(runButton, 'pointerdown', (event) => {
    if (!active || doc.hidden || (event.pointerType === 'mouse' && event.button !== 0)) return;
    runPointers.add(event.pointerId);
    try {
      runButton.setPointerCapture(event.pointerId);
    } catch {
      // Keep the press usable even if the browser declines pointer capture.
    }
    syncRun();
  });
  const finishRunPointer = (event) => releaseRunPointer(event.pointerId);
  listen(runButton, 'pointerup', finishRunPointer);
  listen(runButton, 'pointercancel', finishRunPointer);
  listen(runButton, 'lostpointercapture', finishRunPointer);
  listen(doc, 'pointerup', (event) => {
    if (event.pointerId === stickPointerId) clearStick();
    releaseRunPointer(event.pointerId);
  });
  listen(doc, 'pointercancel', (event) => {
    if (event.pointerId === stickPointerId) clearStick();
    releaseRunPointer(event.pointerId);
  });

  listen(doc, 'keydown', onKeyDown);
  listen(doc, 'keyup', onKeyUp);
  listen(win, 'blur', release);
  listen(doc, 'visibilitychange', () => {
    if (doc.hidden) release();
  });
  listen(win, 'pagehide', release);

  return {
    setActive,
    release,
    dispose() {
      if (disposed) return;
      setActive(false);
      release();
      disposed = true;
      for (const removeListener of listeners.splice(0)) removeListener();
      doc.body?.classList.remove('panda-playing');
      if (panel) panel.hidden = true;
      launch?.setAttribute('aria-expanded', 'false');
      runButton?.classList.remove('is-pressed');
      runButton?.setAttribute('aria-pressed', 'false');
      if (thumb) thumb.style.removeProperty('transform');
    },
  };
}
