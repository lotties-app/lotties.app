import { describe, expect, it } from 'vitest';
import { SOURCE_REPOSITORY } from '../credits/curatedCredits';
import { LOCALES } from '../i18n/config';
import { DATA_CATEGORY_IDS, THIRD_PARTY_IDS } from './dataFlows';
import { parseInline, type UrlToken } from './inlineText';
import { POLICY_DOCUMENTS } from './policyDocuments';
import { POLICY_SECTION_IDS, type Block, type Inline, type PolicyDocument } from './policyTypes';
import { ISSUES_URL, PRIVATE_REPORT_URL } from './privacyConfig';
import {
  PRIVACY_POLICY_LAST_UPDATED,
  PRIVACY_POLICY_URL,
  PRIVACY_POLICY_VERSION,
  sectionAnchor,
} from './privacyPolicy';

/* The policy content itself (docs/design/33-privacy-audit.md): complete, the same in both languages. */

const URLS: Record<UrlToken, string> = {
  issuesUrl: ISSUES_URL,
  advisoryUrl: PRIVATE_REPORT_URL,
  repoUrl: SOURCE_REPOSITORY,
};

const documents = Object.values(POLICY_DOCUMENTS);

/** Every inline text of a document: summary, sections, subsections, tables and fallbacks. */
function texts(document: PolicyDocument): Inline[] {
  const ofBlock = (block: Block): Inline[] => {
    switch (block.kind) {
      case 'p':
      case 'note':
        return [block.text];
      case 'list':
        return [...block.items];
      case 'table':
        return [block.caption, ...block.columns, ...block.rows.flatMap((row) => row.cells)];
    }
  };
  return [
    document.summary.title,
    ...document.summary.groups.flatMap((group) => [group.title, ...group.items]),
    ...document.sections.flatMap((section) => [
      section.title,
      ...section.blocks.flatMap(ofBlock),
      ...(section.subsections ?? []).flatMap((sub) => [sub.title, ...sub.blocks.flatMap(ofBlock)]),
    ]),
    document.fallbacks.controller,
    document.fallbacks.contact,
    document.fallbacks.dpo,
  ];
}

function tableOf(document: PolicyDocument, id: 'data' | 'recipients') {
  const blocks = document.sections.flatMap((section) => [
    ...section.blocks,
    ...(section.subsections ?? []).flatMap((sub) => sub.blocks),
  ]);
  const table = blocks.find((block) => block.kind === 'table' && block.id === id);
  if (table?.kind !== 'table') throw new Error(`no ${id} table in ${document.locale}`);
  return table;
}

/** The anchors a link inside the page may point at. */
function anchorsOf(document: PolicyDocument): Set<string> {
  return new Set(
    document.sections.flatMap((section) => [
      `#${sectionAnchor(section.id)}`,
      ...(section.subsections ?? []).map((sub) => `#${sectionAnchor(section.id)}-${sub.id}`),
    ]),
  );
}

/** The in-app routes the policy may link to (each exists in AppRoutes.tsx). */
const KNOWN_ROUTES = new Set([
  '/hub/export',
  '/hub/family',
  '/hub/family#doctor-access',
  '/settings',
  '/settings#account',
  '/settings#notifications',
]);

