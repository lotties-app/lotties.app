/*
 * Pixel geometry of the Day ribbon, pure and testable: the hour grid, merging marks that would
 * overlap at the measured width into one counted mark, whether a duration label fits inside a
 * sleep stretch, and arrow-key movement between the ribbon's buttons. Positions stay fractions of
 * the day (0 to 1) so the CSS can place them in percentages; only the decisions need pixels.
 */

/** Width used before the container is measured (a phone column); also the jsdom width. */
export const FALLBACK_WIDTH_PX = 358;

/** Diameter of an event mark. */
export const MARK_SIZE_PX = 20;

/** Marks closer than this (centre to centre) merge into one counted mark. */
export const MIN_MARK_GAP_PX = MARK_SIZE_PX + 3;

export interface HourTick {
  hour: number;
  /** Fraction of the day. */
  at: number;
  /** 06, 12 and 18: a stronger tick and a faint line through the lanes. */
  major: boolean;
  /** Every third hour carries a label (00, 03 ... 21). */
  labelled: boolean;
}

/** The ticks of the hour axis, 00 to 23 (24 is the right edge, not drawn). */
export function hourTicks(): HourTick[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    at: hour / 24,
    major: hour === 6 || hour === 12 || hour === 18,
    labelled: hour % 3 === 0,
  }));
}

/** Marks drawn as one: a single mark or several close ones (a count). */
export interface MarkCluster<T> {
  /** Stable key: the ids of the members. */
  key: string;
  items: T[];
  /** Where it is drawn: halfway between its first and last member. */
  at: number;
}

/**
 * Merges marks (sorted or not) whose centres would be closer than `minGapPx` at `widthPx`,
 * closest neighbours first, until every pair of drawn marks is at least that far apart.
 */
export function clusterMarks<T extends { id: string; at: number }>(
  marks: readonly T[],
  widthPx: number,
  minGapPx: number = MIN_MARK_GAP_PX,
): MarkCluster<T>[] {
  const width = widthPx > 0 ? widthPx : FALLBACK_WIDTH_PX;
  const gap = minGapPx / width;
  const groups = [...marks]
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
    .map((mark) => ({ items: [mark], at: mark.at }));
  for (;;) {
    let closest = -1;
    let distance = gap;
    for (let index = 0; index < groups.length - 1; index++) {
      const between = groups[index + 1].at - groups[index].at;
      if (between < distance) {
        distance = between;
        closest = index;
      }
    }
    if (closest < 0) break;
    const items = [...groups[closest].items, ...groups[closest + 1].items];
    groups.splice(closest, 2, { items, at: (items[0].at + items[items.length - 1].at) / 2 });
  }
  return groups.map((group) => ({
    key: group.items.map((item) => item.id).join('|'),
    items: group.items,
    at: group.at,
  }));
}

/** Rough width of a short caption at 12px in tabular figures (no layout read needed). */
export const textWidthPx = (text: string, charPx = 6.6) => text.length * charPx;

/** Whether `text` fits inside a stretch `fraction` of the day wide, with some breathing room. */
export function labelFits(text: string, fraction: number, widthPx: number, paddingPx = 12) {
  const width = widthPx > 0 ? widthPx : FALLBACK_WIDTH_PX;
  return fraction * width >= textWidthPx(text) + paddingPx;
}

/**
 * Index the focus moves to for an arrow, Home or End key among `count` buttons in time order, or
 * `null` when the key is not a navigation key. Stops at the ends (no wrap).
 */
export function nextFocusIndex(current: number, count: number, key: string): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return Math.min(count - 1, current + 1);
    case 'ArrowLeft':
    case 'ArrowUp':
      return Math.max(0, current - 1);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
