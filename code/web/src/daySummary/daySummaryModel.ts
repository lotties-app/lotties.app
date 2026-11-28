import { addDays, dayValue, startOfDay } from '../day/dayModel';
import type { BabyEvent, EventType } from '../db/models';
import {
  MINUTE_MS,
  payloadNumber,
  payloadString,
  payloadValue,
  pastLiveEvents,
  sleepSessionKind,
} from '../now/eventFacts';
import { deriveNowState } from '../now/nowState';
import { nursingElapsed } from '../now/nursing';
import { milkFromBottles, type MilkToday } from '../now/todayStats';
import { effectiveDurationMs, effectiveMsInWindow } from '../timers/pauseMath';

/*
 * The Day summary of Insights (docs/DESIGN.md "Day summary"): how one local calendar day of the
 * selected baby is going, worked out from her local events only. Pure and language-free; the view
 * formats every number. Facts only: the "usual" values are the same baby's own recent days, never
 * a norm, another baby or a judgement.
 *
 * Day boundaries come from `Date` calendar setters (`startOfDay` / `addDays`), so a day is 23 or 25
 * hours long across a DST change. While the viewed day is today everything is measured up to now;
 * a past day is measured whole.
 *
 * Definitions:
 * - Sleep: the night is the latest night session that ENDED on the day (counted whole, it may have
 *   started the evening before); naps are the nap sessions that STARTED on the day (a running one
 *   counts up to now); total = night + naps. Pauses are not sleep (effective durations). A night
 *   that is still running is not counted yet: today says "asleep for" instead.
 * - Feeding: the feeding events that started on the day (breast, bottle and solids, as the Now
 *   Feeds tile counts them; pumping is its own event type and never counts); milk through the Now
 *   "Milk today" rule (`milkFromBottles`: finished bottles only).
 * - Diapers: wet = WET + MIXED, dirty = DIRTY + MIXED (a mixed one counts as both).
 * - Crying: fussy spells that started on the day, with their effective length when timed.
 * - Health and care: the latest temperature, the number of medication doses (a count only) and a
 *   count (with the total time of timed types) per other kind logged, custom types included.
 *
 * "Usual": the mean over the `USUAL_DAYS` local days before the viewed day, of the days where the
 * category was recorded at all (a day nobody logged is missing, not zero), shown from
 * `MIN_USUAL_DAYS` such days. Viewing today, each past day is measured up to the same local clock
 * time (`clockOn`): counts by start time, bottles started and finished by then, the night when it
 * ended by then, nap minutes elapsed by then. Viewing a past day, whole days are compared.
 */

/** Days before the viewed day that the usual value is taken from. */
export const USUAL_DAYS = 7;
/** Recorded days needed before a usual value shows. */
export const MIN_USUAL_DAYS = 3;
/**
 * How far back the navigator goes (days before today). The device holds the full synced history,
 * but Insights reads the last 30 days (`insights/readiness.ts` LOOK_BACK_DAYS); the Day summary
 * stays inside the same window so it never loads more than Insights already does.
 */
export const MAX_DAYS_BACK = 30;

/** Built-in kinds with their own card: never repeated in the "other kinds" lines. */
const DEDICATED_KEYS: ReadonlySet<string> = new Set([
  'sleep',
  'feeding',
  'diaper',
  'fussy',
  'temperature',
  'medication',
  // Pumping is the parent's, not the baby's feeding: left out of the Day summary.
  'breast_pump',
]);

/** Display order of the other built-in kinds; custom types follow, by name. */
const OTHER_ORDER: readonly string[] = [
  'tummy_time',
  'bath',
  'symptom',
  'belly_pain',
  'spit_up',
  'nasal_suction',
  'belly_massage',
  'teething',
  'outdoor',
  'skin_care',
  'nail_trim',
  'milestone',
];

export interface Usual {
  /** Mean of the recorded days (minutes, ml or a count, see each summary). */
  value: number;
  /** Recorded days the mean is taken over (MIN_USUAL_DAYS to USUAL_DAYS). */
  days: number;
}

