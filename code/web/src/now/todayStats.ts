import type { BabyEvent, EventType } from '../db/models';
import { drunkMl, preparedMl } from '../events/bottleAmounts';
import { getOwn } from '../util/ownProperty';
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
  /**
   * Milk of the finished bottles today, or `null` when none has an amount. One value for both the
   * Feeds note (`drunkMl`) and the "Milk today" card, so the two always agree.
   */
  milk: MilkToday | null;
  diapers: number;
}

/**
 * What the finished bottles of today held (ml). `drunkMl` follows the drunk-amount rule (the drunk
 * amount capped at the prepared one, else all of it); `preparedMl` is `amount_ml`, or the drunk
 * amount for a bottle that has only that one, so `drunkMl <= preparedMl` always holds.
 */
export interface MilkToday {
  drunkMl: number;
  preparedMl: number;
}

const startOfLocalDay = (now: Date) =>
  new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

/** Effective minutes: pauses are not sleep (docs/design/SYNTHESIS.md section 6). */
const lengthMinutes = (event: BabyEvent, now: Date) =>
  Math.round(effectiveDurationSeconds(event, now) / 60);

/**
 * Drunk and prepared milk of the finished bottles, `null` when none has an amount. A running bottle
 * is left out (its amount is only what was prepared); a bottle with nothing drunk of a prepared
 * amount counts (prepared, not drunk). Breast, solids and pumping have no `method: bottle`. The
 * Insights Day summary reads its feeding headline through this same rule (daySummary/daySummaryModel).
 */
export function milkFromBottles(feeds: readonly BabyEvent[]): MilkToday | null {
  let bottles = 0;
  const milk: MilkToday = { drunkMl: 0, preparedMl: 0 };
  for (const feed of feeds) {
    if (feed.endedAt === null || getOwn(feed.payload, 'method') !== 'bottle') continue;
    const drunk = drunkMl(feed.payload);
    if (drunk === undefined) continue;
    const prepared = preparedMl(feed.payload) ?? drunk;
    if (prepared <= 0) continue;
    bottles += 1;
    milk.drunkMl += drunk;
    milk.preparedMl += prepared;
  }
  return bottles > 0 ? milk : null;
}

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
  const feeds = today.filter((e) => feedIds.has(e.typeId));
  return {
    lastNightMinutes: night ? lengthMinutes(night, now) : null,
    naps: {
      count: naps.length,
      minutes: naps.reduce((sum, e) => sum + lengthMinutes(e, now), 0),
    },
    feeds: feeds.length,
    milk: milkFromBottles(feeds),
    diapers: today.filter((e) => diaperIds.has(e.typeId)).length,
  };
}

/** Whether the strip has anything to show. */
export function hasTodayData(stats: TodayStats): boolean {
  return (
    stats.lastNightMinutes !== null || stats.naps.count > 0 || stats.feeds > 0 || stats.diapers > 0
  );
}
