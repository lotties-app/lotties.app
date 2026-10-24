import type { CategoryName } from '../../theme/tokens';
import type { IconName } from '../../ui/icons';
import type { UpcomingConfidence, UpcomingItem, UpcomingKind } from '../upcoming';

/*
 * How a "next up" marker looks (docs/DESIGN.md "Now: next up on the ring"): the event's own
 * pictogram from the icon kit in its category tint (bottle, diaper, poo, the belly pain face, the
 * fussy face, the pill), on a small stamp with a dashed edge like every estimate on the chart,
 * fainter with lower confidence. A cluster is a neutral stamp with its count.
 */

export interface UpcomingVisual {
  icon: IconName;
  category: CategoryName;
}

const VISUAL: Record<UpcomingKind, UpcomingVisual> = {
  feed: { icon: 'bottle', category: 'feeding' },
  diaperWet: { icon: 'diaper', category: 'diaper' },
  diaperDirty: { icon: 'poo', category: 'diaper' },
  bellyPain: { icon: 'mood-sad', category: 'health' },
  fussy: { icon: 'mood-cry', category: 'care' },
  medicine: { icon: 'pill', category: 'health' },
};

/** The pictogram and tint of a kind of item. */
export const kindVisual = (kind: UpcomingKind): UpcomingVisual => VISUAL[kind];

/** The pictogram and tint of an item (a nursing feed shows the breast option's heart). */
export function upcomingVisual(item: Pick<UpcomingItem, 'kind' | 'basis'>): UpcomingVisual {
  if (item.kind === 'feed' && item.basis.kind === 'feed' && item.basis.method === 'breast') {
    return { icon: 'heart', category: 'feeding' };
  }
  return VISUAL[item.kind];
}

/** Strength of a marker by confidence: an estimate with less behind it is drawn fainter. */
export const CONFIDENCE_STRENGTH: Record<UpcomingConfidence, number> = {
  high: 1,
  medium: 0.8,
  low: 0.55,
};

/** The dash of the stamp's edge and of a window's arc (the estimates' language). */
export const ESTIMATE_DASH = '2 1.5';
