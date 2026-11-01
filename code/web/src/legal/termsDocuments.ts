import type { Locale } from '../i18n/config';
import { termsEn } from './terms.en';
import { termsPtBR } from './terms.pt-BR';
import type { TermsDocument } from './termsTypes';

/** The terms text of each supported language (both are bundled with the page chunk, so it works offline). */
export const TERMS_DOCUMENTS: Readonly<Record<Locale, TermsDocument>> = {
  en: termsEn,
  'pt-BR': termsPtBR,
};

export function termsFor(locale: Locale): TermsDocument {
  return TERMS_DOCUMENTS[locale];
}
