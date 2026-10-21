import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { contrast, readSchemes, TOKENS_CSS, THEME_CSS, type Vars } from './contrast';

const webTokens = fileURLToPath(new URL('../../web/src/theme/tokens.ts', import.meta.url));
const hasWeb = existsSync(webTokens);
const schemes = readSchemes();

/** [foreground var, background var, minimum ratio, why] */
const PAIRS: ReadonlyArray<[string, string, number, string]> = [
  ['--br-text', '--br-bg', 4.5, 'body text on the page'],
  ['--br-text', '--br-surface', 4.5, 'body text on the card'],
  ['--br-text', '--br-raised', 4.5, 'text typed in a filled input'],
  ['--br-muted', '--br-surface', 4.5, 'help text, tagline'],
  ['--br-muted', '--br-raised', 4.5, 'unselected language pill, eye icon'],
  ['--br-muted', '--br-bg', 4.5, 'footer, hero note'],
  ['--br-ink2', '--br-surface', 4.5, 'links on the card'],
  ['--br-ink2', '--br-bg', 4.5, 'links on the page'],
  ['--br-accent', '--br-surface', 4.5, 'accent used as text/icon on the card'],
  ['--br-on-accent', '--br-accent', 4.5, 'primary button label'],
  ['--br-on-selection', '--br-selection', 4.5, 'secondary (ink) button label, selected pill'],
  ['--br-error', '--br-surface', 4.5, 'field error text'],
  ['--br-error', '--br-raised', 4.5, 'error text next to filled inputs'],
  ['--br-success', '--br-success-bg', 4.5, 'success alert'],
  ['--br-warning', '--br-warning-bg', 4.5, 'warning alert'],
  ['--br-error', '--br-error-bg', 4.5, 'error alert'],
  ['--br-info', '--br-info-bg', 4.5, 'info alert'],
  // Non-text: focus ring and input edge against what surrounds them (WCAG 1.4.11, 3:1).
  ['--br-accent', '--br-raised', 3, 'focus ring on a filled input'],
  ['--br-accent', '--br-bg', 3, 'focus ring on the page'],
  ['--br-error', '--br-surface', 3, 'invalid input ring'],
];

describe.each(['dark', 'light'] as const)('contrast (%s scheme)', (name) => {
  const vars: Vars = { ...schemes.dark, ...(name === 'light' ? schemes.light : {}) };
  it.each(PAIRS)('%s on %s >= %s:1 (%s)', (fg, bg, min) => {
    expect(vars[fg], fg).toMatch(/^#[0-9a-f]{6}$/i);
    expect(vars[bg], bg).toMatch(/^#[0-9a-f]{6}$/i);
    expect(contrast(vars[fg], vars[bg])).toBeGreaterThanOrEqual(min);
  });
});

describe('theme.css only uses defined tokens', () => {
  it('has no var(--br-*) or var(--il-*) without a definition', () => {
    const css = readFileSync(THEME_CSS, 'utf8');
    const defined = new Set([...Object.keys(schemes.dark), ...[...css.matchAll(/(--br-[\w-]+)\s*:/g)].map((m) => m[1])]);
    const used = [...css.matchAll(/var\((--(?:br|il)-[\w-]+)/g)].map((m) => m[1]);
    expect(used.filter((v) => !defined.has(v))).toEqual([]);
  });
});

describe.skipIf(!hasWeb)('token sync with web/src/theme/tokens.ts', () => {
  it('the committed CSS equals what sync-tokens would generate (run `npm run sync-tokens`)', async () => {
    const { buildTokensCss } = await import('../scripts/sync-tokens');
    expect(readFileSync(TOKENS_CSS, 'utf8')).toBe(buildTokensCss());
  });

  it('mirrors the key colours of the light and dark schemes', async () => {
    const { LIGHT, DARK, RADIUS } = await import('../../web/src/theme/tokens');
    const keys = [
      ['--br-bg', 'background'],
      ['--br-surface', 'surface'],
      ['--br-raised', 'surfaceRaised'],
      ['--br-hairline', 'hairline'],
      ['--br-text', 'text'],
      ['--br-muted', 'textMuted'],
      ['--br-accent', 'accent'],
      ['--br-on-accent', 'onAccent'],
      ['--br-selection', 'selection'],
      ['--br-ink2', 'ink2'],
      ['--br-error', 'error'],
      ['--br-success', 'success'],
      ['--br-warning', 'warning'],
    ] as const;
    for (const [cssVar, token] of keys) {
      expect(schemes.dark[cssVar], `dark ${token}`).toBe(DARK[token]);
      expect(schemes.light[cssVar], `light ${token}`).toBe(LIGHT[token]);
    }
    expect(schemes.dark['--br-radius-input']).toBe(`${RADIUS.input}px`);
    expect(schemes.dark['--br-radius-card']).toBe(`${RADIUS.card}px`);
    expect(schemes.dark['--br-radius-pill']).toBe(`${RADIUS.pill}px`);
  });
});
