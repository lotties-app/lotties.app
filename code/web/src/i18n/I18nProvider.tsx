import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { resolveLocale, type Locale, type LocalePreference } from './config';
import { activateLocale, currentLocale, i18n, isLocaleLoaded, t } from './i18n';
import { LocaleContext, type LocaleApi } from './LocaleContext';
import { loadLocalePreference, storeLocalePreference } from './localeStorage';

/** The locale to show on first render, when it can be shown without waiting for a catalog. */
function readyLocale(preference: LocalePreference): Locale | null {
  const target = resolveLocale(preference);
  return isLocaleLoaded(target) && currentLocale() === target ? target : null;
}

/**
 * Owns the language setting (`system | en | pt-BR`): loads the catalog, switches i18next without
 * a reload, keeps `<html lang>` and the document title in step. Renders nothing for the instant
 * it takes to fetch a non-English catalog on first load.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState(loadLocalePreference);
  const [locale, setLocale] = useState<Locale | null>(() => readyLocale(preference));
  const [languagesTick, setLanguagesTick] = useState(0);

  useEffect(() => {
    if (preference !== 'system') return;
    const onChange = () => setLanguagesTick((n) => n + 1);
    window.addEventListener('languagechange', onChange);
    return () => window.removeEventListener('languagechange', onChange);
  }, [preference]);

  useEffect(() => {
    const target = resolveLocale(preference);
    let cancelled = false;
    activateLocale(target).then(
      () => {
        if (!cancelled) setLocale(target);
      },
      () => {
        // The catalog could not be fetched (offline first load): stay on the current language.
        if (!cancelled) setLocale(currentLocale());
      },
    );
    return () => {
      cancelled = true;
    };
  }, [preference, languagesTick]);

  useEffect(() => {
    if (!locale) return;
    document.documentElement.lang = locale;
    document.title = t('app.name');
  }, [locale]);

  const api = useMemo<LocaleApi | null>(
    () =>
      locale && {
        preference,
        locale,
        setPreference: (next) => {
          storeLocalePreference(next);
          setPreferenceState(next);
        },
      },
    [preference, locale],
  );

  if (!api) return null;
  return (
    <LocaleContext value={api}>
      <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
    </LocaleContext>
  );
}
