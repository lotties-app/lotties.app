/*
 * The privacy policy's version facts, in one place. Change the text in privacy.en.ts and privacy.pt-BR.ts,
 * then raise the version and the date here (both languages show them). The audit behind the text is
 * docs/design/33-privacy-audit.md; what the owner must still decide is docs/PRIVACY-OWNER-CHECKLIST.md.
 */

/** Raise on every change of meaning (not for typo fixes). */
export const PRIVACY_POLICY_VERSION = '3';

/** The date the current version was written, `yyyy-mm-dd` (a calendar date, shown in the reader's language). */
export const PRIVACY_POLICY_LAST_UPDATED = '2026-10-24';

/** Where the policy is published (store listings, the Alexa console, docs). */
export const PRIVACY_POLICY_URL = 'https://lotties.app/privacy';

/** The anchor of a section on the page (`privacy-rights`). */
export const sectionAnchor = (id: string) => `privacy-${id}`;
