/** Supported UI languages. To add one: a catalog folder `locales/<code>/`, an entry here, a loader in `i18n.ts`. */
export const LOCALES = [
  { code: 'en', nativeName: 'English' },
  { code: 'pt-BR', nativeName: 'Português (Brasil)' },
] as const;

export type Locale = (typeof LOCALES)[number]['code'];
export type LocalePreference = 'system' | Locale;

/** Source and fallback language: bundled, never lazy. */
export const DEFAULT_LOCALE = 'en' satisfies Locale;

export function isLocale(value: unknown): value is Locale {
  return LOCALES.some((l) => l.code === value);
}

export function isLocalePreference(value: unknown): value is LocalePreference {
  return value === 'system' || isLocale(value);
}

/** Picks the first supported language from `navigator.languages`; `pt`/`pt-PT` map to `pt-BR`. */
export function detectLocale(languages: readonly string[]): Locale {
  for (const raw of languages) {
    const language = raw.toLowerCase().split('-')[0];
    if (language === 'pt') return 'pt-BR';
    if (language === 'en') return 'en';
  }
  return DEFAULT_LOCALE;
}

export function resolveLocale(
  preference: LocalePreference,
  languages: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages,
): Locale {
  return preference === 'system' ? detectLocale(languages) : preference;
}
