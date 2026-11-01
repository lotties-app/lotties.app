import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applySchemeLinks, linksFor, SCHEME_LINKS } from './schemeLinks';

const initScript = readFileSync(resolve(__dirname, '..', '..', 'public', 'theme-init.js'), 'utf8');

function setupHead() {
  document.head.innerHTML =
    '<meta name="theme-color" content="#000" />' +
    '<link rel="manifest" href="/manifest.webmanifest" />' +
    '<link rel="apple-touch-icon" href="/apple-touch-icon.png" />';
}
const href = (rel: string) => document.querySelector(`link[rel="${rel}"]`)?.getAttribute('href');

describe('linksFor', () => {
  it('uses the dark set for dark and night, the light set for light', () => {
    expect(linksFor('light')).toBe(SCHEME_LINKS.light);
    expect(linksFor('dark')).toBe(SCHEME_LINKS.dark);
    expect(linksFor('night')).toBe(SCHEME_LINKS.dark);
  });
});

describe('applySchemeLinks', () => {
  beforeEach(setupHead);

  it('points the manifest and apple-touch-icon at the scheme set', () => {
    applySchemeLinks('dark');
    expect(href('manifest')).toBe('/manifest-dark.webmanifest');
    expect(href('apple-touch-icon')).toBe('/apple-touch-icon-dark.png');
    applySchemeLinks('light');
    expect(href('manifest')).toBe('/manifest.webmanifest');
    expect(href('apple-touch-icon')).toBe('/apple-touch-icon.png');
    applySchemeLinks('night');
    expect(href('manifest')).toBe('/manifest-dark.webmanifest');
  });

  it('does nothing when the links are absent', () => {
    document.head.innerHTML = '';
    expect(() => applySchemeLinks('dark')).not.toThrow();
  });
});

describe('public/theme-init.js', () => {
  const run = (opts: { stored?: string; prefersLight?: boolean; night?: boolean }) => {
    setupHead();
    window.localStorage.clear();
    if (opts.stored) window.localStorage.setItem('baby-routine.theme', opts.stored);
    if (opts.night) {
      window.localStorage.setItem('baby-routine.nightFeed', 'auto');
      vi.setSystemTime(new Date(2026, 9, 21, 23, 30));
    } else {
      vi.setSystemTime(new Date(2026, 9, 21, 12, 0));
    }
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('light') && !!opts.prefersLight,
    }));
    new Function(initScript)();
    return [href('manifest'), href('apple-touch-icon')];
  };
  const LIGHT = ['/manifest.webmanifest', '/apple-touch-icon.png'];
  const DARK = ['/manifest-dark.webmanifest', '/apple-touch-icon-dark.png'];

  beforeEach(() => vi.useFakeTimers({ toFake: ['Date'] }));
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  it('follows the system scheme when nothing is stored', () => {
    expect(run({ prefersLight: false })).toEqual(DARK);
    expect(run({ prefersLight: true })).toEqual(LIGHT);
  });

  it('honours an explicit stored choice over the system', () => {
    expect(run({ stored: 'light', prefersLight: false })).toEqual(LIGHT);
    expect(run({ stored: 'dark', prefersLight: true })).toEqual(DARK);
  });

  it('counts the night-feed scheme as dark', () => {
    expect(run({ stored: 'light', prefersLight: true, night: true })).toEqual(DARK);
  });
});
