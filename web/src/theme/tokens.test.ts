import { describe, expect, it } from 'vitest';
import { CATEGORY_NAMES, SCHEMES, THEME_COLOR } from './tokens';

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
  it.each([
    ['text', t.text],
    ['textMuted', t.textMuted],
    ['accentSoft', t.accentSoft],
  ])('%s on background, surface and raised surface', (_name, color) => {
    for (const surface of [t.background, t.surface, t.surfaceRaised]) {
      expect(contrast(color, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('puts onAccent text on the accent colour', () => {
    expect(contrast(t.onAccent, t.accent)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(CATEGORY_NAMES)('category %s icon on its tint', (name) => {
    expect(contrast(t.category[name].fg, t.category[name].bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('PWA colours', () => {
  it('match the DESIGN.md backgrounds', () => {
    expect(THEME_COLOR).toEqual({ dark: '#15132e', light: '#f6f5ff' });
  });
});
