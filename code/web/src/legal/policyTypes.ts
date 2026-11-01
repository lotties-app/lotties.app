import type { Locale } from '../i18n/config';

/*
 * The shape of the privacy policy content (docs/design/33-privacy-audit.md). The text itself lives in
 * privacy.en.ts and privacy.pt-BR.ts; the page renders it (PrivacyContent.tsx), so there is one source of
 * truth per language and no markdown runtime.
 *
 * Inline text is a plain string with two small conventions (see inlineText.ts):
 * - `[label](href)`: a link. `href` is an in-app path (`/settings#account`), an anchor of this page
 *   (`#privacy-rights`) or a web address (`https://...`, opens outside the app).
 * - `{name}`: a value filled in at render time: `{controller}`, `{contact}`, `{dpo}`, `{version}`,
 *   `{lastUpdated}`; inside a link's href also `{issuesUrl}` and `{advisoryUrl}`.
 */
export type Inline = string;

export interface Paragraph {
  kind: 'p';
  text: Inline;
}

export interface BulletList {
  kind: 'list';
  items: readonly Inline[];
}

/** A highlighted paragraph (an important note inside a section). */
export interface Note {
  kind: 'note';
  text: Inline;
}

export interface TableRow {
  /** Stable id (the same in every language; tests compare them with dataFlows.ts). */
  id: string;
  /** The first cell is the row header. */
  cells: readonly Inline[];
}

export interface Table {
  kind: 'table';
  /**
   * `data` (what we collect), `recipients` (who receives data) or `planned` (what a feature that is not
   * built would use: nothing in it is collected; dataFlows.ts `PLANNED_FLOWS`).
   */
  id: 'data' | 'recipients' | 'planned';
  caption: Inline;
  columns: readonly string[];
  rows: readonly TableRow[];
}

export type Block = Paragraph | BulletList | Note | Table;

export interface Subsection {
  id: string;
  title: string;
  blocks: readonly Block[];
}

export interface PolicySection {
  id: PolicySectionId;
  title: string;
  blocks: readonly Block[];
  subsections?: readonly Subsection[];
}

/** The ids of the sections, in page order; each is an anchor (`#privacy-<id>`). */
export const POLICY_SECTION_IDS = [
  'controller',
  'data',
  'other-people',
  'legal-bases',
  'sharing',
  'children',
  'rights',
  'retention',
  'security',
  'transfers',
  'device-storage',
  'not-medical',
  'community-insights',
  'changes',
  'contact',
] as const;
export type PolicySectionId = (typeof POLICY_SECTION_IDS)[number];

export interface SummaryGroup {
  title: string;
  items: readonly Inline[];
}

/** Text used when the owner has not set a contact value at build time (privacyConfig.ts). */
export interface PolicyFallbacks {
  controller: string;
  contact: Inline;
  dpo: Inline;
}

export interface PolicyDocument {
  locale: Locale;
  /** The short box at the top: what we collect, what we do not do, the key rights. */
  summary: {
    title: string;
    groups: readonly [SummaryGroup, SummaryGroup, SummaryGroup];
  };
  sections: readonly PolicySection[];
  fallbacks: PolicyFallbacks;
}
