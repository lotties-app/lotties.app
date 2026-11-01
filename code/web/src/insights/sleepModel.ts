import type { BabyEvent, EventType } from '../db/models';
import { isSleepKind, sleepSessionKind, typeIdsForKey } from '../now/eventFacts';
import { effectiveMsInWindow } from '../timers/pauseMath';
import { completedDaysWithData, mean, median, type LocalDay } from './days';

/*
 * Sleep insights, pure: sleep per local day (night and naps, split at midnight, pauses excluded,
 * running sleep counted until `now`), the 06:00-to-06:00 rhythm rows and the usual bedtime and
 * wake-up. Sessions and kinds come from now/eventFacts (`sleepSessionKind`: a missing kind is a
 * nap; markers and night wakings are not sleep).
 */

export interface SleepDay {
  key: string;
  start: Date;
  nightMs: number;
  napMs: number;
}

const live = (events: readonly BabyEvent[], types: readonly EventType[], now: Date) => {
  const ids = typeIdsForKey(types, 'sleep');
  const nowIso = now.toISOString();
  return events.filter((e) => e.deletedAt === null && ids.has(e.typeId) && e.startedAt <= nowIso);
};

const endMs = (event: BabyEvent, now: Date) =>
  event.endedAt === null ? now.getTime() : Date.parse(event.endedAt);

/** Effective sleep per day; an event crossing midnight is split between the days by its instants. */
export function sleepByDay(
  events: readonly BabyEvent[],
  types: readonly EventType[],
  days: readonly LocalDay[],
  now: Date,
): SleepDay[] {
  const sessions = live(events, types, now).filter((e) => sleepSessionKind(e) !== null);
  return days.map((day) => {
    const from = day.start.getTime();
    const to = day.end.getTime();
    let nightMs = 0;
    let napMs = 0;
    for (const event of sessions) {
      if (Date.parse(event.startedAt) >= to || endMs(event, now) <= from) continue;
      const ms = effectiveMsInWindow(event, from, to, now);
      if (sleepSessionKind(event) === 'night') nightMs += ms;
      else napMs += ms;
    }
    return { key: day.key, start: day.start, nightMs, napMs };
  });
}

export interface SleepAverages {
  totalMs: number;
  nightMs: number;
  napMs: number;
  /** Days the averages are taken over. */
  days: number;
}

/** Averages over the finished days with sleep (today only when it is the only one). */
export function sleepAverages(days: readonly SleepDay[], todayKey: string): SleepAverages | null {
  const counted = completedDaysWithData(days, (d) => d.nightMs + d.napMs > 0, todayKey);
  if (counted.length === 0) return null;
  const nightMs = mean(counted.map((d) => d.nightMs)) ?? 0;
  const napMs = mean(counted.map((d) => d.napMs)) ?? 0;
  return { totalMs: nightMs + napMs, nightMs, napMs, days: counted.length };
}

/** The rhythm rows start at this local hour (a night is never split). */
export const RHYTHM_START_HOUR = 6;

export type RhythmKind = 'night' | 'nap' | 'waking';

/** A stretch of a rhythm row, as fractions (0 to 1) of the row. */
export interface RhythmSpan {
  id: string;
  from: number;
  to: number;
  kind: RhythmKind;
}

export interface RhythmRow {
  /** The calendar day the row starts on (at 06:00). */
  key: string;
  start: Date;
  spans: RhythmSpan[];
  /** Bedtime of the evening of this row (UTC ISO), if any. */
  bedtime: string | null;
  /** Wake-up on the morning that starts this row (UTC ISO), if any. */
  wake: string | null;
}

const at = (day: Date, hour: number, dayOffset = 0) =>
  new Date(day.getFullYear(), day.getMonth(), day.getDate() + dayOffset, hour);

function earliest(values: readonly string[]): string | null {
  return values.reduce<string | null>((min, v) => (min === null || v < min ? v : min), null);
}

function latest(values: readonly string[]): string | null {
  return values.reduce<string | null>((max, v) => (max === null || v > max ? v : max), null);
}

const within = (iso: string, from: Date, to: Date) =>
  iso >= from.toISOString() && iso < to.toISOString();

/**
 * Bedtime of the evening of `day`: the earliest `bed_time` marker from 15:00 to 03:00, else the
 * earliest night sleep that started then.
 */
