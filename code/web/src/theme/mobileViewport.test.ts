import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildTheme } from './theme';

/*
 * Guards of the mobile overflow work (docs/design/30-mobile-overflow-audit.md). jsdom cannot
 * measure layout, so these check the sources; the Playwright overflow audit
 * (tests/e2e/design-review/overflow-audit.config.ts) measures the screens.
 */
const webDir = resolve(__dirname, '..', '..');
const srcDir = resolve(webDir, 'src');

type Styles = Record<string, unknown>;
function baseline(): Styles {
  const overrides = buildTheme().components?.MuiCssBaseline?.styleOverrides;
  expect(typeof overrides).toBe('object');
  return overrides as Styles;
}

describe('viewport meta', () => {
  const html = readFileSync(resolve(webDir, 'index.html'), 'utf8');
  const content = /<meta\s+name="viewport"\s+content="([^"]*)"/.exec(html)?.[1] ?? '';

  it('fits the device and the notch', () => {
    expect(content).toMatch(/width=device-width/);
    expect(content).toMatch(/initial-scale=1(\.0)?\b/);
    expect(content).toMatch(/viewport-fit=cover/);
  });

  it('never stops pinch zoom (WCAG 1.4.4)', () => {
    expect(content).not.toMatch(/maximum-scale/i);
    expect(content).not.toMatch(/minimum-scale/i);
    expect(content).not.toMatch(/user-scalable/i);
  });
});

describe('global mobile CSS', () => {
  it('keeps text fields at 16 px or more on touch screens (no iOS focus zoom)', () => {
    const coarse = baseline()['@media (pointer: coarse)'] as Styles | undefined;
    expect(coarse).toBeDefined();
    const entry = Object.entries(coarse ?? {}).find(([selector]) =>
      selector.includes('.MuiInputBase-root'),
    );
    expect(entry).toBeDefined();
    const [selector, rule] = entry as [string, Styles];
    for (const part of ['input', 'select', 'textarea', '.MuiPickersInputBase-root']) {
      expect(selector).toContain(part);
    }
    // max() keeps the user's larger text size; 16 px is the floor iOS needs.
    expect(rule.fontSize).toBe('max(16px, 1rem)');
  });

  it('stops the page bounce and double-tap zoom, never pinch zoom', () => {
    const styles = baseline();
    expect(styles.html).toMatchObject({ overscrollBehaviorY: 'none', textSizeAdjust: '100%' });
    expect(styles.body).toMatchObject({ overscrollBehaviorY: 'none' });
    const interactive = Object.entries(styles).find(([selector]) => selector.includes('button'));
    expect(interactive?.[1]).toEqual({ touchAction: 'manipulation' });
    const sheets = Object.entries(styles).find(([selector]) =>
      selector.includes('.MuiDrawer-paper'),
    );
    expect(sheets?.[0]).toContain('.MuiDialog-paper');
    expect(sheets?.[1]).toEqual({ overscrollBehavior: 'contain' });
    expect(JSON.stringify(styles)).not.toMatch(/touchAction":"(none|pan-x pan-y)"/);
  });
});

/** Every .ts/.tsx source outside tests. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('hand-made text fields', () => {
  // Fields whose own size is already 16 px or more (17 px and up) on every screen.
  const LARGE = [
    'ui/form/DurationField.tsx',
    'ui/form/NativeTimeInput.tsx',
    'ui/form/NumberStepper.tsx',
  ];

  it('use TOUCH_FIELD_FONT, so iOS never zooms into them', () => {
    const missing = sources(srcDir)
      .map((file) => file.slice(srcDir.length + 1).replace(/\\/g, '/'))
      .filter((file) => !file.startsWith('dev/') && !LARGE.includes(file))
      .filter((file) => {
        const text = readFileSync(join(srcDir, file), 'utf8');
        const field = /component=("(input|select|textarea)"|\{TextareaAutosize\})/.test(text);
        return field && !text.includes('TOUCH_FIELD_FONT');
      });
    expect(missing).toEqual([]);
  });
});

describe('touch-action', () => {
  it('never takes pinch zoom away from a swipe area', () => {
    const blocking = sources(srcDir).flatMap((file) =>
      [...readFileSync(file, 'utf8').matchAll(/touchAction: '([^']*)'/g)]
        .map((match) => match[1])
        .filter((value) => value.includes('pan-') && !value.includes('pinch-zoom'))
        .map((value) => `${file.slice(srcDir.length + 1)}: ${value}`),
    );
    expect(blocking).toEqual([]);
  });
});

describe('screen-reader-only text', () => {
  it('is 1 px wide in pixels: sx reads `width: 1` as 100 %, which pushes the page sideways', () => {
    const offenders = sources(srcDir).filter((file) => {
      const text = readFileSync(file, 'utf8');
      // A clipped, absolutely placed block (the visually-hidden pattern) sized with bare numbers.
      return /clip: 'rect\(0 0 0 0\)'/.test(text) && /\n\s*width: 1,\s*\n\s*height: 1,/.test(text);
    });
    expect(offenders.map((file) => file.slice(srcDir.length + 1))).toEqual([]);
  });
});
