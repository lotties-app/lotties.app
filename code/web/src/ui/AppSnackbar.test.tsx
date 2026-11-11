import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppThemeProvider } from '../theme/AppThemeProvider';
import { AppSnackbar } from './AppSnackbar';
import { FALLBACK_HEIGHT, STACK_GAP, STACK_OFFSET_VAR } from './snackbarStack';

const SRC = resolve(import.meta.dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const rootOf = (text: string) => screen.getByText(text).closest('.MuiSnackbar-root') as HTMLElement;
const styles = () => Array.from(document.querySelectorAll('style'), (n) => n.textContent).join('');

describe('AppSnackbar', () => {
  it('sits above the dock offset on every width (the theme beats MUI 24 px media query)', () => {
    render(
      <AppThemeProvider>
        <AppSnackbar open message="Saved" />
      </AppThemeProvider>,
    );
    expect(rootOf('Saved').style.getPropertyValue(STACK_OFFSET_VAR)).toBe('0px');
    const css = styles();
    const bottom =
      'bottom:calc(var(--lotties-toast-bottom, calc(16px + env(safe-area-inset-bottom))) + var(--lotties-stack-offset, 0px))';
    // Base rule and the min-width (sm) rule both carry the shared offset.
    expect(css).toContain(bottom);
    expect(css).toMatch(
      /@media \(min-width:600px\)\{[^}]*bottom:calc\(var\(--lotties-toast-bottom/,
    );
    // MUI's own `bottom:24px` (min-width 600) comes first, so the shared offset wins the cascade.
    const cls = [...rootOf('Saved').classList].find((name) => name.startsWith('css-'));
    const own = css.lastIndexOf(`.${cls}{bottom:24px;}`);
    expect(own).toBeGreaterThan(-1);
    expect(css.lastIndexOf(`.${cls}{${bottom};}`)).toBeGreaterThan(own);
  });

  it('stacks two open snackbars instead of overlapping them, and drops back when one closes', () => {
    const { rerender } = render(
      <AppThemeProvider>
        <AppSnackbar open message="First" />
        <AppSnackbar open message="Second" />
      </AppThemeProvider>,
    );
    expect(rootOf('First').style.getPropertyValue(STACK_OFFSET_VAR)).toBe('0px');
    // jsdom has no layout: an unmeasured notice counts as one line.
    expect(rootOf('Second').style.getPropertyValue(STACK_OFFSET_VAR)).toBe(
      `${FALLBACK_HEIGHT + STACK_GAP}px`,
    );
    rerender(
      <AppThemeProvider>
        <AppSnackbar open={false} message="First" />
        <AppSnackbar open message="Second" />
      </AppThemeProvider>,
    );
    expect(rootOf('Second').style.getPropertyValue(STACK_OFFSET_VAR)).toBe('0px');
  });

  it('is the only way the app renders a snackbar', () => {
    const direct = sourceFiles(SRC)
      .filter((file) => !file.endsWith(join('ui', 'AppSnackbar.tsx')))
      .filter((file) => {
        const text = readFileSync(file, 'utf8');
        return (
          /import\s*\{[^}]*\bSnackbar\b[^}]*\}\s*from\s*'@mui\/material'/.test(text) ||
          text.includes("'@mui/material/Snackbar'")
        );
      })
      .map((file) => relative(SRC, file));
    expect(direct).toEqual([]);
  });

  it.each([
    'ui/UndoSnackbar.tsx',
    'events/DeletedEventSnackbar.tsx',
    'sync/RejectedChangeSnackbar.tsx',
    'pwa/ReloadPrompt.tsx',
    'presets/usePresetActions.tsx',
    'timers/RunningTimerPill.tsx',
    'board/BoardScreen.tsx',
  ])('%s uses AppSnackbar without its own bottom offset', (file) => {
    const text = readFileSync(join(SRC, file), 'utf8');
    expect(text).toContain('<AppSnackbar');
    expect(text).not.toMatch(/sx=\{\{\s*bottom:/);
  });

  it('the quick-log toast shares the same offset and stack', () => {
    const text = readFileSync(join(SRC, 'now', 'ui', 'ToastHost.tsx'), 'utf8');
    expect(text).toContain('useSnackbarStack(');
    expect(text).toContain('bottom: STACKED_TOAST_BOTTOM');
  });
});
