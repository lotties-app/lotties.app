import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AppThemeProvider } from './AppThemeProvider';
import { useThemeMode } from './ThemeModeContext';
import { THEME_STORAGE_KEY } from './themeStorage';

function Probe() {
  const { mode, toggleMode } = useThemeMode();
  return <button onClick={toggleMode}>mode:{mode}</button>;
}

const renderProbe = () =>
  render(
    <AppThemeProvider>
      <Probe />
    </AppThemeProvider>,
  );

describe('AppThemeProvider', () => {
  it('toggles and persists the mode in localStorage', () => {
    renderProbe();
    fireEvent.click(screen.getByRole('button', { name: 'mode:light' }));
    expect(screen.getByRole('button', { name: 'mode:dark' })).toBeTruthy();
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
  });

  it('restores the stored mode', () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
    renderProbe();
    expect(screen.getByRole('button', { name: 'mode:dark' })).toBeTruthy();
  });
});