export interface SleepDay {
  totalMs: number;
  /** The night that ended on the day (whole); `null` when none did. */
  nightMs: number | null;
  naps: { count: number; ms: number; longestMs: number | null };
  /** Today only: awake or asleep since the last sleep boundary (as the Now screen derives it). */
  current: { state: 'awake' | 'asleep'; ms: number } | null;
  /** Usual total sleep (ms). */
  usual: Usual | null;
}

export interface FeedingDay {
  feeds: number;
  /** Finished bottles of the day (the Now "Milk today" value); `null` without an amount. */
  milk: MilkToday | null;
  /** Breast feeds: effective total and, when the payload has them, the seconds per side (ms). */
  breast: { totalMs: number; leftMs: number; rightMs: number; hasSides: boolean } | null;
  lastFeedAt: string | null;
  /** What the usual line measures: the drunk ml when the headline is ml, else the feed count. */
  usualMetric: 'ml' | 'feeds';
  usual: Usual | null;
}

export interface DiaperDayCounts {
  total: number;
  wet: number;
  dirty: number;
  mixed: number;
  /** Whether any diaper says what it held (otherwise only the total shows). */
  hasContent: boolean;
  usual: Usual | null;
}

export interface CryingDay {
  spells: number;
  /** Effective length of the timed spells; `null` when none was timed. */
  totalMs: number | null;
  /** Usual number of spells. */
  usual: Usual | null;
}

export interface OtherKind {
  typeId: string;
  count: number;
  /** Total effective time of a timed type; `null` when none was timed. */
  durationMs: number | null;
}

export interface HealthDay {
  temperature: { valueC: number; at: string } | null;
  /** Doses of medication logged (count only: never a name, amount or schedule). */
  medicationDoses: number;
  others: OtherKind[];
}

export interface DaySummary {
  dayKey: string;
  isToday: boolean;
  /** `null` when nothing of that category was recorded on the day (the card hides). */
  sleep: SleepDay | null;
  feeding: FeedingDay | null;
  diapers: DiaperDayCounts | null;
  crying: CryingDay | null;
  health: HealthDay | null;
}

/** One local day with the instant its measurement stops (`null`: the whole day). */
interface MeasuredDay {
  startMs: number;
  endMs: number;
  cutoffMs: number | null;
}

interface Facts {
  past: BabyEvent[];
  typeById: ReadonlyMap<string, EventType>;
  keyOf: (event: BabyEvent) => string | undefined;
  now: Date;
}

/** The same local clock time as `clock` on the day starting at `dayStart` (never past its end). */
export function clockOn(dayStart: Date, clock: Date): Date {
  const at = new Date(
    dayStart.getFullYear(),
    dayStart.getMonth(),
    dayStart.getDate(),
    clock.getHours(),
    clock.getMinutes(),
    clock.getSeconds(),
    clock.getMilliseconds(),
  );
  const end = addDays(dayStart, 1);
  return at.getTime() > end.getTime() ? end : at;
}

/** The earliest day the navigator reaches: MAX_DAYS_BACK days ago, or the first logged day. */
export function earliestDay(now: Date, oldestStart: string | null | undefined): Date {
  const limit = addDays(startOfDay(now), -MAX_DAYS_BACK);
  if (!oldestStart) return startOfDay(now);
  const oldest = startOfDay(new Date(oldestStart));
  return oldest.getTime() > limit.getTime() ? oldest : limit;
}

/** UTC ISO instant to load events from: the earliest reachable day's usual days and their nights. */
export function queryFrom(now: Date): string {
  return addDays(startOfDay(now), -(MAX_DAYS_BACK + USUAL_DAYS + 1)).toISOString();
}

const startMs = (event: BabyEvent) => Date.parse(event.startedAt);

/** Started on the day and, when measured up to a time, by then. */
function startedIn(event: BabyEvent, day: MeasuredDay): boolean {
  const start = startMs(event);
  return (
    start >= day.startMs && start < day.endMs && (day.cutoffMs === null || start <= day.cutoffMs)
  );
}

const ofKey = (facts: Facts, key: string) => (event: BabyEvent) => facts.keyOf(event) === key;

const wholeDay = (day: MeasuredDay): MeasuredDay => ({ ...day, cutoffMs: null });

const isFinishedBy = (event: BabyEvent, cutoffMs: number | null) =>
  event.endedAt !== null && (cutoffMs === null || Date.parse(event.endedAt) <= cutoffMs);

