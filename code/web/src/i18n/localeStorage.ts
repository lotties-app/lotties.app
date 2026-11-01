import { isLocalePreference, type LocalePreference } from './config';

export const LOCALE_STORAGE_KEY = 'baby-routine.locale';

export function loadLocalePreference(): LocalePreference {
  try {
    const value = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    return isLocalePreference(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

export function storeLocalePreference(preference: LocalePreference) {
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, preference);
  } catch {
    // Storage unavailable: the preference lasts for this session only.
  }
}
