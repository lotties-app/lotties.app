import type { ColorMode } from './theme';

export const THEME_STORAGE_KEY = 'baby-routine.theme';

export function loadStoredMode(): ColorMode | null {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

export function storeMode(mode: ColorMode) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Storage unavailable: the preference lasts for this session only.
  }
}