// --- sleep ---------------------------------------------------------------------------------

/** The latest night session that ended on the day (and by the cutoff). */
function nightOf(facts: Facts, day: MeasuredDay): BabyEvent | undefined {
  return facts.past
    .filter((e) => {
      if (facts.keyOf(e) !== 'sleep' || sleepSessionKind(e) !== 'night' || e.endedAt === null) {
        return false;
      }
      const end = Date.parse(e.endedAt);
      return (
        end >= day.startMs && end < day.endMs && (day.cutoffMs === null || end <= day.cutoffMs)
      );
    })
    .sort((a, b) => (b.endedAt as string).localeCompare(a.endedAt as string))[0];
}

const napsOf = (facts: Facts, day: MeasuredDay) =>
  facts.past.filter(
    (e) => facts.keyOf(e) === 'sleep' && sleepSessionKind(e) === 'nap' && startedIn(e, day),
  );

/** Effective nap time; measured up to a time, only what had elapsed by then. */
function napMs(nap: BabyEvent, day: MeasuredDay, now: Date): number {
  if (day.cutoffMs === null) return effectiveDurationMs(nap, now);
  return effectiveMsInWindow(nap, startMs(nap), day.cutoffMs, now);
}

function sleepMeasure(facts: Facts, day: MeasuredDay) {
  const night = nightOf(facts, day);
  const nightMs = night ? effectiveDurationMs(night, facts.now) : null;
  const naps = napsOf(facts, day).map((nap) => napMs(nap, day, facts.now));
  const napTotal = naps.reduce((sum, ms) => sum + ms, 0);
  return { nightMs, naps, totalMs: (nightMs ?? 0) + napTotal, napTotal };
}

/**
 * Whether the day has any sleep that counts toward its total (a night that ended on it or a nap
 * that started on it). A night that only started on it belongs to the next day.
 */
function sleepRecorded(facts: Facts, day: MeasuredDay): boolean {
  const whole = wholeDay(day);
  return nightOf(facts, whole) !== undefined || napsOf(facts, whole).length > 0;
}

/** Today: awake or asleep since, through the Now screen's own derivation. */
function currentSleep(facts: Facts, types: readonly EventType[]): SleepDay['current'] {
  const state = deriveNowState(facts.past, types, undefined, facts.now);
  if (state.kind === 'asleep') return { state: 'asleep', ms: state.minutes * MINUTE_MS };
  if (state.kind === 'awake') return { state: 'awake', ms: state.awakeMinutes * MINUTE_MS };
  return null;
}

/** A running sleep session (nap or night) that started on the viewed day. */
const runningSleepStartedIn = (facts: Facts, day: MeasuredDay) =>
  facts.past.some(
    (e) =>
      facts.keyOf(e) === 'sleep' &&
      sleepSessionKind(e) !== null &&
      e.endedAt === null &&
      startedIn(e, day),
  );

// --- feeding -------------------------------------------------------------------------------

const feedsOf = (facts: Facts, day: MeasuredDay) =>
  facts.past.filter((e) => facts.keyOf(e) === 'feeding' && startedIn(e, day));

/** Milk of the day's bottles that had finished by the cutoff (the Now "Milk today" rule). */
const milkOf = (feeds: readonly BabyEvent[], day: MeasuredDay) =>
  milkFromBottles(feeds.filter((feed) => isFinishedBy(feed, day.cutoffMs)));

function breastOf(feeds: readonly BabyEvent[], now: Date): FeedingDay['breast'] {
  const breast = feeds.filter((feed) => payloadString(feed, 'method') === 'breast');
  if (breast.length === 0) return null;
  let totalMs = 0;
  let leftMs = 0;
  let rightMs = 0;
  for (const feed of breast) {
    totalMs += effectiveDurationMs(feed, now);
    const sides = nursingElapsed(feed, now);
    leftMs += sides.left * 1000;
    rightMs += sides.right * 1000;
  }
  const hasSides = leftMs + rightMs > 0;
  // A nursing session timed per side is as long as its two sides.
  const total = Math.max(totalMs, hasSides ? leftMs + rightMs : 0);
  return total > 0 ? { totalMs: total, leftMs, rightMs, hasSides } : null;
}

