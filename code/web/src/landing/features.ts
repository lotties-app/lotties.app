/** The six things the app does, in order: the key in the `landing` catalog and its illustration. */
export const FEATURES = [
  { key: 'log', illustration: 'diaper', category: 'diaper' },
  { key: 'offline', illustration: 'night', category: 'sleep' },
  { key: 'share', illustration: 'nursing', category: 'feeding' },
  { key: 'predict', illustration: 'woke_up', category: 'sleep' },
  { key: 'history', illustration: 'medication', category: 'health' },
  { key: 'data', illustration: 'custom', category: 'custom' },
] as const;

export const STEPS = ['one', 'two', 'three'] as const;

/** Content width of the landing page in px. */
export const PAGE_WIDTH = 960;
