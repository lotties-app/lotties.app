import versions from './consentVersions.json';

/*
 * The consent versions (docs/design/38-consent-and-terms.md), read from consentVersions.json, the one file the API mirrors in
 * Lotties.Domain.Consents.ConsentVersions. `CONSENT_VERSION` is the newest entry: the pair (terms version, privacy policy version)
 * a person accepts. A change of meaning of the terms, the privacy policy or the consent screen adds an entry (never edit one):
 * material = everyone accepts again, minor = a dismissible notice.
 */

export interface ConsentVersionEntry {
  version: string;
  terms: string;
  privacyPolicy: string;
  material: boolean;
  /** `yyyy-mm-dd`. */
  date: string;
  /** Digest of the texts at that version (checked for the newest entry only, consentVersions.test.ts). */
  textDigest: string;
}

export const CONSENT_VERSIONS: readonly ConsentVersionEntry[] = versions.versions;

export const CURRENT_CONSENT: ConsentVersionEntry = CONSENT_VERSIONS[CONSENT_VERSIONS.length - 1];

/** The version a person accepts now (`2026-10-27.1`). */
export const CONSENT_VERSION = CURRENT_CONSENT.version;

/** The version of the terms of use and the date it was written (its first consent entry). */
export const TERMS_VERSION = CURRENT_CONSENT.terms;
export const TERMS_LAST_UPDATED = (
  CONSENT_VERSIONS.find((entry) => entry.terms === TERMS_VERSION) ?? CURRENT_CONSENT
).date;

const indexOf = (version: string | null | undefined) =>
  CONSENT_VERSIONS.findIndex((entry) => entry.version === version);

/** Whether a person whose accepted version is `accepted` (`null`: none) must accept again: never, unknown, or a material entry since. */
export function requiresAcceptance(accepted: string | null | undefined): boolean {
  const at = indexOf(accepted);
  return at < 0 || CONSENT_VERSIONS.slice(at + 1).some((entry) => entry.material);
}

/** She accepted an older version and only minor entries came since: a notice, not a new consent. */
export function hasMinorChangeSince(accepted: string | null | undefined): boolean {
  const at = indexOf(accepted);
  return at >= 0 && at < CONSENT_VERSIONS.length - 1 && !requiresAcceptance(accepted);
}
