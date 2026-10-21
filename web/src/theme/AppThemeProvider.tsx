import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { CssBaseline, ThemeProvider, useColorScheme } from '@mui/material';
import { muiLocaleFor } from '../i18n/i18n';
import { useLocale } from '../i18n/useLocale';
import { buildTheme, type ThemeMode } from './theme';
import { loadStoredMode, storeMode } from './themeStorage';
import { ThemeModeContext } from './ThemeModeContext';
import { NightFeedContext, type NightFeedApi } from './NightFeedContext';
import { decideNightFeed, nightPeriodKey, type NightFeedSetting } from './nightFeed';
import {
  loadNightFeedSetting,
  loadNightFeedState,
  storeNightFeedSetting,
  storeNightFeedState,
} from './nightFeedStorage';
import { useSystemColorScheme } from './useSystemColorScheme';
import { THEME_COLOR, type ResolvedMode, type SchemeName } from './tokens';

/** How often the night window is re-evaluated (also on focus), so the scheme follows the clock. */
const CLOCK_TICK_MS = 30_000;

/**
 * Pushes the scheme into MUI's CSS-variables mode (the `data-` attribute on <html>). `night` is
 * the dark mode's second colour scheme. A layout effect keeps the first paint on the right one.
 */
function SchemeSync({ scheme }: { scheme: SchemeName }) {
  const { setMode, setColorScheme } = useColorScheme();
  useLayoutEffect(() => {
    setMode(scheme === 'light' ? 'light' : 'dark');
    setColorScheme({ dark: scheme === 'night' ? 'night' : 'dark' });
  }, [scheme, setMode, setColorScheme]);
  return null;
}

/** Keeps `<meta name="theme-color">` on the shown scheme, whatever the OS preference says. */
function useThemeColorMeta(scheme: SchemeName) {
  useEffect(() => {
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.removeAttribute('media');
      meta.setAttribute('content', THEME_COLOR[scheme]);
    });
  }, [scheme]);
}

/** The wall clock, refreshed periodically and when the app comes back to the foreground. */
function useClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = window.setInterval(tick, CLOCK_TICK_MS);
    const onVisible = () => document.visibilityState === 'visible' && tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return now;
}

function useNightFeedState(now: Date): NightFeedApi {
  const [setting, setSettingState] = useState<NightFeedSetting>(loadNightFeedSetting);
  const [state, setState] = useState(loadNightFeedState);
  const decision = decideNightFeed(setting, now, state);

  const update = useCallback((next: typeof state) => {
    setState(next);
    storeNightFeedState(next);
  }, []);

  return useMemo(
    () => ({
      setting,
      setSetting: (next) => {
        setSettingState(next);
        storeNightFeedSetting(next);
      },
      active: decision.active,
      suggested: decision.suggest,
      accept: () =>
        update({
          override: { on: true, key: nightPeriodKey(new Date()) },
          dismissedKey: state.dismissedKey,
        }),
      dismiss: () => update({ ...state, dismissedKey: nightPeriodKey(new Date()) }),
      toggle: () =>
        update({
          ...state,
          override: { on: !decision.active, key: nightPeriodKey(new Date()) },
        }),
    }),
    [setting, state, decision.active, decision.suggest, update],
  );
}

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const system = useSystemColorScheme();
  const { locale } = useLocale();
  // MUI's own strings (aria labels of its components) follow the UI language.
  const theme = useMemo(() => buildTheme(muiLocaleFor(locale)), [locale]);
  const [mode, setModeState] = useState<ThemeMode>(loadStoredMode);
  const resolved: ResolvedMode = mode === 'system' ? system : mode;
  const now = useClock();
  const nightFeed = useNightFeedState(now);
  const scheme: SchemeName = nightFeed.active ? 'night' : resolved;
  useThemeColorMeta(scheme);

  const api = useMemo(
    () => ({
      mode,
      resolved,
      scheme,
      setMode: (next: ThemeMode) => {
        setModeState(next);
        storeMode(next);
      },
    }),
    [mode, resolved, scheme],
  );

  return (
    <ThemeModeContext value={api}>
      <NightFeedContext value={nightFeed}>
        {/* MUI's own storage is off: the choice lives under `baby-routine.theme`. */}
        <ThemeProvider theme={theme} defaultMode={resolved} storageManager={null} noSsr>
          <SchemeSync scheme={scheme} />
          <CssBaseline enableColorScheme />
          {children}
        </ThemeProvider>
      </NightFeedContext>
    </ThemeModeContext>
  );
}
