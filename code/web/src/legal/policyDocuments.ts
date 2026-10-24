import type { Locale } from '../i18n/config';
import { privacyEn } from './privacy.en';
import { privacyPtBR } from './privacy.pt-BR';
import type { PolicyDocument } from './policyTypes';

/** The policy text of each supported language (both are bundled with the page chunk, so it works offline). */
export const POLICY_DOCUMENTS: Readonly<Record<Locale, PolicyDocument>> = {
  en: privacyEn,
  'pt-BR': privacyPtBR,
};

export function policyFor(locale: Locale): PolicyDocument {
  return POLICY_DOCUMENTS[locale];
}
