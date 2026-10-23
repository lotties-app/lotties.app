import { describe, expect, it } from 'vitest';
import { buildTheme, SCROLLBAR_STYLES, SCROLLBAR_VARS } from './theme';
import { DARK, LIGHT, NIGHT, RADIUS, SCHEMES, type SchemeTokens } from './tokens';

type Rules = Record<string, Record<string, unknown>>;

const theme = buildTheme();
const baseline = theme.components?.MuiCssBaseline?.styleOverrides as Record<string, unknown>;
const fine = baseline['@media (pointer: fine)'] as Rules;

/** `rgba(r, g, b, a)` laid over an opaque `#rrggbb`. */
function over(rgba: string, hex: string): [number, number, number] {
  const [r, g, b, a] = rgba.match(/[\d.]+/g)!.map(Number);
  const base = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return [r, g, b].map((c, i) => c * a + base[i] * (1 - a)) as [number, number, number];
}

function luminance([r, g, b]: [number, number, number]) {
  const [lr, lg, lb] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

const hexRgb = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];

function contrast(a: [number, number, number], b: [number, number, number]) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe('themed scrollbars', () => {
  it('are set once, in the CssBaseline, and only for a fine pointer (touch keeps overlay bars)', () => {
    expect(baseline['@media (pointer: fine)']).toEqual(SCROLLBAR_STYLES['@media (pointer: fine)']);
    expect(Object.keys(baseline).filter((key) => key.includes('scrollbar'))).toEqual([]);
  });

  it('use the standard properties where ::-webkit-scrollbar is not supported, with the same tokens', () => {
    const standard = fine['@supports not selector(::-webkit-scrollbar)'] as unknown as Rules;
    expect(standard['*']).toEqual({
      scrollbarWidth: 'thin',
      scrollbarColor: `${SCROLLBAR_VARS.thumb} transparent`,
    });
  });

  it('draw a slim rounded pill on a transparent track, no arrows, warmer on hover', () => {
    expect(fine['*::-webkit-scrollbar']).toEqual({ width: 12, height: 12 });
    expect(fine['*::-webkit-scrollbar-track, *::-webkit-scrollbar-corner']).toEqual({
      background: 'transparent',
    });
    const thumb = fine['*::-webkit-scrollbar-thumb'];
    expect(thumb.backgroundColor).toBe(SCROLLBAR_VARS.thumb);
    expect(thumb.borderRadius).toBe(RADIUS.pill);
    // 12 px gutter minus a 2 px transparent border on each side: an 8 px pill.
    expect(thumb.border).toBe('2px solid transparent');
    expect(thumb.backgroundClip).toBe('padding-box');
    expect(
      fine['*::-webkit-scrollbar-thumb:hover, *::-webkit-scrollbar-thumb:active'].backgroundColor,
    ).toBe(SCROLLBAR_VARS.hover);
    expect(fine['*::-webkit-scrollbar-button']).toEqual({ display: 'none', width: 0, height: 0 });
  });

  it('keep the bar clear of the rounded corners of sheets and dialogs', () => {
    expect(fine['*::-webkit-scrollbar-track']).toEqual({ marginBlock: 4 });
    expect(
      fine[
        '.MuiDrawer-paper::-webkit-scrollbar-track, .MuiDialog-paper::-webkit-scrollbar-track'
      ],
    ).toEqual({ marginBlock: RADIUS.sheetTop });
  });

  it('read the CSS variables of the scheme, which carry each scheme token', () => {
    expect(theme.vars.palette.scrollThumb).toMatch(/^var\(--mui-palette-scrollThumb[,)]/);
    expect(theme.vars.palette.scrollThumbHover).toMatch(/^var\(--mui-palette-scrollThumbHover[,)]/);
    for (const [name, tokens] of Object.entries(SCHEMES)) {
      const palette = theme.colorSchemes[name as keyof typeof theme.colorSchemes]!.palette;
      expect(palette.scrollThumb).toBe(tokens.scrollThumb);
      expect(palette.scrollThumbHover).toBe(tokens.scrollThumbHover);
    }
  });

  it.each(Object.entries(SCHEMES))(
    '%s: derived from the muted ink and the accent, visible on every surface, stronger on hover',
    (_, t: SchemeTokens) => {
      expect(t.scrollThumb).toMatch(/^rgba\(/);
      expect(over(t.scrollThumb, '#000000')).not.toEqual(over(t.scrollThumbHover, '#000000'));
      for (const surface of [t.background, t.surface, t.surfaceRaised]) {
        const rest = contrast(over(t.scrollThumb, surface), hexRgb(surface));
        const hover = contrast(over(t.scrollThumbHover, surface), hexRgb(surface));
        // Discoverable, not loud: a decorative bar, not a control that needs 3:1.
        expect(rest).toBeGreaterThanOrEqual(1.4);
        expect(rest).toBeLessThan(3);
        expect(hover).toBeGreaterThan(rest);
      }
    },
  );

  it('stays dimmer at night than in the dark scheme', () => {
    const night = luminance(over(NIGHT.scrollThumb, NIGHT.surface));
    const dark = luminance(over(DARK.scrollThumb, DARK.surface));
    expect(night).toBeLessThan(dark);
    expect(LIGHT.scrollThumb).not.toBe(DARK.scrollThumb);
  });
});
