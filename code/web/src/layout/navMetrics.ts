/** Geometry of the floating bottom dock, shared by everything that sits above it. */
export const NAV_HEIGHT = 64;
/** Gap between the dock and the bottom edge of the screen (plus the safe-area inset). */
export const NAV_INSET = 12;
/** Diameter of the round quick-add button that floats at the bottom right, beside the dock. */
export const ADD_SIZE = 56;
/** Where toasts and snackbars sit: just above the dock. */
export const NAV_TOAST_BOTTOM = `calc(${NAV_HEIGHT + NAV_INSET + 12}px + env(safe-area-inset-bottom))`;
/** Bottom padding of the page content, so the last element can scroll clear of the dock. */
export const NAV_CONTENT_PADDING = `calc(${NAV_HEIGHT + NAV_INSET + 28}px + env(safe-area-inset-bottom))`;
