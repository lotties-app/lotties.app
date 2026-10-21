import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CssBaseline, ThemeProvider, useColorScheme } from '@mui/material';
import { muiLocaleFor } from '../i18n/i18n';
import { useLocale } from '../i18n/useLocale';
import { buildTheme, type ThemeMode } from './theme';
import { loadStoredMode, storeMode } from './themeStorage';
import { ThemeModeContext } from './ThemeModeContext';
import { useSystemColorScheme } from './useSystemColorScheme';
import type { ResolvedMode } from './tokens';

/** Pushes the resolved scheme into MUI's CSS-variables mode (the `data-` attribute on <html>). */
function SchemeSync({ resolved }: { resolved: ResolvedMode }) {
  const { setMode } = useColorScheme();
  useEffect(() => setMode(resolved), [resolved, setMode]);
  return null;
}

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const system = useSystemColorScheme();
  const { locale } = useLocale();
  // MUI's own strings (aria labels of its components) follow the UI language.
  const theme = useMemo(() => buildTheme(muiLocaleFor(locale)), [locale]);
  const [mode, setModeState] = useState<ThemeMode>(loadStoredMode);
  const resolved: ResolvedMode = mode === 'system' ? system : mode;

  const api = useMemo(
    () => ({
      mode,
      resolved,
      setMode: (next: ThemeMode) => {
        setModeState(next);
        storeMode(next);
      },
    }),
    [mode, resolved],
  );

  return (
    <ThemeModeContext value={api}>
      {/* MUI's own storage is off: the choice lives under `baby-routine.theme`. */}
      <ThemeProvider theme={theme} defaultMode={resolved} storageManager={null} noSsr>
        <SchemeSync resolved={resolved} />
        <CssBaseline enableColorScheme />
        {children}
      </ThemeProvider>
    </ThemeModeContext>
  );
}
