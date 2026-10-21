/** Geometry of the floating bottom navigation pill, shared by everything that sits above it. */
export const NAV_HEIGHT = 64;
/** Gap between the pill and the bottom edge of the screen (plus the safe-area inset). */
export const NAV_INSET = 12;
/** Where toasts and snackbars sit: just above the pill. */
export const NAV_TOAST_BOTTOM = `calc(${NAV_HEIGHT + NAV_INSET + 12}px + env(safe-area-inset-bottom) + var(--timer-bar-offset, 0px))`;
/** Bottom padding of the page content, so the last element can scroll clear of the pill. */
export const NAV_CONTENT_PADDING = `calc(${NAV_HEIGHT + NAV_INSET + 28}px + env(safe-area-inset-bottom) + var(--timer-bar-offset, 0px))`;

/**
 * Height the global mini timer bar takes above the pill (its card plus the gap), set on the root
 * element by the bar while timers run (`0px` otherwise). Toasts and the page padding add it, so
 * nothing hides behind the bar.
 */
export const TIMER_BAR_OFFSET_VAR = '--timer-bar-offset';
