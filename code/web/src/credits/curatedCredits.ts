import curated from './curated.json';

/**
 * Credits that are not code packages: open data, public services, platforms, fonts, icons and our own
 * artwork. Hand-written in `curated.json` (names, links and licenses are facts and stay as published);
 * the sentence about what each is used for lives in the catalog under `credits.curated.<id>` (en and
 * pt-BR). The generator (scripts/generate-credits.mjs) writes the same list into CREDITS.md.
 */
export const CURATED_KINDS = ['data', 'service', 'platform', 'asset'] as const;
export type CuratedKind = (typeof CURATED_KINDS)[number];

/** The ids of src/i18n/locales/en/credits.json `credits.curated`: a new item needs its sentence there. */
export type CuratedId =
  keyof (typeof import('../i18n/locales/en/credits.json'))['credits']['curated'];

export interface CuratedCredit {
  id: CuratedId;
  kind: CuratedKind;
  name: string;
  url: string;
  license: string;
  licenseUrl: string | null;
}

export const CURATED_CREDITS: readonly CuratedCredit[] = curated.items as CuratedCredit[];
export const SOURCE_REPOSITORY: string = curated.repository;
export const PUBLIC_CREDITS_URL: string = curated.publicUrl;
