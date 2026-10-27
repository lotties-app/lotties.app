import { describe, expect, it } from 'vitest';
import { enCatalog } from '../i18n/catalogEn';
import { ptBRCatalog } from '../i18n/catalogPtBR';
import { sha256Hex } from '../session/sha256';
import {
  CONSENT_VERSION,
  CONSENT_VERSIONS,
  CURRENT_CONSENT,
  TERMS_LAST_UPDATED,
  TERMS_VERSION,
  hasMinorChangeSince,
  requiresAcceptance,
} from './consentVersions';
import { privacyEn } from './privacy.en';
import { privacyPtBR } from './privacy.pt-BR';
import { PRIVACY_POLICY_LAST_UPDATED, PRIVACY_POLICY_VERSION } from './privacyPolicy';
import { termsEn } from './terms.en';
import { termsPtBR } from './terms.pt-BR';

/* The consent versions (docs/design/38-consent-and-terms.md): one list, the same constants as the code, and no silent text change. */

/** The parts of the consent screen's catalog that carry meaning (the settings screen's labels are not part of what she accepts). */
const SCREEN_KEYS = [
  'title',
  'intro',
  'points',
  'calm',
  'capacity',
  'declaration',
  'declineNote',
  'optional',
] as const;

function consentScreen(catalog: { consent: Record<string, unknown> }) {
  return Object.fromEntries(SCREEN_KEYS.map((key) => [key, catalog.consent[key]]));
}

/** The digest of every text a person accepts: terms, privacy policy and the consent screen, in both languages. */
export function currentTextDigest(): string {
  return sha256Hex(
    JSON.stringify({
      terms: [termsEn, termsPtBR],
      privacy: [privacyEn, privacyPtBR],
      screen: [consentScreen(enCatalog), consentScreen(ptBRCatalog)],
    }),
  );
}

describe('consent versions', () => {
  it('lists unique, ordered versions, the first one material', () => {
    expect(new Set(CONSENT_VERSIONS.map((entry) => entry.version)).size).toBe(
      CONSENT_VERSIONS.length,
    );
    expect(CONSENT_VERSIONS[0].material).toBe(true);
    expect([...CONSENT_VERSIONS.map((entry) => entry.date)].sort()).toEqual(
      CONSENT_VERSIONS.map((entry) => entry.date),
    );
    for (const entry of CONSENT_VERSIONS) {
      expect(entry.version).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
      expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.version.startsWith(entry.date)).toBe(true);
    }
  });

  it('carries the same terms and privacy policy versions as the constants the pages show', () => {
    expect(CURRENT_CONSENT.privacyPolicy).toBe(PRIVACY_POLICY_VERSION);
    expect(CONSENT_VERSION).toBe(CONSENT_VERSIONS[CONSENT_VERSIONS.length - 1].version);
    expect(TERMS_VERSION).toBe(CURRENT_CONSENT.terms);
    expect(TERMS_LAST_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(PRIVACY_POLICY_LAST_UPDATED <= CURRENT_CONSENT.date).toBe(true);
  });

  it('did not change a text without a new version: the digest of the newest entry matches', () => {
    const digest = currentTextDigest();
    expect(
      CURRENT_CONSENT.textDigest,
      `A text a person accepts changed. A change of MEANING needs a new entry in consentVersions.json (and the same in Lotties.Domain.Consents.ConsentVersions), with this digest: ${digest}. A typo fix only updates the digest of the newest entry to ${digest}.`,
    ).toBe(digest);
  });

  it('asks again only after a material entry', () => {
    expect(requiresAcceptance(null)).toBe(true);
    expect(requiresAcceptance('1999-01-01.1')).toBe(true);
    expect(requiresAcceptance(CONSENT_VERSION)).toBe(false);
    expect(hasMinorChangeSince(CONSENT_VERSION)).toBe(false);
    expect(hasMinorChangeSince(null)).toBe(false);
  });
});
