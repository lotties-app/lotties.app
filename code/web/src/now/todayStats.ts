import type { BabyEvent, EventType } from '../db/models';
import { effectiveDurationSeconds } from '../timers/pauseMath';
import { MINUTE_MS, pastLiveEvents, sleepSessionKind, typeIdsForKey } from './eventFacts';

/*
 * The "Today" strip of the Now screen: a few counts from the events already loaded (the last three
 * days). Pure and language-free; a value with no data is `null`/0 and the strip leaves it out.
 */

export interface TodayStats {
  /** Length of the latest night sleep that ended in the last 24 hours (minutes), if any. */
  lastNightMinutes: number | null;
  naps: { count: number; minutes: number };
  feeds: number;
  diapers: number;
}

const startOfLocalDay = (now: Date) =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

/** Effective minutes: pauses are not sleep (docs/design/SYNTHESIS.md section 6). */
const lengthMinutes = (event: BabyEvent, now: Date) =>
  Math.round(effectiveDurationSeconds(event, now) / 60);

export function todayStats(
  events: readonly BabyEvent[],
  types: readonly EventType[],
  now: Date,
): TodayStats {
  const past = pastLiveEvents(events, now);
  const dayStart = startOfLocalDay(now);
  const sleepIds = typeIdsForKey(types, 'sleep');
  const feedIds = typeIdsForKey(types, 'feeding');
  const diaperIds = typeIdsForKey(types, 'diaper');
  const today = past.filter((e) => Date.parse(e.startedAt) >= dayStart);

  const sleeps = past.filter((e) => sleepIds.has(e.typeId));
  const dayAgo = now.getTime() - 24 * 60 * MINUTE_MS;
  const night = sleeps
    .filter(
      (e) =>
        sleepSessionKind(e) === 'night' && e.endedAt !== null && Date.parse(e.endedAt) >= dayAgo,
    )
    .sort((a, b) => (b.endedAt as string).localeCompare(a.endedAt as string))[0];

  const naps = today.filter((e) => sleepIds.has(e.typeId) && sleepSessionKind(e) === 'nap');
  return {
    lastNightMinutes: night ? lengthMinutes(night, now) : null,
    naps: {
      count: naps.length,
      minutes: naps.reduce((sum, e) => sum + lengthMinutes(e, now), 0),
    },
    feeds: today.filter((e) => feedIds.has(e.typeId)).length,
    diapers: today.filter((e) => diaperIds.has(e.typeId)).length,
  };
}

/** Whether the strip has anything to show. */
export function hasTodayData(stats: TodayStats): boolean {
  return (
    stats.lastNightMinutes !== null || stats.naps.count > 0 || stats.feeds > 0 || stats.diapers > 0
  );
}
