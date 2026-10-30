import type { BabyEvent, EventType } from '../db/models';
import { drunkMl } from '../events/bottleAmounts';
import { payloadString, typeIdsForKey } from '../now/eventFacts';
import { effectiveDurationMs } from '../timers/pauseMath';
import { completedDaysWithData, dayKeyOf, mean, type LocalDay } from './days';
import { DEFAULT_FEED_GAP_MS, feedGapLimitAt, type FeedGapContext } from './feedGapLimit';

/*
 * Feeding insights, pure: feeds per local day (by the day a feed started), the average gap between
 * feeds, and the average bottle amount and bottle time where those were logged. Durations are
 * effective (pauses excluded); running feeds have no duration yet.
 */

/**
 * A longer gap means a feed was probably not logged, so it is left out of the average. The
 * default: from 6 months the published norms may raise it (feedGapLimit.ts).
 */
export const MAX_FEED_GAP_MS = DEFAULT_FEED_GAP_MS;

export interface FeedDay {
  key: string;
  start: Date;
  feeds: number;
  /** Sum of the logged bottle amounts (ml) that day; breast and solid feeds do not count. */
  bottleMl: number;
}

export interface FeedingSummary {
  /** Average feeds a day over the finished days with feeds. */
  perDay: number | null;
  avgGapMs: number | null;
  avgBottleMl: number | null;
  avgBottleMs: number | null;
  /** Average bottle ml a day, over the finished days that have bottle amounts. */
  mlPerDay: number | null;
}

function feedsIn(
  events: readonly BabyEvent[],
  types: readonly EventType[],
  days: readonly LocalDay[],
  now: Date,
): BabyEvent[] {
  const ids = typeIdsForKey(types, 'feeding');
  const from = days[0]?.start.toISOString() ?? '';
  const to = now.toISOString();
  return events
    .filter(
      (e) => e.deletedAt === null && ids.has(e.typeId) && e.startedAt >= from && e.startedAt <= to,
    )
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
}

/**
 * The amount of a bottle feed the baby drank (ml; a bottle without a drunk amount was fully
 * drunk), or `undefined` (no amount, or not a bottle).
 */
export function bottleAmount(feed: BabyEvent): number | undefined {
  if (payloadString(feed, 'method') !== 'bottle') return undefined;
  const ml = drunkMl(feed.payload);
  return ml !== undefined && ml > 0 ? ml : undefined;
}

export function feedsByDay(
  events: readonly BabyEvent[],
  types: readonly EventType[],
  days: readonly LocalDay[],
  now: Date,
): FeedDay[] {
  const byKey = new Map(
    days.map((day) => [day.key, { key: day.key, start: day.start, feeds: 0, bottleMl: 0 }]),
  );
  for (const feed of feedsIn(events, types, days, now)) {
    const day = byKey.get(dayKeyOf(feed.startedAt));
    if (!day) continue;
    day.feeds += 1;
    day.bottleMl += bottleAmount(feed) ?? 0;
  }
  return [...byKey.values()];
}

/**
 * Gaps between consecutive feed starts, up to `maxGapAt(start of the gap)` (default
 * `MAX_FEED_GAP_MS`).
 */
export function feedGaps(
  feeds: readonly BabyEvent[],
  maxGapAt: (startMs: number) => number = () => MAX_FEED_GAP_MS,
): number[] {
  const gaps: number[] = [];
  for (let index = 1; index < feeds.length; index++) {
    const start = Date.parse(feeds[index - 1].startedAt);
    const gap = Date.parse(feeds[index].startedAt) - start;
    if (gap > 0 && gap <= maxGapAt(start)) gaps.push(gap);
  }
  return gaps;
}

export function feedingSummary(
  events: readonly BabyEvent[],
  types: readonly EventType[],
  days: readonly LocalDay[],
  now: Date,
  todayKey: string,
  /** The birth date and age norms for the age-aware gap cut-off; 8 hours without them. */
  gapContext?: FeedGapContext,
): FeedingSummary {
  const feeds = feedsIn(events, types, days, now);
  const byDay = feedsByDay(events, types, days, now);
  const perDay = completedDaysWithData(byDay, (d) => d.feeds > 0, todayKey);
  const mlDays = completedDaysWithData(byDay, (d) => d.bottleMl > 0, todayKey);
  const bottles = feeds.filter((e) => payloadString(e, 'method') === 'bottle');
  const amounts = bottles.map(bottleAmount).filter((ml): ml is number => ml !== undefined);
  const durations = bottles
    .filter((e) => e.endedAt !== null)
    .map((e) => effectiveDurationMs(e, now))
    .filter((ms) => ms > 0);
  return {
    perDay: mean(perDay.map((d) => d.feeds)),
    avgGapMs: mean(feedGaps(feeds, feedGapLimitAt(gapContext))),
    avgBottleMl: mean(amounts),
    avgBottleMs: mean(durations),
    mlPerDay: mean(mlDays.map((d) => d.bottleMl)),
  };
}
