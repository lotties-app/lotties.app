import type { ThemeMode } from './theme';

export const THEME_STORAGE_KEY = 'baby-routine.theme';

/**
 * The stored choice. Values written by the old light/dark switch (`light`, `dark`) are explicit
 * choices and stay valid; anything unknown (or no value) means "follow the system".
 */
export function loadStoredMode(): ThemeMode {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

export function storeMode(mode: ThemeMode) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
  } catch {
    // Storage unavailable: the preference lasts for this session only.
  }
}
