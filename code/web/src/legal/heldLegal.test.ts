import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONSENT_VERSIONS } from './consentVersions';
import { POLICY_DOCUMENTS } from './policyDocuments';
import { POLICY_SECTION_IDS } from './policyTypes';

/*
 * The privacy policy and consent for "bring your own database" are held until the general release of the feature
 * (docs/legal-held/byo-database/README.md): the shipped policy (14, consent 2026-11-12.1) does not carry it. The held
 * texts live outside the app, and nothing in it may import them. Delete this test when the held content is released
 * (step 7 of that README).
 */

const SRC = path.resolve(__dirname, '..');
const SPECIFIER =
  /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]([^'"]+)['"]/gm;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|js|jsx|mjs)$/.test(name) ? [full] : [];
  });
}

describe('the held own-database policy', () => {
  it('is never imported by the app', () => {
    const offenders = sourceFiles(SRC).filter((file) =>
      [...readFileSync(file, 'utf8').matchAll(SPECIFIER)].some(([, spec]) =>
        spec.includes('legal-held'),
      ),
    );
    expect(offenders).toEqual([]);
  });

  it('is not in the shipped policy or the consent versions', () => {
    expect(POLICY_SECTION_IDS).not.toContain('own-database');
    for (const document of Object.values(POLICY_DOCUMENTS)) {
      expect(document.sections.map((section) => section.id)).not.toContain('own-database');
    }
    expect(CONSENT_VERSIONS.map((entry) => entry.version)).not.toContain('2026-11-07.1');
  });
});
