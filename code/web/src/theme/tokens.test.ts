import { describe, expect, it } from 'vitest';
import { BOTTOM_NAV_SCROLL_PADDING, buildTheme } from './theme';
import { CATEGORY_NAMES, DARK, LIGHT, NIGHT, SCHEMES, THEME_COLOR } from './tokens';

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe.each(Object.entries(SCHEMES))('%s tokens meet WCAG AA', (_, t) => {
  const surfaces = [t.background, t.surface, t.surfaceRaised];

  it.each([
    ['text', t.text],
    ['textMuted', t.textMuted],
    ['accent (text buttons, links)', t.accent],
    ['ink2 (links, secondary)', t.ink2],
    ['success', t.success],
    ['warning', t.warning],
    ['error', t.error],
    ['info', t.info],
  ])('%s as text on background, surface and raised surface', (_name, color) => {
    for (const surface of surfaces) {
      expect(contrast(color, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each([
    ['onAccent on accent', t.onAccent, t.accent],
    ['onSelection on selection', t.onSelection, t.selection],
    ['onSuccess on success', t.onSuccess, t.success],
    ['onWarning on warning', t.onWarning, t.warning],
    ['onError on error', t.onError, t.error],
    ['onInfo on info', t.onInfo, t.info],
  ])('%s', (_name, on, fill) => {
    expect(contrast(on, fill)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the focus ring (accent) and the selection fill visible on every surface (3:1)', () => {
    for (const surface of surfaces) {
      expect(contrast(t.accent, surface)).toBeGreaterThanOrEqual(3);
      expect(contrast(t.selection, surface)).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(CATEGORY_NAMES)('category %s icon on its tint (text-level contrast)', (name) => {
    expect(contrast(t.category[name].fg, t.category[name].bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(CATEGORY_NAMES)('category %s icon is also legible on the page surfaces (3:1)', (name) => {
    for (const surface of surfaces) {
      expect(contrast(t.category[name].fg, surface)).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(Object.entries(t.chart))(
    'chart colour %s is a 3:1 graphical object on the surface',
    (_n, color) => {
      expect(contrast(color, t.surface)).toBeGreaterThanOrEqual(3);
    },
  );
});

describe('night feed scheme', () => {
  const colors = (t: typeof NIGHT) =>
    [
      t.background,
      t.surface,
      t.surfaceRaised,
      t.hairline,
      t.text,
      t.textMuted,
      t.accent,
      t.onAccent,
      t.selection,
      t.onSelection,
      t.ink2,
      t.success,
      t.warning,
      t.error,
      t.info,
      ...Object.values(t.chart),
      ...CATEGORY_NAMES.flatMap((n) => [t.category[n].bg, t.category[n].fg]),
    ].filter((c) => c.startsWith('#'));

  it('keeps the blue channel at or below 0x78 everywhere', () => {
    for (const color of colors(NIGHT)) {
      expect(parseInt(color.slice(5, 7), 16)).toBeLessThanOrEqual(0x78);
    }
  });

  it('dims the text to about 45% of the dark scheme brightness', () => {
    const ratio = luminance(NIGHT.text) / luminance(DARK.text);
    expect(ratio).toBeGreaterThan(0.3);
    expect(ratio).toBeLessThan(0.55);
  });

  it('uses the same pair for every category, with no shadow or grain', () => {
    const pairs = new Set(CATEGORY_NAMES.map((n) => JSON.stringify(NIGHT.category[n])));
    expect(pairs.size).toBe(1);
    expect(NIGHT.cardShadow).toBe('none');
    expect(NIGHT.fabShadow).toBe('none');
    expect(NIGHT.grainOpacity).toBe(0);
  });
});

describe('PWA colours', () => {
  it('match the direction B backgrounds', () => {
    expect(THEME_COLOR).toEqual({ dark: '#1b1814', light: '#f5efe4', night: '#0d0906' });
    for (const [name, t] of Object.entries(SCHEMES)) {
      expect(t.themeColor).toBe(t.background);
      expect(THEME_COLOR[name as keyof typeof THEME_COLOR]).toBe(t.background);
    }
  });
});

describe('theme mapping', () => {
  const theme = buildTheme();
  const schemes = (
    theme as unknown as {
      colorSchemes: Record<'light' | 'dark' | 'night', { palette: typeof theme.palette }>;
    }
  ).colorSchemes;

  it('defines the three schemes from the tokens', () => {
    expect(Object.keys(schemes).sort()).toEqual(['dark', 'light', 'night']);
    expect(schemes.light.palette.primary.main).toBe(LIGHT.accent);
    expect(schemes.dark.palette.primary.main).toBe(DARK.accent);
    expect(schemes.night.palette.primary.main).toBe(NIGHT.accent);
    expect(schemes.night.palette.mode).toBe('dark');
  });

  it('replaces the MUI status colours with the token ones', () => {
    for (const [name, t] of [
      ['light', LIGHT],
      ['dark', DARK],
      ['night', NIGHT],
    ] as const) {
      const p = schemes[name].palette;
      expect(p.error.main).toBe(t.error);
      expect(p.warning.main).toBe(t.warning);
      expect(p.warning.contrastText).toBe(t.onWarning);
      expect(p.success.main).toBe(t.success);
      expect(p.info.main).toBe(t.info);
      expect(p.secondary.main).toBe(t.ink2);
    }
  });

  it('keeps focused content above the fixed bottom navigation (scroll padding)', () => {
    const baseline = theme.components?.MuiCssBaseline?.styleOverrides as Record<string, unknown>;
    expect(baseline.html).toMatchObject({ scrollPaddingBottom: BOTTOM_NAV_SCROLL_PADDING });
    expect(BOTTOM_NAV_SCROLL_PADDING).toContain('safe-area-inset-bottom');
  });

  it('never sets text below 12px', () => {
    for (const variant of ['caption', 'overline', 'body2', 'button'] as const) {
      const size = theme.typography[variant].fontSize as string;
      expect(parseFloat(size) * 16).toBeGreaterThanOrEqual(12);
    }
  });
});
