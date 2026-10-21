import { createContext, useContext } from 'react';
import type { ThemeMode } from './theme';
import type { ResolvedMode } from './tokens';

export interface ThemeModeApi {
  /** The user's choice. */
  mode: ThemeMode;
  /** What is actually shown (`system` resolved against the OS, dark when it has no preference). */
  resolved: ResolvedMode;
  setMode: (mode: ThemeMode) => void;
}

export const ThemeModeContext = createContext<ThemeModeApi | null>(null);

export function useThemeMode(): ThemeModeApi {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) throw new Error('useThemeMode must be used within AppThemeProvider');
  return ctx;
}
