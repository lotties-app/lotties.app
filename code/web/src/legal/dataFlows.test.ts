import { describe, expect, it } from 'vitest';
import { CURATED_CREDITS } from '../credits/curatedCredits';
import type { Locale } from '../i18n/config';
import {
  CURATED_CREDIT_PRIVACY,
  DATA_CATEGORY_IDS,
  PLANNED_FLOWS,
  THIRD_PARTIES,
  THIRD_PARTY_IDS,
} from './dataFlows';
import { POLICY_DOCUMENTS } from './policyDocuments';

/*
 * The status wording of a planned flow (docs/design/34-community-insights.md). It must stay in the text
 * while the feature is not built: activating the text without the feature fails here on purpose.
 */
const NOT_ACTIVE: Readonly<Record<Locale, RegExp>> = {
  en: /not active yet/i,
  'pt-BR': /ainda não (está )?ativo/i,
};
const OFF_FOR_EVERYONE: Readonly<Record<Locale, RegExp>> = {
  en: /off for everyone/,
  'pt-BR': /desligado para todos/,
};
const NOT_COLLECTED: Readonly<Record<Locale, RegExp>> = {
  en: /not collected today/i,
  'pt-BR': /não coletado hoje/i,
};

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

  describe.each(PLANNED_FLOWS.map((flow) => [flow.id, flow] as const))(
    'the planned flow %s',
    (_, flow) => {
      it('is planned, opt-in, off by default and has no recipient or data category', () => {
        expect(flow.status).toBe('planned');
        expect(flow.trigger).toBe('optIn');
        expect(flow.defaultOn).toBe(false);
        expect(flow.consentBy).toEqual(['Owner', 'Parent']);
        expect(flow.recipients).toEqual([]);
        // Nothing is collected for it: it must not be a row of "What we collect".
        expect(DATA_CATEGORY_IDS as readonly string[]).not.toContain(flow.id);
        expect(flow.minGroupSize).toBeGreaterThanOrEqual(20);
      });

      it.each(Object.keys(POLICY_DOCUMENTS) as Locale[])(
        'has its own %s section that says it is not active and lists what it would use',
        (locale) => {
          const section = POLICY_DOCUMENTS[locale].sections.find(
            (candidate) => candidate.id === flow.sectionId,
          );
          expect(section).toBeDefined();
          // The status is in the title (the contents list shows it) and in the first block, a note.
          expect(section?.title).toMatch(NOT_ACTIVE[locale]);
          const first = section?.blocks[0];
          expect(first?.kind).toBe('note');
          const note = first?.kind === 'note' ? first.text : '';
          expect(note).toMatch(NOT_ACTIVE[locale]);
          expect(note).toMatch(OFF_FOR_EVERYONE[locale]);
          const blocks = [
            ...(section?.blocks ?? []),
            ...(section?.subsections ?? []).flatMap((sub) => sub.blocks),
          ];
          const tables = blocks.filter((block) => block.kind === 'table');
          expect(tables.map((table) => (table.kind === 'table' ? table.id : ''))).toEqual([
            'planned',
          ]);
          const table = tables[0];
          expect(table?.kind === 'table' ? table.rows.map((row) => row.id) : []).toEqual([
            ...flow.rows,
          ]);
          expect(table?.kind === 'table' ? table.caption : '').toMatch(NOT_COLLECTED[locale]);
          const text = JSON.stringify(section);
          expect(text).toContain(`${flow.minGroupSize} `);
          expect(text).toMatch(/art\. 11/);
          expect(text).toMatch(/art\. 14/);
        },
      );
    },
  );

  it('keep the planned table out of every other section', () => {
    const plannedSections = new Set(PLANNED_FLOWS.map((flow) => flow.sectionId));
    for (const document of Object.values(POLICY_DOCUMENTS)) {
      for (const section of document.sections) {
        if (plannedSections.has(section.id)) continue;
        const blocks = [...section.blocks, ...(section.subsections ?? []).flatMap((s) => s.blocks)];
        expect(
          blocks.some((block) => block.kind === 'table' && block.id === 'planned'),
          section.id,
        ).toBe(false);
      }
    }
  });

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
