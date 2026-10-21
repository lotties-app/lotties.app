import type { CategoryName } from '../theme/tokens';
import type { IconName } from '../ui/icons';

/** The icon of each category (filter rows). */
export const CATEGORY_ICON: Readonly<Record<CategoryName, IconName>> = {
  sleep: 'moon',
  feeding: 'bottle',
  diaper: 'diaper',
  health: 'pill',
  care: 'bath',
  activity: 'mood-kid',
  nightWaking: 'eye',
  custom: 'star',
};
