import { createContext, useContext } from 'react';
import type { ThemeMode } from './theme';
import type { SchemeName, ResolvedMode } from './tokens';

export interface ThemeModeApi {
  /** The user's choice. */
  mode: ThemeMode;
  /** `mode` resolved against the OS (dark when it has no preference); the night view is not part of it. */
  resolved: ResolvedMode;
  /** What is actually shown: `resolved`, or `night` while the night view is active. */
  scheme: SchemeName;
  setMode: (mode: ThemeMode) => void;
}

export const ThemeModeContext = createContext<ThemeModeApi | null>(null);

export function useThemeMode(): ThemeModeApi {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) throw new Error('useThemeMode must be used within AppThemeProvider');
  return ctx;
}
