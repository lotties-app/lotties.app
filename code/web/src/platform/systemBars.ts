import type { SystemBarsStyle } from './nativeShell';

/** The colour-scheme attributes the theme sets on <html> (public/theme-init.js, then MUI). */
const SCHEME_ATTRIBUTES = ['data-light', 'data-dark', 'data-night'];

/** Dark bar content on the light theme, light content on the dark and night themes. */
export function systemBarsStyleFor(root: Element): SystemBarsStyle {
  if (root.hasAttribute('data-light')) return 'LIGHT';
  if (root.hasAttribute('data-dark') || root.hasAttribute('data-night')) return 'DARK';
  return 'DEFAULT';
}

/**
 * Keeps the status and navigation bar content readable on the app's own theme, which can differ
 * from the device's appearance (a chosen theme, night feed). Returns the stop function.
 */
export function followThemeWithSystemBars(
  root: Element,
  setStyle: (style: SystemBarsStyle) => Promise<void>,
): () => void {
  let current: SystemBarsStyle | null = null;
  const apply = () => {
    const next = systemBarsStyleFor(root);
    if (next === current) return;
    current = next;
    setStyle(next).catch(() => {
      // Cosmetic: the bars keep their previous colours.
    });
  };
  apply();
  const observer = new MutationObserver(apply);
  observer.observe(root, { attributes: true, attributeFilter: SCHEME_ATTRIBUTES });
  return () => observer.disconnect();
}
