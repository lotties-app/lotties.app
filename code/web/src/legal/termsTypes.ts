import type { Locale } from '../i18n/config';
import type { Inline, PolicyFallbacks } from './policyTypes';

/*
 * The shape of the terms of use (docs/design/38-consent-and-terms.md; drafted in docs/CONSENT-AND-TERMS-DRAFT.md section 5, to be
 * reviewed by the lawyer). The text itself lives in terms.en.ts and terms.pt-BR.ts; the page renders it (TermsContent.tsx), like
 * the privacy policy. Inline text follows the same two conventions as the policy (see policyTypes.ts): `[label](href)` links and
 * `{name}` values.
 */

export interface TermsClause {
  /** Stable id (the same in every language; the tests compare them). */
  id: string;
  title: string;
  text: Inline;
}

export interface TermsDocument {
  locale: Locale;
  /** The clauses, numbered in this order. */
  clauses: readonly TermsClause[];
  /** Text used when the owner has not set a contact value at build time (privacyConfig.ts), shared with the policy. */
  fallbacks: PolicyFallbacks;
}

/** The ids of the clauses, in page order. */
export const TERMS_CLAUSE_IDS = [
  'who',
  'beta',
  'who-may-use',
  'account',
  'data',
  'acceptable-use',
  'health',
  'integrations',
  'security',
  'changes',
  'ending',
  'liability',
  'open-source',
  'law',
] as const;
export type TermsClauseId = (typeof TERMS_CLAUSE_IDS)[number];
