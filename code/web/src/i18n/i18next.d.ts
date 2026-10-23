import 'i18next';
import type { Catalog } from './catalogEn';
import type landing from './locales/landing.en.json';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: { translation: Catalog; landing: typeof landing };
  }
}
