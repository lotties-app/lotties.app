import type { BabyEvent, EventPayload } from '../db/models';
import { effectiveDurationSeconds } from '../timers/pauseMath';
import { getOwn } from '../util/ownProperty';
import { DRUNK_KEY, ENDED_BY_KEY, ENDED_BY_SLEEP, drunkMl, preparedMl } from './bottleAmounts';
import { readSegments, segmentDrunkMl } from './bottleSegments';

/*
 * What her own bottles say (docs/design/20-feeding-amounts.md section 5): how fast she drinks
 * (ml per minute of drinking, pauses excluded), how much she usually drinks at this part of the
 * day, and whether the last feed was cut short. Pure, offline, from the local log only; every
 * figure needs a few bottles and is `null` otherwise (nothing is invented). Facts, never advice.
 */

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** Bottles of this many days count. */
export const PATTERN_DAYS = 14;
/** At least this many bottles behind a figure. */
export const MIN_BOTTLES = 3;
/** A bottle shorter than this (drinking time) says nothing about pace (a Feed-tray bottle is 0). */
const MIN_TIMED_SECONDS = 60;
/** Paces outside this range (ml per minute) are typing slips, left out. */
const PACE_RANGE = { min: 1, max: 60 } as const;
/** Night part of the day, local hours [from, until). */
const NIGHT_FROM_HOUR = 19;
const NIGHT_UNTIL_HOUR = 7;

/** A partial feed: drunk below this share of her usual amount. */
export const PARTIAL_SHARE = 0.7;
/** The next feed comes earlier by at most this share of her usual gap. */
export const MAX_TOP_UP_SHARE = 0.3;
/** How much of the missing share moves the next feed (0.5: half of what was not drunk). */
const TOP_UP_WEIGHT = 0.5;

const isBottle = (event: BabyEvent, feedingTypeId?: string) =>
  event.deletedAt === null &&
  (feedingTypeId === undefined || event.typeId === feedingTypeId) &&
  getOwn(event.payload, 'method') === 'bottle';

/**
 * A bottle a sleep stopped and nobody said how much was drunk: its amount is unknown (the totals
 * still count it as fully drunk, the old rule; patterns leave it out instead).
 */
export function hasUnknownFinish(payload: Readonly<EventPayload>): boolean {
  if (getOwn(payload, ENDED_BY_KEY) !== ENDED_BY_SLEEP) return false;
  if (typeof getOwn(payload, DRUNK_KEY) === 'number') return false;
  const segments = readSegments(payload);
  return segments.length === 0 || segments[segments.length - 1].leftMl === null;
}

