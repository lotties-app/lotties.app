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
  consentClientStanding,
  hasMinorChangeSince,
  requiresAcceptance,
  type ConsentVersionEntry,
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

describe('consentClientStanding', () => {
  const entry = (version: string): ConsentVersionEntry => ({
    version,
    terms: '1',
    privacyPolicy: '1',
    material: true,
    date: version.slice(0, 10),
    textDigest: 'x',
  });
  const LIST = [entry('2026-01-01.1'), entry('2026-02-01.1'), entry('2026-03-01.1')];

  it('is current when the server asks for the version this build carries, or does not say', () => {
    expect(consentClientStanding('2026-02-01.1', '2026-02-01.1', LIST)).toBe('current');
    expect(consentClientStanding(null, '2026-02-01.1', LIST)).toBe('current');
    expect(consentClientStanding('', '2026-02-01.1', LIST)).toBe('current');
    expect(consentClientStanding(CONSENT_VERSION)).toBe('current');
  });

  it('is stale when the server asks for a later version of the list', () => {
    expect(consentClientStanding('2026-03-01.1', '2026-02-01.1', LIST)).toBe('stale');
    expect(consentClientStanding('2026-03-01.1', '2026-01-01.1', LIST)).toBe('stale');
  });

  it('is stale when the server asks for a version this build does not know', () => {
    expect(consentClientStanding('2027-01-01.1', '2026-03-01.1', LIST)).toBe('stale');
    expect(consentClientStanding('2099-12-31.1')).toBe('stale');
  });

  it('is ahead, not stale, when this build is later than the server (web deployed first)', () => {
    expect(consentClientStanding('2026-01-01.1', '2026-03-01.1', LIST)).toBe('ahead');
    expect(consentClientStanding(CONSENT_VERSIONS[0].version)).toBe(
      CONSENT_VERSIONS.length > 1 ? 'ahead' : 'current',
    );
  });

  describe('with the server minimum version (section 11)', () => {
    const MIN = '2026-02-01.1';

    it('is behind, not stale, when this build is at or after the minimum and the server is later or unknown', () => {
      expect(consentClientStanding('2026-03-01.1', '2026-02-01.1', LIST, MIN)).toBe('behind');
      expect(consentClientStanding('2027-01-01.1', '2026-02-01.1', LIST, MIN)).toBe('behind');
      expect(consentClientStanding('2027-01-01.1', '2026-03-01.1', LIST, MIN)).toBe('behind');
    });

    it('is stale when this build is before the minimum, or does not know it', () => {
      expect(consentClientStanding('2026-03-01.1', '2026-01-01.1', LIST, MIN)).toBe('stale');
      expect(consentClientStanding('2027-01-01.1', '2026-03-01.1', LIST, '2027-01-01.1')).toBe(
        'stale',
      );
    });

    it('keeps current and ahead as without it', () => {
      expect(consentClientStanding('2026-02-01.1', '2026-02-01.1', LIST, MIN)).toBe('current');
      expect(consentClientStanding('2026-01-01.1', '2026-03-01.1', LIST, '2026-01-01.1')).toBe(
        'ahead',
      );
    });

    it('falls back to the position rule when the server sends no minimum (an older API)', () => {
      expect(consentClientStanding('2026-03-01.1', '2026-02-01.1', LIST, null)).toBe('stale');
      expect(consentClientStanding('2026-03-01.1', '2026-02-01.1', LIST, '')).toBe('stale');
      expect(consentClientStanding('2027-01-01.1', '2026-03-01.1', LIST)).toBe('stale');
    });

    it('the real list: this build is never stale against its own minimum', () => {
      const minimum = [...CONSENT_VERSIONS].reverse().find((entry) => entry.material)!.version;
      expect(
        consentClientStanding('2099-12-31.1', CONSENT_VERSION, CONSENT_VERSIONS, minimum),
      ).toBe('behind');
    });
  });
});