// --- diapers and crying ---------------------------------------------------------------------

function diaperCounts(facts: Facts, day: MeasuredDay) {
  let total = 0;
  let wet = 0;
  let dirty = 0;
  let mixed = 0;
  for (const event of facts.past) {
    if (facts.keyOf(event) !== 'diaper' || !startedIn(event, day)) continue;
    total += 1;
    const content = payloadString(event, 'content')?.toUpperCase();
    if (content === 'WET' || content === 'MIXED') wet += 1;
    if (content === 'DIRTY' || content === 'MIXED') dirty += 1;
    if (content === 'MIXED') mixed += 1;
  }
  return { total, wet, dirty, mixed };
}

const spellsOf = (facts: Facts, day: MeasuredDay) =>
  facts.past.filter((e) => facts.keyOf(e) === 'fussy' && startedIn(e, day));

// --- health and care ------------------------------------------------------------------------

/** Doses in a medication event: one per listed medicine, at least one per event. */
function dosesIn(event: BabyEvent): number {
  const list = payloadValue(event, 'medications');
  if (!Array.isArray(list)) return 1;
  const entries = (list as unknown[]).filter((item) => typeof item === 'object' && item !== null);
  return Math.max(1, entries.length);
}

function otherKinds(facts: Facts, events: readonly BabyEvent[]): OtherKind[] {
  const byType = new Map<string, OtherKind>();
  for (const event of events) {
    const type = facts.typeById.get(event.typeId);
    if (!type || DEDICATED_KEYS.has(type.key)) continue;
    const kind = byType.get(type.id) ?? { typeId: type.id, count: 0, durationMs: null };
    kind.count += 1;
    if (type.hasDuration) {
      const ms = effectiveDurationMs(event, facts.now);
      if (ms > 0) kind.durationMs = (kind.durationMs ?? 0) + ms;
    }
    byType.set(type.id, kind);
  }
  const rank = (kind: OtherKind) => {
    const type = facts.typeById.get(kind.typeId) as EventType;
    const index = type.babyId === null ? OTHER_ORDER.indexOf(type.key) : -1;
    return index === -1 ? OTHER_ORDER.length : index;
  };
  const nameOf = (kind: OtherKind) => facts.typeById.get(kind.typeId)?.name ?? '';
  return [...byType.values()].sort(
    (a, b) => rank(a) - rank(b) || nameOf(a).localeCompare(nameOf(b)),
  );
}

function healthOf(facts: Facts, day: MeasuredDay): HealthDay | null {
  const events = facts.past.filter((e) => startedIn(e, day));
  const temperature = events
    .filter((e) => facts.keyOf(e) === 'temperature' && payloadNumber(e, 'value_c') !== undefined)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
  const medicationDoses = events
    .filter(ofKey(facts, 'medication'))
    .reduce((sum, e) => sum + dosesIn(e), 0);
  const others = otherKinds(facts, events);
  if (!temperature && medicationDoses === 0 && others.length === 0) return null;
  return {
    temperature: temperature
      ? { valueC: payloadNumber(temperature, 'value_c') as number, at: temperature.startedAt }
      : null,
    medicationDoses,
    others,
  };
}

// --- usual ----------------------------------------------------------------------------------

/** The USUAL_DAYS local days before `dayStart`, each cut at the same clock time as `cutoff`. */
function priorDays(dayStart: Date, cutoff: Date | null): MeasuredDay[] {
  return Array.from({ length: USUAL_DAYS }, (_, index) => {
    const start = addDays(dayStart, -(index + 1));
    return {
      startMs: start.getTime(),
      endMs: addDays(start, 1).getTime(),
      cutoffMs: cutoff === null ? null : clockOn(start, cutoff).getTime(),
    };
  });
}

/** Mean of `value` over the days where `recorded`; `null` under MIN_USUAL_DAYS such days. */
function usualOf(
  days: readonly MeasuredDay[],
  recorded: (day: MeasuredDay) => boolean,
  value: (day: MeasuredDay) => number,
): Usual | null {
  const values = days.filter(recorded).map(value);
  if (values.length < MIN_USUAL_DAYS) return null;
  return { value: values.reduce((sum, v) => sum + v, 0) / values.length, days: values.length };
}

// --- summary --------------------------------------------------------------------------------

