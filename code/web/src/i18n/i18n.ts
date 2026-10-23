import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Localization } from '@mui/material/locale';
import { enCatalog } from './catalogEn';
import { DEFAULT_LOCALE, type Locale } from './config';

interface LoadedLocale {
  messages: object;
  /** Core component strings for MUI; absent keeps MUI's English. */
  mui?: Localization;
}

/** Non-default catalogs are separate chunks, fetched only when the language is used. */
const LOADERS: Record<Exclude<Locale, typeof DEFAULT_LOCALE>, () => Promise<LoadedLocale>> = {
  'pt-BR': async () => {
    const [messages, muiLocales] = await Promise.all([
      import('./catalogPtBR'),
      import('@mui/material/locale'),
    ]);
    return { messages: messages.ptBRCatalog, mui: muiLocales.ptBR };
  },
};

export const i18n = i18next.createInstance();

void i18n.use(initReactI18next).init({
  resources: { en: { translation: enCatalog } },
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
  initAsync: false,
});

/**
 * Extra catalogs that belong to one lazy part of the app (not the main bundle): one JSON per
 * language, merged into i18next under their own namespace on first use.
 */
const NAMESPACE_LOADERS = {
  landing: {
    en: async () => (await import('./locales/landing.en.json')).default,
    'pt-BR': async () => (await import('./locales/landing.pt-BR.json')).default,
  },
} as const satisfies Record<string, Record<Locale, () => Promise<object>>>;
export type LazyNamespace = keyof typeof NAMESPACE_LOADERS;

export function isNamespaceLoaded(namespace: LazyNamespace, locale: Locale): boolean {
  return i18n.hasResourceBundle(locale, namespace);
}

/** Makes `namespace` available in English (the fallback) and in `locale`. */
export async function loadNamespace(namespace: LazyNamespace, locale: Locale): Promise<void> {
  for (const language of new Set<Locale>([DEFAULT_LOCALE, locale])) {
    if (isNamespaceLoaded(namespace, language)) continue;
    const messages = await NAMESPACE_LOADERS[namespace][language]();
    i18n.addResourceBundle(language, namespace, messages, true, true);
  }
}

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