function bedtimeOf(day: Date, sleeps: readonly BabyEvent[]): string | null {
  const from = at(day, 15);
  const to = at(day, 3, 1);
  const markers = sleeps.filter((e) => isSleepKind(e, 'bed_time') && within(e.startedAt, from, to));
  const marked = earliest(markers.map((e) => e.startedAt));
  if (marked) return marked;
  const nights = sleeps.filter(
    (e) => sleepSessionKind(e) === 'night' && within(e.startedAt, from, to),
  );
  return earliest(nights.map((e) => e.startedAt));
}

/**
 * Wake-up on the morning of `day`: the latest end of a night sleep from 03:00 to 12:00, else the
 * earliest `woke_up` marker from 04:00 to 11:00.
 */
function wakeOf(day: Date, sleeps: readonly BabyEvent[]): string | null {
  const ends = sleeps
    .filter((e) => sleepSessionKind(e) === 'night' && e.endedAt !== null)
    .map((e) => e.endedAt as string)
    .filter((iso) => within(iso, at(day, 3), at(day, 12)));
  const ended = latest(ends);
  if (ended) return ended;
  const markers = sleeps.filter(
    (e) => isSleepKind(e, 'woke_up') && within(e.startedAt, at(day, 4), at(day, 11)),
  );
  return earliest(markers.map((e) => e.startedAt));
}

/**
 * One row per day, from 06:00 to 06:00 the next morning, newest first: night and nap sessions and
 * night wakings as fractions of the row (a 23 or 25-hour row on a DST day is still 0 to 1).
 */
export function rhythmRows(
  events: readonly BabyEvent[],
  types: readonly EventType[],
  days: readonly LocalDay[],
  now: Date,
): RhythmRow[] {
  const sleeps = live(events, types, now);
  return [...days].reverse().map((day) => {
    const rowStart = at(day.start, RHYTHM_START_HOUR).getTime();
    const rowEnd = at(day.start, RHYTHM_START_HOUR, 1).getTime();
    const length = rowEnd - rowStart;
    const spans: RhythmSpan[] = [];
    for (const event of sleeps) {
      const kind: RhythmKind | null =
        sleepSessionKind(event) ?? (isSleepKind(event, 'night_waking') ? 'waking' : null);
      if (kind === null) continue;
      const from = Math.max(Date.parse(event.startedAt), rowStart);
      const to = Math.min(endMs(event, now), rowEnd);
      if (to <= from) continue;
      spans.push({
        id: event.id,
        from: (from - rowStart) / length,
        to: (to - rowStart) / length,
        kind,
      });
    }
    // Wakings are drawn last, as gaps over the night.
    spans.sort(
      (a, b) => Number(a.kind === 'waking') - Number(b.kind === 'waking') || a.from - b.from,
    );
    return {
      key: day.key,
      start: day.start,
      spans,
      bedtime: bedtimeOf(day.start, sleeps),
      wake: wakeOf(day.start, sleeps),
    };
  });
}

const MINUTES_PER_DAY = 24 * 60;
const NOON = 12 * 60;

/** Local minutes after midnight of an instant. */
export function clockMinutes(iso: string): number {
  const date = new Date(iso);
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * The usual clock time of a set of instants, in local minutes after midnight. Bedtimes are measured
 * from noon so 23:30 and 00:30 average to midnight, not to noon.
 */
export function usualClock(isos: readonly string[], fromNoon: boolean): number | null {
  const shift = fromNoon ? NOON : 0;
  const values = isos.map((iso) => (clockMinutes(iso) - shift + MINUTES_PER_DAY) % MINUTES_PER_DAY);
  const middle = median(values);
  return middle === null ? null : Math.round(middle + shift) % MINUTES_PER_DAY;
}

export interface UsualTimes {
  /** Local minutes after midnight, or `null` without data. */
  bedtime: number | null;
  wake: number | null;
}

export function usualTimes(rows: readonly RhythmRow[]): UsualTimes {
  return {
    bedtime: usualClock(
      rows.flatMap((row) => (row.bedtime ? [row.bedtime] : [])),
      true,
    ),
    wake: usualClock(
      rows.flatMap((row) => (row.wake ? [row.wake] : [])),
      false,
    ),
  };
}
