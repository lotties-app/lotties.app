import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NightFeedBanner } from '../layout/NightFeedBanner';
import { AppThemeProvider } from './AppThemeProvider';
import { useThemeMode } from './ThemeModeContext';
import { useNightFeed } from './NightFeedContext';
import { NIGHT_FEED_STORAGE_KEY, NIGHT_FEED_STATE_STORAGE_KEY } from './nightFeedStorage';
import { loadStoredMode, THEME_STORAGE_KEY } from './themeStorage';

function Probe() {
  const { mode, resolved, setMode } = useThemeMode();
  return (
    <>
      <p>
        mode:{mode} shown:{resolved}
      </p>
      <button onClick={() => setMode('light')}>choose light</button>
      <button onClick={() => setMode('system')}>choose system</button>
    </>
  );
}

const renderProbe = () =>
  render(
    <AppThemeProvider>
      <Probe />
    </AppThemeProvider>,
  );

function mockSystem(prefersLight: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: prefersLight,
    addListener: (l: () => void) => listeners.add(l),
    removeListener: (l: () => void) => listeners.delete(l),
    addEventListener: (_: string, l: () => void) => listeners.add(l),
    removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  };
  vi.stubGlobal('matchMedia', (q: string) =>
    q.includes('light') ? query : { ...query, matches: false },
  );
  return {
    flip(light: boolean) {
      query.matches = light;
      act(() => listeners.forEach((l) => l()));
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('AppThemeProvider', () => {
  it('defaults to system, which is dark when the OS gives no light preference', () => {
    renderProbe();
    expect(screen.getByText('mode:system shown:dark')).toBeTruthy();
    expect(document.documentElement.hasAttribute('data-dark')).toBe(true);
  });

  it('follows a light system preference, and changes with it', () => {
    const system = mockSystem(true);
    renderProbe();
    expect(screen.getByText('mode:system shown:light')).toBeTruthy();
    system.flip(false);
    expect(screen.getByText('mode:system shown:dark')).toBeTruthy();
  });

  it('persists an explicit choice and restores it', () => {
    renderProbe();
    fireEvent.click(screen.getByRole('button', { name: 'choose light' }));
    expect(screen.getByText('mode:light shown:light')).toBeTruthy();
    expect(document.documentElement.hasAttribute('data-light')).toBe(true);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light');
    fireEvent.click(screen.getByRole('button', { name: 'choose system' }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('system');
  });

  it('keeps a value stored by the old light/dark switch as an explicit choice', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    renderProbe();
    expect(screen.getByText('mode:light shown:light')).toBeTruthy();
  });

  it('treats unknown stored values as system and survives unavailable storage', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'blue');
    expect(loadStoredMode()).toBe('system');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(loadStoredMode()).toBe('system');
    vi.restoreAllMocks();
  });
});

describe('night feed', () => {
  function NightProbe() {
    const { setting, setSetting, active, toggle } = useNightFeed();
    const { scheme } = useThemeMode();
    return (
      <>
        <p>
          setting:{setting} active:{String(active)} scheme:{scheme}
        </p>
        <button onClick={() => setSetting('auto')}>choose auto</button>
        <button onClick={toggle}>toggle night</button>
        <NightFeedBanner />
      </>
    );
  }
  const renderNight = () =>
    render(
      <AppThemeProvider>
        <NightProbe />
      </AppThemeProvider>,
    );
  const clock = (iso: string) => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(new Date(iso));
  };
  const meta = () => document.head.querySelector('meta[name="theme-color"]');

  beforeEach(() => {
    for (const [content, media] of [
      ['#f5efe4', 'light'],
      ['#1b1814', 'dark'],
    ]) {
      const tag = document.createElement('meta');
      tag.name = 'theme-color';
      tag.content = content;
      tag.media = `(prefers-color-scheme: ${media})`;
      document.head.append(tag);
    }
  });
  afterEach(() => {
    document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
    vi.useRealTimers();
  });

  it('defaults to ask, offers the switch only inside 22:00-05:00, and keeps the dark scheme until accepted', () => {
    clock('2026-10-21T15:00:00');
    const first = renderNight();
    expect(screen.getByText('setting:ask active:false scheme:dark')).toBeTruthy();
    expect(screen.queryByText('Switch to night view?')).toBeNull();
    first.unmount();

    clock('2026-10-21T23:10:00');
    renderNight();
    expect(screen.getByText('Switch to night view?')).toBeTruthy();
    expect(screen.getByText('setting:ask active:false scheme:dark')).toBeTruthy();
  });

  it('Switch turns the night scheme on, syncs the theme-color meta and persists the choice', () => {
    clock('2026-10-21T23:10:00');
    renderNight();
    fireEvent.click(screen.getByRole('button', { name: 'Switch' }));
    expect(screen.getByText('setting:ask active:true scheme:night')).toBeTruthy();
    expect(document.documentElement.hasAttribute('data-night')).toBe(true);
    expect(document.documentElement.hasAttribute('data-dark')).toBe(false);
    expect(meta()?.getAttribute('content')).toBe('#0d0906');
    expect(meta()?.hasAttribute('media')).toBe(false);
    expect(screen.queryByText('Switch to night view?')).toBeNull();
    expect(window.localStorage.getItem(NIGHT_FEED_STATE_STORAGE_KEY)).toContain('"on":true');
  });

  it('Not now hides the offer for the rest of the window, also after a reload', () => {
    clock('2026-10-21T23:10:00');
    const first = renderNight();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByText('Switch to night view?')).toBeNull();
    first.unmount();
    renderNight();
    expect(screen.queryByText('Switch to night view?')).toBeNull();
    expect(screen.getByText('setting:ask active:false scheme:dark')).toBeTruthy();
  });

  it('auto switches inside the window and back at 05:00 without any interaction', () => {
    window.localStorage.setItem(NIGHT_FEED_STORAGE_KEY, 'auto');
    clock('2026-10-21T04:58:00');
    renderNight();
    expect(screen.getByText('setting:auto active:true scheme:night')).toBeTruthy();
    act(() => {
      vi.setSystemTime(new Date('2026-10-21T05:01:00'));
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText('setting:auto active:false scheme:dark')).toBeTruthy();
    expect(meta()?.getAttribute('content')).toBe('#1b1814');
  });

  it('the quick toggle overrides auto until the next boundary', () => {
    window.localStorage.setItem(NIGHT_FEED_STORAGE_KEY, 'auto');
    clock('2026-10-21T23:00:00');
    renderNight();
    fireEvent.click(screen.getByRole('button', { name: 'toggle night' }));
    expect(screen.getByText('setting:auto active:false scheme:dark')).toBeTruthy();
    act(() => {
      vi.setSystemTime(new Date('2026-10-22T02:00:00'));
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText('setting:auto active:false scheme:dark')).toBeTruthy();
    // After 05:00 and the next 22:00 the choice has expired and auto applies again.
    act(() => {
      vi.setSystemTime(new Date('2026-10-22T22:30:00'));
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByText('setting:auto active:true scheme:night')).toBeTruthy();
  });

  it('shows the night scheme over a light preference, and persists the setting', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    clock('2026-10-21T15:00:00');
    renderNight();
    fireEvent.click(screen.getByRole('button', { name: 'choose auto' }));
    expect(window.localStorage.getItem(NIGHT_FEED_STORAGE_KEY)).toBe('auto');
    fireEvent.click(screen.getByRole('button', { name: 'toggle night' }));
    expect(screen.getByText('setting:auto active:true scheme:night')).toBeTruthy();
    expect(document.documentElement.hasAttribute('data-night')).toBe(true);
  });

  it('keeps the theme-color meta on the light scheme when light is chosen', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'light');
    clock('2026-10-21T15:00:00');
    renderNight();
    expect(meta()?.getAttribute('content')).toBe('#f5efe4');
  });
});
