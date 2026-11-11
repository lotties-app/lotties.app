import { useEffect } from 'react';
import { NAV_TOAST_BOTTOM, TOAST_BOTTOM_VAR } from './navMetrics';

/** How many mounted bottom docks reserve the space (a count, so two never undo each other). */
let reservations = 0;

/** Sets the toast offset to "above the dock"; returns the release. */
export function reserveBottomNavSpace(): () => void {
  reservations += 1;
  document.documentElement.style.setProperty(TOAST_BOTTOM_VAR, NAV_TOAST_BOTTOM);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    reservations -= 1;
    if (reservations === 0) document.documentElement.style.removeProperty(TOAST_BOTTOM_VAR);
  };
}

/**
 * Called by a floating bottom dock while it is on screen: every toast and snackbar (they read
 * `TOAST_BOTTOM`) then sits above the dock and the safe-area inset instead of behind it.
 */
export function useBottomNavSpace(active = true) {
  useEffect(() => (active ? reserveBottomNavSpace() : undefined), [active]);
}
