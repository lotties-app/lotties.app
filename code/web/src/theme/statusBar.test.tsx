import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { render } from '@testing-library/react';
import { CssBaseline, Dialog, DialogTitle, ThemeProvider } from '@mui/material';
import { describe, expect, it } from 'vitest';
import { buildTheme, STATUS_BAR_STRIP } from './theme';
import { DARK, LIGHT, SHEET_MAX_HEIGHT } from './tokens';

/*
 * Guards of the status bar band (docs/design/12-mobile-capacitor.md "Status bar"). Where the app is
 * drawn edge to edge the page runs under a transparent status bar; jsdom has no safe-area insets,
 * so these check the rules. The browser check with a simulated inset is described in design 12.
 */
const REPO = resolve(__dirname, '..', '..', '..', '..');
const SRC = resolve(__dirname, '..');
const INSET = 'env(safe-area-inset-top)';

const theme = buildTheme();

const emittedCss = () =>
  Array.from(document.querySelectorAll('style'), (node) => node.textContent).join('');

/** The declarations of the plain rule of an element's emotion class (no nested selectors). */
function declarationsOf(element: Element): string {
  const css = emittedCss();
  return Array.from(element.classList)
    .filter((name) => name.startsWith('css-'))
    .flatMap((name) => [...css.matchAll(new RegExp(`\\.${name}\\{([^}]*)\\}`, 'g'))])
    .map((match) => match[1])
    .join(';');
}

describe('the strip behind the status bar', () => {
  it('is a fixed band as tall as the top inset, in the page background, on every screen', () => {
    const baseline = theme.components?.MuiCssBaseline?.styleOverrides as Record<string, unknown>;
    expect(baseline['body::before']).toEqual(STATUS_BAR_STRIP);
    expect(STATUS_BAR_STRIP).toMatchObject({
      content: '""',
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      height: INSET,
    });
    // The scheme's own page colour: MUI's variable, which light, dark and night each set.
    const page = theme.vars?.palette.background.default ?? '';
    const pageVariable = /^var\((--[\w-]+)/.exec(page)?.[1];
    expect(pageVariable).toBeDefined();
    expect(STATUS_BAR_STRIP.backgroundColor).toBe(`var(${pageVariable})`);
  });

  it('sits with the app bars: under the bars and the modal layer, over the page', () => {
    expect(STATUS_BAR_STRIP.zIndex).toBe(theme.zIndex.appBar);
    expect(STATUS_BAR_STRIP.zIndex).toBeLessThan(theme.zIndex.modal);
  });

  it('is emitted by the CssBaseline', () => {
    render(
      <ThemeProvider theme={theme}>
        <CssBaseline />
      </ThemeProvider>,
    );
    expect(emittedCss()).toMatch(
      /body::before\{[^}]*position:fixed[^}]*height:env\(safe-area-inset-top\)/,
    );
  });
});

describe('dialogs', () => {
  it('lays a centred dialog out below the top inset', () => {
    render(
      <ThemeProvider theme={theme}>
        <Dialog open>
          <DialogTitle>Title</DialogTitle>
        </Dialog>
      </ThemeProvider>,
    );
    const container = document.querySelector('.MuiDialog-container')!;
    expect(declarationsOf(container)).toContain(`padding-top:${INSET}`);
    const paper = document.querySelector('.MuiDialog-paper')!;
    expect(paper.classList.contains('MuiDialog-paperFullScreen')).toBe(false);
  });

  it('keeps a full-screen dialog under the status bar out of its content (a transparent border)', () => {
    render(
      <ThemeProvider theme={theme}>
        <Dialog open fullScreen>
          <DialogTitle>Title</DialogTitle>
        </Dialog>
      </ThemeProvider>,
    );
    const container = document.querySelector('.MuiDialog-container')!;
    expect(declarationsOf(container)).not.toContain('padding-top');
    const paper = document.querySelector('.MuiDialog-paperFullScreen')!;
    const fullScreenRule = Array.from(paper.classList)
      .filter((name) => name.startsWith('css-'))
      .map(
        (name) =>
          `.${name}.MuiDialog-paperFullScreen{border-radius:0;border-top:${INSET} solid transparent;}`,
      );
    expect(fullScreenRule.some((rule) => emittedCss().includes(rule))).toBe(true);
  });

  it('is not padded again by the full-screen dialogs that used to pad themselves', () => {
    for (const file of ['board/ItemDrawer.tsx', 'cryMonitor/ListeningView.tsx']) {
      expect(readFileSync(join(SRC, file), 'utf8')).not.toContain('safe-area-inset-top');
    }
  });
});

/** Every .tsx source outside tests and the dev previews. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'dev' ? [] : sources(path);
    return name.endsWith('.tsx') && !name.includes('.test.') ? [path] : [];
  });
}

describe('bottom sheets', () => {
  it('stop 16 px below the status bar', () => {
    expect(SHEET_MAX_HEIGHT).toBe(`calc(100dvh - 16px - ${INSET})`);
    const sheets = sources(SRC)
      .map((path) => [path.slice(SRC.length + 1).replace(/\\/g, '/'), path] as const)
      .filter(([, path]) => readFileSync(path, 'utf8').includes('anchor="bottom"'));
    expect(sheets.length).toBeGreaterThan(0);
    // A sheet's own "nearly the whole screen" height would reach under the status bar.
    const ownHeight = sheets
      .filter(([, path]) => readFileSync(path, 'utf8').includes('100dvh - 16px'))
      .map(([file]) => file);
    expect(ownHeight).toEqual([]);
  });
});

describe('the Android window background', () => {
  const read = (path: string) => readFileSync(resolve(REPO, path), 'utf8');
  const RES = 'code/mobile/android/app/src/main/res';
  const colour = (path: string) =>
    /<color name="splash_background">(#[0-9A-Fa-f]{6})<\/color>/
      .exec(read(path))?.[1]
      ?.toLowerCase();

  it('is the page colour, the status bar strip where the shell pads an older WebView', () => {
    const style = /<style name="AppTheme\.NoActionBar"[\s\S]*?<\/style>/.exec(
      read(`${RES}/values/styles.xml`),
    )?.[0];
    expect(style).toContain(
      '<item name="android:windowBackground">@color/splash_background</item>',
    );
    expect(colour(`${RES}/values/colors_splash.xml`)).toBe(LIGHT.background);
    expect(colour(`${RES}/values-night/colors_splash.xml`)).toBe(DARK.background);
  });
});