describe('the privacy policy content', () => {
  it('exists for every supported language', () => {
    expect(Object.keys(POLICY_DOCUMENTS).sort()).toEqual(LOCALES.map((l) => l.code).sort());
    for (const [locale, document] of Object.entries(POLICY_DOCUMENTS)) {
      expect(document.locale).toBe(locale);
    }
  });

  it.each(documents.map((d) => [d.locale, d] as const))(
    'has every section, in order, none of them empty (%s)',
    (_, document) => {
      expect(document.sections.map((section) => section.id)).toEqual([...POLICY_SECTION_IDS]);
      for (const section of document.sections) {
        const subsections = section.subsections ?? [];
        expect(section.blocks.length + subsections.length, section.id).toBeGreaterThan(0);
        for (const sub of subsections) expect(sub.blocks.length, sub.id).toBeGreaterThan(0);
      }
    },
  );

  it('gives both languages the same subsections and table rows', () => {
    const [first, ...others] = documents;
    const shape = (document: PolicyDocument) =>
      document.sections.map((section) => ({
        id: section.id,
        blocks: section.blocks.map((block) => block.kind),
        subsections: (section.subsections ?? []).map((sub) => ({
          id: sub.id,
          blocks: sub.blocks.map((block) => block.kind),
        })),
      }));
    for (const other of others) expect(shape(other)).toEqual(shape(first));
  });

  it.each(documents.map((d) => [d.locale, d] as const))(
    'has no empty text, placeholder or unresolved marker (%s)',
    (_, document) => {
      for (const text of texts(document)) {
        expect(text.trim(), JSON.stringify(text)).not.toBe('');
        expect(text).not.toMatch(/OWNER TO|lorem ipsum/i);
        // Case-sensitive: "todo" is an ordinary Portuguese word.
        expect(text).not.toMatch(/\b(TODO|TBD|FIXME|XXX)\b/);
        expect(text).not.toMatch(/<[^>]*>/);
        // Whatever is left after the links and values are taken out is plain text.
        for (const part of parseInline(text, URLS)) {
          if (part.kind === 'text') expect(part.text, text).not.toMatch(/\]\(|\{[A-Za-z]+\}/);
        }
      }
    },
  );

  it.each(documents.map((d) => [d.locale, d] as const))(
    'links only to its own sections, known app pages and https addresses (%s)',
    (_, document) => {
      const anchors = anchorsOf(document);
      const links = texts(document).flatMap((text) =>
        parseInline(text, URLS).filter((part) => part.kind === 'link'),
      );
      expect(links.length).toBeGreaterThan(5);
      for (const link of links) {
        if (link.kind !== 'link') continue;
        if (link.target === 'anchor') expect(anchors.has(link.href), link.href).toBe(true);
        if (link.target === 'route') expect(KNOWN_ROUTES.has(link.href), link.href).toBe(true);
        if (link.target === 'external') expect(link.href).toMatch(/^https:\/\//);
      }
    },
  );

  it.each(documents.map((d) => [d.locale, d] as const))(
    'lists every data category and every recipient in its tables (%s)',
    (_, document) => {
      const data = tableOf(document, 'data');
      const recipients = tableOf(document, 'recipients');
      expect(data.rows.map((row) => row.id)).toEqual([...DATA_CATEGORY_IDS]);
      expect(recipients.rows.map((row) => row.id)).toEqual([...THIRD_PARTY_IDS]);
      for (const table of [data, recipients]) {
        expect(table.columns).toHaveLength(3);
        for (const row of table.rows) expect(row.cells, row.id).toHaveLength(table.columns.length);
      }
    },
  );

  it.each(documents.map((d) => [d.locale, d] as const))(
    'states the version and date, the controller, the contact and the encarregado (%s)',
    (_, document) => {
      const all = texts(document).join('\n');
      const changes = document.sections.find((section) => section.id === 'changes');
      const changesText = JSON.stringify(changes);
      expect(changesText).toContain('{version}');
      expect(changesText).toContain('{lastUpdated}');
      for (const slot of ['{controller}', '{contact}', '{dpo}']) expect(all).toContain(slot);
      // The summary: what we collect, what we do not do, the key rights.
      expect(document.summary.groups.every((group) => group.items.length > 0)).toBe(true);
      // The default contact points at the public tracker and at a private report.
      expect(document.fallbacks.contact).toContain('{issuesUrl}');
      expect(document.fallbacks.contact).toContain('{advisoryUrl}');
    },
  );

  it.each(documents.map((d) => [d.locale, d] as const))(
    'says it is not a medical device and that data about other people is the user’s responsibility (%s)',
    (_, document) => {
      const section = (id: string) =>
        JSON.stringify(document.sections.find((candidate) => candidate.id === id));
      expect(section('not-medical')).toMatch(/medical device|dispositivo médico/);
      expect(section('other-people')).toMatch(/responsible|responsável/);
      expect(section('rights')).toMatch(/art\. 18/);
      expect(section('children')).toMatch(/art\. 14/);
    },
  );

  it('has one version and a calendar date, and the public address', () => {
    expect(PRIVACY_POLICY_VERSION).toMatch(/^\d+(\.\d+)?$/);
    expect(PRIVACY_POLICY_LAST_UPDATED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Number.isNaN(Date.parse(`${PRIVACY_POLICY_LAST_UPDATED}T00:00:00Z`))).toBe(false);
    expect(PRIVACY_POLICY_URL).toBe('https://lotties.app/privacy');
  });
});
