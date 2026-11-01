import type { EventPayload } from '../db/models';
import { isPaused, readPause } from '../timers/pauseMath';
import { getOwn } from '../util/ownProperty';
import { readSegments } from './bottleSegments';

/** How many times a bottle was paused and how much milk was left at each pause (the levels the parent gave). */
export interface BottlePauseSummary {
  count: number;
  /** Known levels (ml) at each pause, in time order; a pause whose level was not given is left out. */
  leftMl: number[];
}

/**
 * The pauses of a bottle feeding, or `null` for any other event or a bottle that never paused. A pause that is open now
 * counts. The level at a pause is the level where the drinking stretch before it ended (`segments`).
 */
export function bottlePauseSummary(
  event: { payload: Readonly<EventPayload>; endedAt: string | null },
): BottlePauseSummary | null {
  if (getOwn(event.payload, 'method') !== 'bottle') return null;
  const count = readPause(event.payload).count + (isPaused(event) ? 1 : 0);
  if (count === 0) return null;
  const leftMl = readSegments(event.payload)
    .slice(0, count)
    .map((segment) => segment.leftMl)
    .filter((level): level is number => level !== null);
  return { count, leftMl };
}
