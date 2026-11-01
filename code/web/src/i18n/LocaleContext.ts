import { createContext } from 'react';
import { DEFAULT_LOCALE, type Locale, type LocalePreference } from './config';

export interface LocaleApi {
  /** What the user chose (`system` follows the browser languages). */
  preference: LocalePreference;
  /** The language the UI currently shows. */
  locale: Locale;
  setPreference: (preference: LocalePreference) => void;
}

/** Without a provider (isolated component tests) the UI is English and the setter does nothing. */
export const LocaleContext = createContext<LocaleApi>({
  preference: 'system',
  locale: DEFAULT_LOCALE,
  setPreference: () => {},
});
