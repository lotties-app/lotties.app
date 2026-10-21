import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Localization } from '@mui/material/locale';
import { DEFAULT_LOCALE, type Locale } from './config';
import en from './locales/en.json';

interface LoadedLocale {
  messages: object;
  /** Core component strings for MUI; absent keeps MUI's English. */
  mui?: Localization;
}

/** Non-default catalogs are separate chunks, fetched only when the language is used. */
const LOADERS: Record<Exclude<Locale, typeof DEFAULT_LOCALE>, () => Promise<LoadedLocale>> = {
  'pt-BR': async () => {
    const [messages, muiLocales] = await Promise.all([
      import('./locales/pt-BR.json'),
      import('@mui/material/locale'),
    ]);
    return { messages: messages.default, mui: muiLocales.ptBR };
  },
};

export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
  initAsync: false,
});

const muiLocales = new Map<Locale, Localization>();
const loading = new Map<Locale, Promise<void>>();

export function isLocaleLoaded(locale: Locale): boolean {
  return locale === DEFAULT_LOCALE || i18n.hasResourceBundle(locale, 'translation');
}

/** Makes the catalog of `locale` available (no-op for English and for loaded locales). */
export function loadLocale(locale: Locale): Promise<void> {
  if (isLocaleLoaded(locale)) return Promise.resolve();
  const existing = loading.get(locale);
  if (existing) return existing;
  const load = LOADERS[locale as Exclude<Locale, typeof DEFAULT_LOCALE>]().then(
    ({ messages, mui }) => {
      i18n.addResourceBundle(locale, 'translation', messages, true, true);
      if (mui) muiLocales.set(locale, mui);
    },
  );
  // A failed load is forgotten, so the next language change retries it.
  load.catch(() => loading.delete(locale));
  loading.set(locale, load);
  return load;
}

/** Loads and activates `locale`. */
export async function activateLocale(locale: Locale): Promise<void> {
  await loadLocale(locale);
  await i18n.changeLanguage(locale);
}

export function muiLocaleFor(locale: Locale): Localization | undefined {
  return muiLocales.get(locale);
}

/** The active locale (a supported code; falls back to the default). */
export function currentLocale(): Locale {
  return (i18n.resolvedLanguage ?? i18n.language) === 'pt-BR' ? 'pt-BR' : DEFAULT_LOCALE;
}

/** Typed translate function for code outside React components. */
export const t = i18n.t.bind(i18n);
