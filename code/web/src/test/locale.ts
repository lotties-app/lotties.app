import { activateLocale } from '../i18n/i18n';
import type { Locale } from '../i18n/config';
import { storeLocalePreference } from '../i18n/localeStorage';

/**
 * Makes the next render show `locale` straight away: stores it as the language setting and
 * loads its catalog. English is the default and needs no call.
 */
export async function useTestLocale(locale: Locale): Promise<void> {
  storeLocalePreference(locale);
  await activateLocale(locale);
}
