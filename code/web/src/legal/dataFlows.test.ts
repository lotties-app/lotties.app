import { describe, expect, it } from 'vitest';
import { CURATED_CREDITS } from '../credits/curatedCredits';
import { CURATED_CREDIT_PRIVACY, THIRD_PARTIES, THIRD_PARTY_IDS } from './dataFlows';
import { POLICY_DOCUMENTS } from './policyDocuments';

/*
 * The policy's list of companies that receive data against the credits (credits/curated.json): a
 * service added to the credits must be classified, and a recipient must be in the policy, in both
 * languages. A new third party anywhere is therefore a conscious policy update
 * (docs/design/33-privacy-audit.md section 10).
 */

const recipientRows = (locale: keyof typeof POLICY_DOCUMENTS) => {
  const sharing = POLICY_DOCUMENTS[locale].sections.find((section) => section.id === 'sharing');
  const blocks = (sharing?.subsections ?? []).flatMap((sub) => sub.blocks);
  const table = blocks.find((block) => block.kind === 'table' && block.id === 'recipients');
  return table?.kind === 'table' ? table.rows.map((row) => row.id) : [];
};

describe('the data flows behind the privacy policy', () => {
  it('classify every curated credit, and only curated credits', () => {
    const curated = CURATED_CREDITS.map((item) => item.id).sort();
    expect(Object.keys(CURATED_CREDIT_PRIVACY).sort()).toEqual(curated);
  });

  it('treat every service the app calls as a recipient of data', () => {
    for (const item of CURATED_CREDITS.filter((credit) => credit.kind === 'service')) {
      expect(CURATED_CREDIT_PRIVACY[item.id].kind, item.id).toBe('recipient');
    }
  });

  it('tie every recipient credit to a third party of the policy, both ways', () => {
    for (const [id, privacy] of Object.entries(CURATED_CREDIT_PRIVACY)) {
      if (privacy.kind !== 'recipient') continue;
      const party = THIRD_PARTIES.find((candidate) => candidate.id === privacy.thirdParty);
      expect(party, id).toBeDefined();
      expect(party?.creditIds, id).toContain(id);
    }
    for (const party of THIRD_PARTIES) {
      for (const creditId of party.creditIds) {
        expect(CURATED_CREDIT_PRIVACY[creditId], creditId).toEqual({
          kind: 'recipient',
          thirdParty: party.id,
        });
      }
    }
  });

  it('list the third parties once, in the order of the policy table', () => {
    expect(THIRD_PARTIES.map((party) => party.id)).toEqual([...THIRD_PARTY_IDS]);
  });

  it.each(Object.keys(POLICY_DOCUMENTS) as (keyof typeof POLICY_DOCUMENTS)[])(
    'give every third party a row in the %s policy',
    (locale) => {
      expect(recipientRows(locale)).toEqual([...THIRD_PARTY_IDS]);
    },
  );

  it('name the countries question for every recipient abroad in the transfers section', () => {
    // Every recipient here may process data outside Brazil; the transfers section must exist and
    // cite LGPD art. 33 in each language.
    expect(THIRD_PARTIES.some((party) => party.abroad)).toBe(true);
    for (const document of Object.values(POLICY_DOCUMENTS)) {
      const transfers = document.sections.find((section) => section.id === 'transfers');
      expect(JSON.stringify(transfers)).toMatch(/art\. 33/);
    }
  });
});
