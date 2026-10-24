/*
 * Where the "next up" markers sit on their lane (the inner circle of the ring in degrees, the lane
 * under the ruler in percent), pure and testable. Markers closer than `minGap` to the previous one
 * would overlap: a run of more than three such markers becomes one cluster marker; everything else
 * is then pushed apart to at least `minGap`, moving each marker as little as possible (least
 * squares, pool-adjacent-violators) and keeping all of them inside the lane.
 */

import {
  upcomingClusterDetail,
  upcomingDetail,
  type UpcomingClusterDetail,
  type UpcomingDetail,
} from './rhythmDetails';
import type { UpcomingItem } from './upcoming';

export interface LaneInput {
  key: string;
  /** The marker's own place (degrees or percent). */
  pos: number;
}

export type LaneSlot =
  { kind: 'single'; key: string; pos: number } | { kind: 'cluster'; keys: string[]; pos: number };

/** At most this many overlapping markers are spread apart; more become a cluster. */
export const MAX_SPREAD = 3;

/**
 * Places `wanted` (sorted) at least `gap` apart inside `[lo, hi]`, as close as possible to where
 * they want to be: isotonic regression of `wanted[i] - i * gap`, clipped to the bounds. When the
 * lane is too short for the gap the markers share it evenly.
 */
export function spreadApart(
  wanted: readonly number[],
  gap: number,
  [lo, hi]: readonly [number, number],
): number[] {
  const n = wanted.length;
  if (n === 0) return [];
  const step = n > 1 ? Math.min(gap, Math.max(0, hi - lo) / (n - 1)) : gap;
  const blocks: { sum: number; count: number }[] = [];
  wanted.forEach((pos, index) => {
    blocks.push({ sum: pos - index * step, count: 1 });
    while (blocks.length > 1) {
      const last = blocks[blocks.length - 1];
      const before = blocks[blocks.length - 2];
      if (before.sum / before.count <= last.sum / last.count) break;
      blocks.splice(-2, 2, { sum: before.sum + last.sum, count: before.count + last.count });
    }
  });
  const top = hi - (n - 1) * step;
  return blocks
    .flatMap((block) => {
      const z = Math.min(top, Math.max(lo, block.sum / block.count));
      return Array.from({ length: block.count }, () => z);
    })
    .map((z, index) => z + index * step);
}

export function layoutLane(
  items: readonly LaneInput[],
  minGap: number,
  bounds: readonly [number, number],
): LaneSlot[] {
  const sorted = [...items].sort((a, b) => a.pos - b.pos || a.key.localeCompare(b.key));
  // Runs of markers each overlapping the one before it.
  const runs: LaneInput[][] = [];
  for (const item of sorted) {
    const run = runs[runs.length - 1];
    const last = run?.[run.length - 1];
    if (run && last && item.pos - last.pos < minGap) run.push(item);
    else runs.push([item]);
  }
  const slots: LaneSlot[] = runs.flatMap((run): LaneSlot[] =>
    run.length > MAX_SPREAD
      ? [
          {
            kind: 'cluster',
            keys: run.map((item) => item.key),
            pos: run.reduce((sum, item) => sum + item.pos, 0) / run.length,
          },
        ]
      : run.map((item) => ({ kind: 'single', key: item.key, pos: item.pos })),
  );
  const places = spreadApart(
    slots.map((slot) => slot.pos),
    minGap,
    bounds,
  );
  return slots.map((slot, index) => ({ ...slot, pos: places[index] }));
}

/** One marker of the lane with its details: an item, or a cluster of items. */
export interface LaneMark {
  detail: UpcomingDetail | UpcomingClusterDetail;
  /** Where it is drawn (degrees or percent). */
  pos: number;
  items: UpcomingItem[];
}

/**
 * The lane's markers for `items` (the layers shown), placed by `posOf` and `layoutLane`, and the
 * marker key that draws each item (its own or its cluster's), for the "Next up" rows.
 */
export function laneMarks(
  items: readonly UpcomingItem[],
  posOf: (item: UpcomingItem) => number,
  minGap: number,
  bounds: readonly [number, number],
): { marks: LaneMark[]; markOf: Map<string, string> } {
  const byKey = new Map(items.map((item) => [item.key, item]));
  const slots = layoutLane(
    items.map((item) => ({ key: item.key, pos: posOf(item) })),
    minGap,
    bounds,
  );
  const marks: LaneMark[] = [];
  const markOf = new Map<string, string>();
  for (const slot of slots) {
    const members = (slot.kind === 'single' ? [slot.key] : slot.keys).map(
      (key) => byKey.get(key) as UpcomingItem,
    );
    const detail =
      slot.kind === 'single' ? upcomingDetail(members[0]) : upcomingClusterDetail(members);
    for (const item of members) markOf.set(item.key, detail.key);
    marks.push({ detail, pos: slot.pos, items: members });
  }
  return { marks, markOf };
}
