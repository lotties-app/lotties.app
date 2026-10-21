import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppThemeProvider } from './AppThemeProvider';
import { useThemeMode } from './ThemeModeContext';
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
