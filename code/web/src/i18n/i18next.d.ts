import 'i18next';
import type en from './locales/en.json';
import type landing from './locales/landing.en.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: typeof en; landing: typeof landing };
  }
}
