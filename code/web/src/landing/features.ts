/** The six things the app does, in order: the key in the `landing` catalog and its illustration. */
export const FEATURES = [
  { key: 'log', illustration: 'diaper', category: 'diaper' },
  { key: 'today', illustration: 'night', category: 'sleep' },
  { key: 'share', illustration: 'nursing', category: 'feeding' },
  { key: 'predict', illustration: 'woke_up', category: 'sleep' },
  { key: 'health', illustration: 'medication', category: 'health' },
  { key: 'data', illustration: 'custom', category: 'custom' },
] as const;

export const STEPS = ['one', 'two', 'three'] as const;

/** The paragraphs of "Why we made Lotties": keys in the `landing` catalog, `story.<key>`. */
export const STORY = ['one', 'two', 'three', 'four'] as const;

/** Content width of the landing page in px. */
export const PAGE_WIDTH = 960;

/**
 * The "See it in action" screenshots, in order: the id is the file stem in `public/showcase/`
 * (`<id>-<scheme>-<lang>.webp`, made by tests/e2e/showcase, docs/showcase-media.md) and the key in
 * the `landing` catalog (`showcase.screens.<id>`). `dark` marks a screenshot that also exists in dark.
 */
export const SHOWCASE_SCREENS = [
  { id: 'now', dark: true },
  { id: 'log-feed', dark: false },
  { id: 'log-sleep', dark: false },
  { id: 'log-diaper', dark: false },
  { id: 'bottle-followup', dark: false },
  { id: 'insights', dark: false },
  { id: 'rhythm', dark: true },
  { id: 'vaccines', dark: false },
  { id: 'sharing', dark: false },
  { id: 'doctor', dark: false },
  { id: 'data-location', dark: true },
] as const;

/** Pixel size of the screenshots (a 390x844 phone at 2x). */
export const SHOWCASE_SIZE = { width: 780, height: 1688 } as const;
