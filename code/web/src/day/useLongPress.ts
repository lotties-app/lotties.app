import { useEffect, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';

/** How long a press must last to open the menu, and how far the finger may wander meanwhile. */
export const HOLD_MS = 450;
export const HOLD_SLOP_PX = 10;

/** A light tick when the menu opens, where the device can (Android; iOS Safari has no vibrate). */
function haptic() {
  try {
    navigator.vibrate?.(10);
  } catch {
    // Some browsers refuse it; the haptic is only a nicety.
  }
}

/** The timer of one press: where it began, cancelled by a scroll anywhere on the page. */
function createPress() {
  let pending: { x: number; y: number; timer: number } | null = null;
  const cancel = () => {
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pending = null;
    window.removeEventListener('scroll', cancel, true);
  };
  return {
    cancel,
    isPending: () => pending !== null,
    start(x: number, y: number, onDone: () => void) {
      const timer = window.setTimeout(() => {
        cancel();
        onDone();
      }, HOLD_MS);
      pending = { x, y, timer };
      window.addEventListener('scroll', cancel, true);
    },
    moved(x: number, y: number) {
      if (pending && Math.hypot(x - pending.x, y - pending.y) > HOLD_SLOP_PX) cancel();
    },
  };
}

/**
 * Press and hold (about 450 ms) that calls `onHold`, plus its non-gesture alternatives: the
 * context menu (desktop right-click, Android's own long press) and, on the focused element, the
 * Menu key or Shift+F10. Moving more than 10 px, a scroll, a second finger or lifting the finger
 * early cancels it. After a hold the click that follows is swallowed, so the press never also
 * acts as a tap. `ignore(target)` leaves presses on inner controls (a Stop button) alone.
 * Returns the handlers of the container (`container`) and the keyboard handler of the focusable
 * element (`onKeyDown`).
 */
export function useLongPress(onHold: () => void, ignore: (target: Element) => boolean) {
  const [press] = useState(createPress);
  const fired = useRef(false);
  const onHoldRef = useRef(onHold);
  useEffect(() => {
    onHoldRef.current = onHold;
  });
  useEffect(() => press.cancel, [press]);

  const hold = () => {
    fired.current = true;
    haptic();
    onHoldRef.current();
  };

  const container = {
    onPointerDown: (event: ReactPointerEvent) => {
      fired.current = false;
      // A second finger (pinch, two-finger scroll) is never a hold.
      if (press.isPending()) {
        press.cancel();
        return;
      }
      if (event.button !== 0 || ignore(event.target as Element)) return;
      press.start(event.clientX, event.clientY, hold);
    },
    onPointerMove: (event: ReactPointerEvent) => press.moved(event.clientX, event.clientY),
    onPointerUp: press.cancel,
    onPointerCancel: press.cancel,
    onPointerLeave: press.cancel,
    onContextMenu: (event: ReactMouseEvent) => {
      if (ignore(event.target as Element)) return;
      // No native callout or menu: the hold (or the right-click) opens the row's own menu.
      event.preventDefault();
      press.cancel();
      if (!fired.current) hold();
    },
    onClickCapture: (event: ReactMouseEvent) => {
      if (!fired.current) return;
      fired.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };

  const onKeyDown = (event: ReactKeyboardEvent) => {
    if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
      event.preventDefault();
      onHoldRef.current();
    }
  };

  return { container, onKeyDown };
}
