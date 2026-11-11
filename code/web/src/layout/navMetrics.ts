/** Geometry of the floating bottom dock, shared by everything that sits above it. */
export const NAV_HEIGHT = 64;
/** Gap between the dock and the bottom edge of the screen (plus the safe-area inset). */
export const NAV_INSET = 12;
/** Diameter of the round quick-add button that floats at the bottom right, beside the dock. */
export const ADD_SIZE = 56;
/** Where toasts and snackbars sit while a bottom dock is on screen: just above it. */
export const NAV_TOAST_BOTTOM = `calc(${NAV_HEIGHT + NAV_INSET + 12}px + env(safe-area-inset-bottom))`;
/** Where toasts and snackbars sit on a screen without a bottom dock: above the home indicator. */
export const NO_NAV_TOAST_BOTTOM = 'calc(16px + env(safe-area-inset-bottom))';
/**
 * CSS variable on `<html>` with the toast bottom offset. A mounted bottom dock sets it to
 * `NAV_TOAST_BOTTOM` (`useBottomNavSpace`); without one the fallback below applies.
 */
export const TOAST_BOTTOM_VAR = '--lotties-toast-bottom';
/** The bottom offset of every toast and snackbar (the dock's when there is one, plus the inset). */
export const TOAST_BOTTOM = `var(${TOAST_BOTTOM_VAR}, ${NO_NAV_TOAST_BOTTOM})`;
/** Bottom padding of the page content, so the last element can scroll clear of the dock. */
export const NAV_CONTENT_PADDING = `calc(${NAV_HEIGHT + NAV_INSET + 28}px + env(safe-area-inset-bottom))`;
