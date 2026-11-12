import { describe, expect, it } from 'vitest';
import { CURATED_CREDITS } from '../credits/curatedCredits';
import type { Locale } from '../i18n/config';
import {
  CURATED_CREDIT_PRIVACY,
  DATA_CATEGORY_IDS,
  ON_DEVICE_FLOWS,
  PLANNED_FLOWS,
  THIRD_PARTIES,
  THIRD_PARTY_IDS,
} from './dataFlows';
import { POLICY_DOCUMENTS } from './policyDocuments';
import { PRIVACY_POLICY_LAST_UPDATED, PRIVACY_POLICY_VERSION } from './privacyPolicy';

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

/* The words the policy must use for an on-device sensor flow (the cry monitor), per language. */
const SENSOR_WORDS: Readonly<Record<Locale, Record<string, RegExp>>> = {
  en: {
    name: /Cry monitor/,
    sensor: /microphone/,
    onDevice: /analysed on that device/,
    never: /never recorded, stored or sent/,
    saved: /crying spell/,
    alert: /Crying detected/,
    neverAsks: /does not ask for[^.]*microphone/,
  },
  'pt-BR': {
    name: /Monitor de choro/,
    sensor: /microfone/,
    onDevice: /analisado nesse aparelho/,
    never: /nunca é gravado, guardado ou enviado/,
    saved: /período de choro/,
    alert: /Choro detectado/,
    neverAsks: /não pede[^.]*microfone/,
  },
};

const sectionOf = (locale: Locale, id: string) =>
  POLICY_DOCUMENTS[locale].sections.find((section) => section.id === id);

const tableRows = (locale: Locale, tableId: 'data' | 'recipients') => {
  const blocks = POLICY_DOCUMENTS[locale].sections.flatMap((section) => [
    ...section.blocks,
    ...(section.subsections ?? []).flatMap((sub) => sub.blocks),
  ]);
  const table = blocks.find((block) => block.kind === 'table' && block.id === tableId);
  return table?.kind === 'table' ? table.rows : [];
};
const dataRow = (locale: Locale, id: string) => tableRows(locale, 'data').find((r) => r.id === id);
const recipientRow = (locale: Locale, id: string) =>
  tableRows(locale, 'recipients').find((r) => r.id === id);

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

  describe.each(ON_DEVICE_FLOWS.map((flow) => [flow.id, flow] as const))(
    'the on-device flow %s (docs/design/33 section 12)',
    (_, flow) => {
      it('is opt-in, off by default, keeps the raw signal on the device and uses our own server', () => {
        expect(flow.trigger).toBe('optIn');
        expect(flow.defaultOn).toBe(false);
        expect(flow.rawSignal).toEqual({ stored: false, sent: false });
        expect(flow.modelFrom).toBe('ownServer');
        expect(flow.consentBy).toEqual(['Owner', 'Parent', 'Caregiver']);
        expect(DATA_CATEGORY_IDS as readonly string[]).toContain(flow.dataCategory);
        for (const recipient of flow.recipients) expect(THIRD_PARTY_IDS).toContain(recipient);
      });

      it.each(Object.keys(POLICY_DOCUMENTS) as Locale[])(
        'is described in the %s policy: the sensor, on the device, never recorded, and what is saved',
        (locale) => {
          const document = POLICY_DOCUMENTS[locale];
          const text = JSON.stringify(document);
          const words = SENSOR_WORDS[locale];
          // Its own row of "What we collect".
          const row = JSON.stringify(dataRow(locale, flow.dataCategory));
          expect(row).toMatch(words.sensor);
          expect(row).toMatch(words.onDevice);
          expect(row).toMatch(words.never);
          expect(row).toMatch(words.saved);
          // No sentence may still say the app never asks for the microphone.
          expect(text).not.toMatch(words.neverAsks);
          // The alert to the family goes through the push services, as the other notifications.
          const push = JSON.stringify(recipientRow(locale, 'pushServices'));
          expect(push).toMatch(words.alert);
          // Its legal basis, its retention, its device storage and its limits are stated.
          for (const id of [
            'legal-bases',
            'retention',
            'device-storage',
            'not-medical',
            'security',
          ] as const) {
            expect(JSON.stringify(sectionOf(locale, id)), id).toMatch(words.name);
          }
          expect(JSON.stringify(sectionOf(locale, 'legal-bases'))).toMatch(/art\. 14, § ?1/);
        },
      );
    },
  );

  it('raised the policy version with the cry monitor (version 3 of 2026-10-24 or later)', () => {
    expect(Number(PRIVACY_POLICY_VERSION)).toBeGreaterThanOrEqual(3);
    expect(PRIVACY_POLICY_LAST_UPDATED >= '2026-10-24').toBe(true);
  });

  it.each(Object.keys(POLICY_DOCUMENTS) as Locale[])(
    'say in the %s policy that the widget pushes carry no content and stop with the widgets',
    (locale) => {
      const noContent = locale === 'en' ? /message with no content/ : /mensagem sem conteúdo/;
      const stops =
        locale === 'en' ? /last Lotties widget removed/ : /último widget do Lotties foi tirado/;
      expect(JSON.stringify(recipientRow(locale, 'appPushServices'))).toMatch(noContent);
      expect(JSON.stringify(dataRow(locale, 'widgetUpdates'))).toMatch(/Apple/);
      expect(JSON.stringify(dataRow(locale, 'widgetUpdates'))).toMatch(/Google/);
      expect(JSON.stringify(sectionOf(locale, 'retention'))).toMatch(stops);
      expect(JSON.stringify(sectionOf(locale, 'transfers'))).toMatch(/Apple Push Notification service/);
      expect(JSON.stringify(sectionOf(locale, 'transfers'))).toMatch(/Firebase Cloud Messaging/);
    },
  );

  it.each(Object.keys(POLICY_DOCUMENTS) as Locale[])(
    'name both apps and both push services for the widget pushes in the %s policy',
    (locale) => {
      // Policy 13 shipped the Android app (Google FCM), policy 14 added the iOS app (Apple APNs): the server sends to
      // both once the flag is on and a channel is configured (docs/design/37b-widget-silent-push.md section 11).
      const noContent = locale === 'en' ? /message with no content/ : /mensagem sem conteúdo/;
      const firebaseDocs =
        locale === 'en' ? /per Firebase's documentation/ : /segundo a documentação do Firebase/;
      const recipient = JSON.stringify(recipientRow(locale, 'appPushServices'));
      for (const row of [recipient, JSON.stringify(dataRow(locale, 'widgetUpdates'))]) {
        expect(row).toMatch(/iOS/);
        expect(row).toMatch(/Android/);
      }
      expect(recipient).toMatch(/Apple Push Notification service/);
      expect(recipient).toMatch(/Google Firebase Cloud Messaging/);
      expect(recipient).toMatch(noContent);
      expect(recipient).toMatch(firebaseDocs);
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
