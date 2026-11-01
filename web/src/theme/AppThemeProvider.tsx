import { useState, type ReactNode } from 'react';
import { CssBaseline, ThemeProvider, useMediaQuery } from '@mui/material';
import { buildTheme, type ColorMode } from './theme';
import { loadStoredMode, storeMode } from './themeStorage';
import { ThemeModeContext } from './ThemeModeContext';

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const systemDark = useMediaQuery('(prefers-color-scheme: dark)');
  const [stored, setStored] = useState<ColorMode | null>(loadStoredMode);
  const mode: ColorMode = stored ?? (systemDark ? 'dark' : 'light');

  const toggleMode = () => {
    const next: ColorMode = mode === 'dark' ? 'light' : 'dark';
    setStored(next);
    storeMode(next);
  };

  return (
    <ThemeModeContext value={{ mode, toggleMode }}>
      <ThemeProvider theme={buildTheme(mode)}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemeModeContext>
  );
}
