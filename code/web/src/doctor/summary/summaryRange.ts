import { addDays, dayValue, parseDayValue, startOfDay } from '../../day/dayModel';
import type { Baby, Note } from '../../db/models';
import { isOwnNote, timelineOf } from '../../notes/noteModel';
import type { SummaryRange } from '../useDoctorData';

/*
 * The summary's period (docs/design/19-doctor-dashboard.md section 5.2): local calendar days,
 * inclusive, at most `MAX_RANGE_DAYS` (the server's limit). Kept in the URL (`?range=last14`,
 * `?range=custom&from=2026-10-01&to=2026-10-14`) so a summary can be bookmarked and shared between
 * the doctor's own devices.
 */

export const RANGE_KINDS = ['last7', 'last14', 'last30', 'sinceNote', 'custom'] as const;
export type RangeKind = (typeof RANGE_KINDS)[number];

export const MAX_RANGE_DAYS = 92;

const LAST_DAYS: Partial<Record<RangeKind, number>> = { last7: 7, last14: 14, last30: 30 };

export const isRangeKind = (value: string | null): value is RangeKind =>
  !!value && (RANGE_KINDS as readonly string[]).includes(value);

/** Days from `from` to `to`, both included (0 when `to` is before `from`). */
export function spanDays(from: string, to: string): number {
  const start = parseDayValue(from);
  const end = parseDayValue(to);
  if (!start || !end) return 0;
  const days = Math.round(
    (Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) -
      Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) /
      86_400_000,
  );
  return days < 0 ? 0 : days + 1;
}

/** Whether a custom range is two dates, in order, at most `MAX_RANGE_DAYS` long. */
export function isValidRange(range: { from: string; to: string }): boolean {
  const days = spanDays(range.from, range.to);
  return days >= 1 && days <= MAX_RANGE_DAYS;
}

/** The last `days` local days ending today. */
export function lastDays(today: Date, days: number): SummaryRange {
  const end = startOfDay(today);
  return { from: dayValue(addDays(end, -(days - 1))), to: dayValue(end) };
}

/**
 * The range of `kind` on `today`: the last 7, 14 or 30 days; since the day of the doctor's latest
 * note (at most `MAX_RANGE_DAYS`); a valid custom range. `null` when it cannot be built (no note
 * yet, an invalid custom range).
 */
export function rangeFor(
  kind: RangeKind,
  today: Date,
  options: { lastNoteAt?: string | null; custom?: { from: string; to: string } | null } = {},
): SummaryRange | null {
  const days = LAST_DAYS[kind];
  if (days) return lastDays(today, days);
  if (kind === 'sinceNote') {
    if (!options.lastNoteAt) return null;
    const from = dayValue(new Date(options.lastNoteAt));
    const range = { from, to: dayValue(startOfDay(today)) };
    if (spanDays(range.from, range.to) === 0) return lastDays(today, 1);
    return isValidRange(range) ? range : lastDays(today, MAX_RANGE_DAYS);
  }
  const custom = options.custom;
  return custom && isValidRange(custom) ? custom : null;
}

/** The local instants of a range: midnight of `from` to midnight after `to`. */
export function rangeBounds(range: SummaryRange): { start: Date; end: Date } | null {
  const start = parseDayValue(range.from);
  const last = parseDayValue(range.to);
  if (!start || !last) return null;
  return { start, end: addDays(last, 1) };
}

/** The doctor's own notes (shared or private, not deleted) written within the range, newest first. */
export function notesInRange(baby: Baby, notes: readonly Note[], range: SummaryRange): Note[] {
  const bounds = rangeBounds(range);
  if (!bounds) return [];
  const from = bounds.start.toISOString();
  const to = bounds.end.toISOString();
  return timelineOf(notes).filter(
    (note) => isOwnNote(baby, note) && note.createdAt >= from && note.createdAt < to,
  );
}
