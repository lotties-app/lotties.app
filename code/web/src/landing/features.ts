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
