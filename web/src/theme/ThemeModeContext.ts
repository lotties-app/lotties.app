import { createContext, useContext } from 'react';
import type { ColorMode } from './theme';

export interface ThemeModeApi {
  mode: ColorMode;
  toggleMode: () => void;
}

export const ThemeModeContext = createContext<ThemeModeApi | null>(null);

export function useThemeMode(): ThemeModeApi {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) throw new Error('useThemeMode must be used within AppThemeProvider');
  return ctx;
}
