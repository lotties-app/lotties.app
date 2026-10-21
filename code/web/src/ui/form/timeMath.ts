/**
 * Pure date maths of the time panel. Everything works on the viewer's local calendar day and
 * clock, and keeps instants as `Date`s (UTC underneath), so a value converts to and from ISO
 * strings without shifting. "Local day" arithmetic uses `Date` setters, never `+ 24 h`.
 */

export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
/** The ruler snaps to wall-clock multiples of this many minutes. */
export const SNAP_MINUTES = 5;
/** The ruler covers this far around "now" (12 hours each way, future cut off by `max`). */
export const RULER_SPAN_MINUTES = 12 * 60;
/** Quick "N min ago" chips, after "Now". */
export const QUICK_MINUTES_AGO = [5, 15, 30] as const;

/** `date` with seconds and milliseconds dropped. */
export function startOfMinute(date: Date): Date {
  return new Date(Math.floor(date.getTime() / MINUTE_MS) * MINUTE_MS);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * MINUTE_MS);
}

/** Clamps an instant into `[min, max]` (either bound optional; `max` wins when they cross). */
export function clampDate(date: Date, min?: Date | null, max?: Date | null): Date {
  let result = date;
  if (min && result < min) result = min;
  if (max && result > max) result = max;
  return result;
}

/** Rounds to the nearest multiple of `stepMinutes` on the clock (epoch aligned). */
export function snapToStep(date: Date, stepMinutes = SNAP_MINUTES): Date {
  const step = stepMinutes * MINUTE_MS;
  return new Date(Math.round(date.getTime() / step) * step);
}

/** The local calendar day of `base` at the given clock time. */
export function withClock(base: Date, hours: number, minutes: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), hours, minutes, 0, 0);
}

/** `date` moved by whole local days, keeping the local clock time (not `+ 24 h`). */
export function shiftLocalDays(date: Date, days: number): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + days,
    date.getHours(),
    date.getMinutes(),
    0,
    0,
  );
}

/** Local calendar days from `date`'s day to `now`'s day (0 = today, 1 = yesterday, negative = later). */
export function daysBeforeToday(date: Date, now: Date): number {
  const day = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - day) / (24 * HOUR_MS));
}

export interface Clock {
  hours: number;
  minutes: number;
}

const CLOCK_PATTERN = /^(\d{1,2})(?:[:.hH](\d{2}))?\s*(?:([aApP])\.?[mM]\.?)?$/;
const DIGITS_PATTERN = /^(\d{1,2})(\d{2})$/;

/**
 * Reads a typed time of day: `14:30`, `1430`, `930`, `9`, `14h30`, `2:30 pm`, `2.30PM`, `12 am`.
 * Hours are 0-23 (1-12 with am/pm); `null` when it is not a time.
 */
export function parseClock(text: string): Clock | null {
  const value = text.trim();
  const digits = DIGITS_PATTERN.exec(value);
  const match = digits ?? CLOCK_PATTERN.exec(value);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  const meridiem = digits ? undefined : match[3]?.toLowerCase();
  if (minutes > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridiem === 'p' ? 12 : 0);
  } else if (hours > 23) return null;
  return { hours, minutes };
}

export type TimeProblem = 'invalid' | 'future' | 'beforeMin';

export type ResolvedTime = { ok: true; value: Date } | { ok: false; problem: TimeProblem };

/**
 * Places a typed clock time on `day` (the currently chosen day). Typing a time later than `max`
 * while the day is today means the previous evening ("23:30" typed at 00:10), so it moves back
 * one day instead of failing. A value before `min` or after `max` otherwise reports a problem.
 */
export function resolveTypedTime(
  text: string,
  day: Date,
  limits: { min?: Date | null; max: Date },
): ResolvedTime {
  const clock = parseClock(text);
  if (!clock) return { ok: false, problem: 'invalid' };
  let value = withClock(day, clock.hours, clock.minutes);
  if (value > limits.max && daysBeforeToday(value, limits.max) === 0) {
    value = shiftLocalDays(value, -1);
  }
  if (value > limits.max) return { ok: false, problem: 'future' };
  if (limits.min && value < limits.min) return { ok: false, problem: 'beforeMin' };
  return { ok: true, value };
}

export interface RulerRange {
  from: Date;
  to: Date;
}

/** The instants the ruler spans: up to 12 h before `to`, never before `min`. */
export function rulerRange(to: Date, min?: Date | null): RulerRange {
  const from = addMinutes(to, -RULER_SPAN_MINUTES);
  return { from: min && min > from ? min : from, to };
}

/** Position of `date` on the range as 0 (start) to 1 (end), clamped. */
export function ratioOf(date: Date, range: RulerRange): number {
  const span = range.to.getTime() - range.from.getTime();
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (date.getTime() - range.from.getTime()) / span));
}

/**
 * The instant at `ratio` on the range, snapped to 5-minute clock marks. Close to either end it
 * lands exactly on the end ("now" is rarely a multiple of five).
 */
export function dateAtRatio(ratio: number, range: RulerRange): Date {
  const span = range.to.getTime() - range.from.getTime();
  const raw = new Date(range.from.getTime() + Math.min(1, Math.max(0, ratio)) * span);
  const snapped = snapToStep(raw);
  const half = (SNAP_MINUTES * MINUTE_MS) / 2;
  if (range.to.getTime() - raw.getTime() <= half) return range.to;
  if (raw.getTime() - range.from.getTime() <= half) return range.from;
  return clampDate(snapped, range.from, range.to);
}

/** Whole-hour instants inside the range (for the ruler ticks), oldest first. */
export function hourMarks(range: RulerRange): Date[] {
  const marks: Date[] = [];
  const first = new Date(range.from);
  first.setMinutes(0, 0, 0);
  for (let t = first; t <= range.to; t = new Date(t.getTime() + HOUR_MS)) {
    if (t >= range.from) marks.push(t);
  }
  return marks;
}
