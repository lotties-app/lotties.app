import { addDays, dayValue, startOfDay } from '../day/dayModel';

/*
 * Local calendar days for Insights. Days come from `Date` calendar setters (`addDays`), so a day
 * is 23 or 25 hours long across a DST change and every bucket still starts at local midnight.
 * An event is bucketed by the local day it started on, or split across days by its instants
 * (see `effectiveMsInWindow`), never by adding 24-hour steps.
 */

export interface LocalDay {
  /** `yyyy-mm-dd` of the local day. */
  key: string;
  /** Local midnight that starts the day. */
  start: Date;
  /** Local midnight that starts the next day. */
  end: Date;
}

export function localDay(date: Date): LocalDay {
  const start = startOfDay(date);
  return { key: dayValue(start), start, end: addDays(start, 1) };
}

/** The `count` local days that end with the day of `now`, oldest first. */
export function lastDays(now: Date, count: number): LocalDay[] {
  const today = startOfDay(now);
  return Array.from({ length: count }, (_, index) => localDay(addDays(today, index - count + 1)));
}

/** `yyyy-mm-dd` of the local day an ISO instant falls on. */
export const dayKeyOf = (iso: string) => dayValue(new Date(iso));

/** Distinct local days (keys) the instants fall on. */
export function daysWithData(starts: Iterable<string>): Set<string> {
  const keys = new Set<string>();
  for (const iso of starts) keys.add(dayKeyOf(iso));
  return keys;
}

/**
 * The days that averages are taken over: days with data, without today (it is not over yet)
 * unless today is the only one.
 */
export function completedDaysWithData<T extends { key: string }>(
  days: readonly T[],
  hasData: (day: T) => boolean,
  todayKey: string,
): T[] {
  const withData = days.filter(hasData);
  const finished = withData.filter((day) => day.key !== todayKey);
  return finished.length > 0 ? finished : withData;
}

export const mean = (values: readonly number[]): number | null =>
  values.length === 0 ? null : values.reduce((sum, value) => sum + value, 0) / values.length;

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