/** What she drank from this bottle (ml), or `null` when unknown (see `hasUnknownFinish`). */
export function knownDrunkMl(event: Pick<BabyEvent, 'payload'>): number | null {
  if (hasUnknownFinish(event.payload)) return null;
  return drunkMl(event.payload) ?? null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Finished bottles of the last `PATTERN_DAYS` before `now`, newest first. */
function recentFinished(events: readonly BabyEvent[], now: Date, feedingTypeId?: string) {
  const to = now.getTime();
  const from = to - PATTERN_DAYS * DAY_MS;
  return events
    .filter((e) => isBottle(e, feedingTypeId) && e.endedAt !== null)
    .filter((e) => {
      const start = Date.parse(e.startedAt);
      return start >= from && start <= to;
    })
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export interface BottlePace {
  /** Median ml per minute of drinking (pauses excluded). */
  mlPerMinute: number;
  /** Bottles behind it. */
  sampleCount: number;
  /** Median ml of one drinking stretch (between pauses), when at least 3 are known. */
  typicalStretchMl: number | null;
}

/**
 * Her drinking pace from timed bottles with a known drunk amount: median of drunk / drinking
 * minutes, at least `MIN_BOTTLES`; `null` otherwise.
 */
export function bottlePace(
  events: readonly BabyEvent[],
  now: Date,
  feedingTypeId?: string,
): BottlePace | null {
  const bottles = recentFinished(events, now, feedingTypeId);
  const paces: number[] = [];
  const stretches: number[] = [];
  for (const bottle of bottles) {
    const drunk = knownDrunkMl(bottle);
    const seconds = effectiveDurationSeconds(bottle, now);
    if (drunk !== null && drunk > 0 && seconds >= MIN_TIMED_SECONDS) {
      const pace = drunk / (seconds / 60);
      if (pace >= PACE_RANGE.min && pace <= PACE_RANGE.max) paces.push(pace);
    }
    for (const segment of readSegments(bottle.payload)) {
      const ml = segmentDrunkMl(segment);
      if (ml !== null && ml > 0) stretches.push(ml);
    }
  }
  const pace = median(paces);
  if (pace === null || paces.length < MIN_BOTTLES) return null;
  return {
    mlPerMinute: pace,
    sampleCount: paces.length,
    typicalStretchMl: stretches.length >= MIN_BOTTLES ? median(stretches) : null,
  };
}

/** Bounds of the bottle duration estimate (minutes). */
const BOTTLE_TARGET = { min: 3, max: 90 } as const;

/**
 * About how long (drinking minutes) this bottle takes at her pace: the prepared amount (else her
 * usual amount) over her pace, rounded to the minute; `null` without a pace or an amount.
 */
export function expectedBottleMinutes(
  bottle: Pick<BabyEvent, 'payload'>,
  pace: BottlePace | null,
  usualMl: number | null = null,
): number | null {
  if (!pace) return null;
  const amount = preparedMl(bottle.payload) ?? usualMl;
  if (amount === null || amount === undefined || amount <= 0) return null;
  const minutes = Math.round(amount / pace.mlPerMinute);
  return minutes >= BOTTLE_TARGET.min && minutes <= BOTTLE_TARGET.max ? minutes : null;
}

const isNight = (iso: string) => {
  const hour = new Date(iso).getHours();
  return hour >= NIGHT_FROM_HOUR || hour < NIGHT_UNTIL_HOUR;
};

/**
 * Her usual drunk amount (ml) for a bottle at `at`: the median of her known drunk amounts in the
 * same part of the day (day 07-19, night 19-07, local), at least `MIN_BOTTLES`; else of all of
 * them; `null` with fewer. `excludeId`: a bottle left out (the one being judged).
 */
export function usualDrunkMl(
  events: readonly BabyEvent[],
  at: string,
  now: Date,
  feedingTypeId?: string,
  excludeId?: string,
): number | null {
  const known = recentFinished(events, now, feedingTypeId)
    .filter((e) => e.id !== excludeId)
    .map((e) => ({ night: isNight(e.startedAt), ml: knownDrunkMl(e) }))
    .filter((x): x is { night: boolean; ml: number } => x.ml !== null && x.ml > 0);
  const night = isNight(at);
  const samePart = known.filter((x) => x.night === night).map((x) => x.ml);
  if (samePart.length >= MIN_BOTTLES) return median(samePart);
  return known.length >= MIN_BOTTLES ? median(known.map((x) => x.ml)) : null;
}

export interface TopUp {
  /** Share of her usual gap the next feed comes earlier (0 < share <= `MAX_TOP_UP_SHARE`). */
  share: number;
  /** What she drank at the last feed and what she usually drinks then (ml). */
  drunkMl: number;
  usualMl: number;
  /** A sleep stopped that feed. */
  endedBySleep: boolean;
}

/**
 * "A top-up is likely": the latest finished feed is a bottle whose known drunk amount is under
 * `PARTIAL_SHARE` of her usual amount at that part of the day (an interrupted or partly drunk
 * bottle; one a sleep stopped counts once its amount is known). The next feed is then expected
 * earlier by half of the missing share, at most `MAX_TOP_UP_SHARE` of her usual gap. `null`: no
 * partial feed, unknown amount, not enough history, a nursing or solid feed last, or a feed
 * running now (old behaviour). `feeds`: the baby's events of the feeding type.
 */
export function topUpAdjustment(feeds: readonly BabyEvent[], now: Date): TopUp | null {
  const last = feeds
    .filter((e) => e.deletedAt === null && Date.parse(e.startedAt) <= now.getTime())
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  if (!last || last.endedAt === null || getOwn(last.payload, 'method') !== 'bottle') return null;
  const drunk = knownDrunkMl(last);
  if (drunk === null) return null;
  const usual = usualDrunkMl(feeds, last.startedAt, now, undefined, last.id);
  if (usual === null || usual <= 0 || drunk >= usual * PARTIAL_SHARE) return null;
  const share = Math.min(MAX_TOP_UP_SHARE, (1 - drunk / usual) * TOP_UP_WEIGHT);
  return {
    share: Math.round(share * 1000) / 1000,
    drunkMl: drunk,
    usualMl: usual,
    endedBySleep: getOwn(last.payload, ENDED_BY_KEY) === ENDED_BY_SLEEP,
  };
}

/** Her usual gap between feeds (minutes) shortened by a top-up (unchanged without one). */
export function adjustedFeedGap(usualGapMinutes: number, topUp: TopUp | null): number {
  return topUp ? Math.round(usualGapMinutes * (1 - topUp.share)) : usualGapMinutes;
}
