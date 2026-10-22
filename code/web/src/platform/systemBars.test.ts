import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeNativeShell } from './nativeTestKit';
import { startNativeShell } from './startNativeShell';
import { followThemeWithSystemBars, systemBarsStyleFor } from './systemBars';

const root = document.documentElement;
const SCHEMES = ['data-light', 'data-dark', 'data-night'];

function useScheme(scheme: string | null) {
  SCHEMES.forEach((attribute) => root.removeAttribute(attribute));
  if (scheme) root.setAttribute(scheme, '');
}

const stops: (() => void)[] = [];

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  useScheme(null);
});

/** MutationObserver callbacks run as microtasks. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('systemBarsStyleFor', () => {
  it('uses dark bar content on the light theme and light content on dark and night', () => {
    useScheme('data-light');
    expect(systemBarsStyleFor(root)).toBe('LIGHT');
    useScheme('data-dark');
    expect(systemBarsStyleFor(root)).toBe('DARK');
    useScheme('data-night');
    expect(systemBarsStyleFor(root)).toBe('DARK');
    useScheme(null);
    expect(systemBarsStyleFor(root)).toBe('DEFAULT');
  });
});

describe('followThemeWithSystemBars', () => {
  it('applies the current theme, then each change once', async () => {
    useScheme('data-dark');
    const setStyle = vi.fn(async () => {});
    stops.push(followThemeWithSystemBars(root, setStyle));

    useScheme('data-light');
    await flush();
    root.setAttribute('lang', 'pt-BR');
    await flush();

    expect(setStyle.mock.calls).toEqual([['DARK'], ['LIGHT']]);
  });

  it('ignores a failing plugin and stops observing when stopped', async () => {
    useScheme('data-light');
    const setStyle = vi.fn(async () => {
      throw new Error('not available');
    });
    const stop = followThemeWithSystemBars(root, setStyle);
    stop();

    useScheme('data-night');
    await flush();

    expect(setStyle).toHaveBeenCalledTimes(1);
  });
});

describe('startNativeShell', () => {
  it('follows the theme with the system bars', async () => {
    useScheme('data-night');
    const shell = fakeNativeShell();

    stops.push(startNativeShell(shell));
    await flush();

    expect(shell.styles).toEqual(['DARK']);
  });
});
