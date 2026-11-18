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

/**
 * Where this build stands against the version the server asks for (`GET /me/consents` `currentVersion`), by position in the
 * list (docs/design/38-consent-and-terms.md section 10):
 * - `current`: the same version, or the server did not say;
 * - `stale`: the server's version is later in the list, or unknown to this build: this app is older than the server and cannot
 *   show the text the server asks her to accept (an installed native build, or a browser held on an old bundle);
 * - `ahead`: this build is later than the server (the web deployed before the API): not stale, the server decides as usual.
 */
export type ConsentClientStanding = 'current' | 'stale' | 'ahead';

export function consentClientStanding(
  serverVersion: string | null | undefined,
  bundled: string = CONSENT_VERSION,
  versions: readonly ConsentVersionEntry[] = CONSENT_VERSIONS,
): ConsentClientStanding {
  if (!serverVersion || serverVersion === bundled) return 'current';
  const server = versions.findIndex((entry) => entry.version === serverVersion);
  const own = versions.findIndex((entry) => entry.version === bundled);
  return server < 0 || server > own ? 'stale' : 'ahead';
}

/** She accepted an older version and only minor entries came since: a notice, not a new consent. */
export function hasMinorChangeSince(accepted: string | null | undefined): boolean {
  const at = indexOf(accepted);
  return at >= 0 && at < CONSENT_VERSIONS.length - 1 && !requiresAcceptance(accepted);
}
