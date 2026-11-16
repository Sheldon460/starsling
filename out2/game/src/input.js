// Keyboard and pointer input. Held keys give nothing to steer (the comet is slung, not
// driven); one-shot presses (start, pause, mute) are queued as bit flags and taken once by
// the loop, so a press between two frames is never lost and never counted twice. Pointer
// drags are translated into field coordinates by the `toField` the boot code supplies.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_MUTE = 4;

const CONFIRM = new Set(['Space', 'Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const MUTE = new Set(['KeyM']);

export function createInput(target, toField, hooks) {
  let actions = 0;

  window.addEventListener('keydown', (event) => {
    if (CONFIRM.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
    } else if (MUTE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_MUTE;
    } else return;
    event.preventDefault();
  });

  let dragging = false;
  target.addEventListener('pointerdown', (event) => {
    const point = toField(event.clientX, event.clientY);
    dragging = true;
    target.setPointerCapture(event.pointerId);
    if (hooks.onDown(point.x, point.y)) return;
    // A tap that did not grab the comet still counts as confirm on menus.
    actions |= ACTION_CONFIRM;
  });
  target.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    const point = toField(event.clientX, event.clientY);
    hooks.onMove(point.x, point.y);
  });
  function endDrag(event) {
    if (!dragging) return;
    dragging = false;
    const point = toField(event.clientX, event.clientY);
    hooks.onUp(point.x, point.y);
  }
  target.addEventListener('pointerup', endDrag);
  target.addEventListener('pointercancel', endDrag);
  window.addEventListener('blur', () => {
    dragging = false;
  });

  return {
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
  };
}