export function daySummary(
  events: readonly BabyEvent[],
  types: readonly EventType[],
  day: Date,
  now: Date,
): DaySummary {
  const dayStart = startOfDay(day);
  const isToday = dayValue(dayStart) === dayValue(now);
  const typeById = new Map(types.map((type) => [type.id, type]));
  const facts: Facts = {
    past: pastLiveEvents(events, now),
    typeById,
    keyOf: (event) => typeById.get(event.typeId)?.key,
    now,
  };
  const viewed: MeasuredDay = {
    startMs: dayStart.getTime(),
    endMs: addDays(dayStart, 1).getTime(),
    cutoffMs: isToday ? now.getTime() : null,
  };
  const prior = priorDays(dayStart, isToday ? now : null);
  const recordedBy = (has: (day: MeasuredDay) => boolean) => (d: MeasuredDay) => has(wholeDay(d));

  // Sleep.
  const sleepNow = sleepMeasure(facts, viewed);
  const runningToday = isToday && runningSleepStartedIn(facts, viewed);
  const sleep: SleepDay | null =
    sleepNow.nightMs !== null || sleepNow.naps.length > 0 || runningToday
      ? {
          totalMs: sleepNow.totalMs,
          nightMs: sleepNow.nightMs,
          naps: {
            count: sleepNow.naps.length,
            ms: sleepNow.napTotal,
            longestMs: sleepNow.naps.length >= 2 ? Math.max(...sleepNow.naps) : null,
          },
          current: isToday ? currentSleep(facts, types) : null,
          usual: usualOf(
            prior,
            (d) => sleepRecorded(facts, d),
            (d) => sleepMeasure(facts, d).totalMs,
          ),
        }
      : null;

  // Feeding.
  const feeds = feedsOf(facts, viewed);
  const milk = milkOf(feeds, viewed);
  const usualMetric: FeedingDay['usualMetric'] = milk !== null ? 'ml' : 'feeds';
  const feeding: FeedingDay | null =
    feeds.length > 0
      ? {
          feeds: feeds.length,
          milk,
          breast: breastOf(feeds, now),
          lastFeedAt: feeds.reduce<string | null>(
            (latest, feed) =>
              latest === null || feed.startedAt > latest ? feed.startedAt : latest,
            null,
          ),
          usualMetric,
          usual:
            usualMetric === 'ml'
              ? usualOf(
                  prior,
                  recordedBy((d) => milkOf(feedsOf(facts, d), d) !== null),
                  (d) => milkOf(feedsOf(facts, d), d)?.drunkMl ?? 0,
                )
              : usualOf(
                  prior,
                  recordedBy((d) => feedsOf(facts, d).length > 0),
                  (d) => feedsOf(facts, d).length,
                ),
        }
      : null;

  // Diapers.
  const diaperNow = diaperCounts(facts, viewed);
  const diapers: DiaperDayCounts | null =
    diaperNow.total > 0
      ? {
          ...diaperNow,
          hasContent: diaperNow.wet + diaperNow.dirty > 0,
          usual: usualOf(
            prior,
            recordedBy((d) => diaperCounts(facts, d).total > 0),
            (d) => diaperCounts(facts, d).total,
          ),
        }
      : null;

  // Crying.
  const spells = spellsOf(facts, viewed);
  const timed = spells.map((e) => effectiveDurationMs(e, now)).filter((ms) => ms > 0);
  const crying: CryingDay | null =
    spells.length > 0
      ? {
          spells: spells.length,
          totalMs: timed.length > 0 ? timed.reduce((sum, ms) => sum + ms, 0) : null,
          usual: usualOf(
            prior,
            recordedBy((d) => spellsOf(facts, d).length > 0),
            (d) => spellsOf(facts, d).length,
          ),
        }
      : null;

  return {
    dayKey: dayValue(dayStart),
    isToday,
    sleep,
    feeding,
    diapers,
    crying,
    health: healthOf(facts, viewed),
  };
}

/** Whether any card has something to show. */
export function hasDaySummaryData(summary: DaySummary): boolean {
  return (
    summary.sleep !== null ||
    summary.feeding !== null ||
    summary.diapers !== null ||
    summary.crying !== null ||
    summary.health !== null
  );
}
