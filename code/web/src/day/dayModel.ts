import type { BabyEvent, EventType } from '../db/models';
import { MINUTE_MS, sleepSessionKind, typeIdsForKey } from '../now/eventFacts';
import { effectiveDurationMs, effectiveMsInWindow } from '../timers/pauseMath';
import { typeCategory } from '../now/typeVisual';
import { CATEGORY_NAMES, type CategoryName } from '../theme/tokens';

/*
 * Pure model of the Day screen: local-day boundaries (the device's time zone, DST safe because
 * they come from `Date` calendar setters), which events belong to a day, the summary strip and the
 * 24-hour ribbon. Language-free; the screen formats the numbers.
 */

export interface DayBounds {
  /** Local midnight that starts the day. */
  start: Date;
  /** Local midnight that starts the next day. */
  end: Date;
}

/** The local calendar day of `date` at 00:00. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** `date` moved by whole local calendar days (not 24 h steps), at 00:00. */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function dayBounds(day: Date): DayBounds {
  const start = startOfDay(day);
  return { start, end: addDays(start, 1) };
}

export const isSameDay = (a: Date, b: Date) => startOfDay(a).getTime() === startOfDay(b).getTime();

const pad = (n: number) => String(n).padStart(2, '0');

/** `yyyy-mm-dd` of the local calendar day (what the date field uses). */
export function dayValue(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The local day of a `yyyy-mm-dd` value, or `null` when it is not a date. */
export function parseDayValue(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const date = new Date(y, m - 1, d);
  return date.getMonth() === m - 1 && date.getDate() === d ? date : null;
}

/**
 * How far before the day an event may have started and still reach into it. A sleep longer than
 * this is cut off in the ribbon (the longest plausible stretch for a baby is far below it).
 */
export const LOOK_BACK_MS = 24 * 60 * MINUTE_MS;

/** UTC ISO range to query for a day: from `LOOK_BACK_MS` before it (for the ribbon) to its end. */
export function queryRange(bounds: DayBounds): { from: string; to: string } {
  return {
    from: new Date(bounds.start.getTime() - LOOK_BACK_MS).toISOString(),
    to: bounds.end.toISOString(),
  };
}

/** Events that started on the day, newest first (the rows of the day). */
export function eventsOfDay(events: readonly BabyEvent[], bounds: DayBounds): BabyEvent[] {
  const from = bounds.start.toISOString();
  const to = bounds.end.toISOString();
  return events
    .filter((e) => e.deletedAt === null && e.startedAt >= from && e.startedAt < to)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id));
}

/** Categories a baby's types can have, in display order; sleep markers are part of "sleep". */
export const FILTER_CATEGORIES: readonly CategoryName[] = CATEGORY_NAMES.filter(
  (name) => name !== 'nightWaking',
);

/** The filter categories present among `types`, in display order. */
export function categoriesOf(types: readonly EventType[]): CategoryName[] {
  const present = new Set(types.map((type) => typeCategory(type)));
  return FILTER_CATEGORIES.filter((name) => present.has(name));
}

/** Events whose type category is selected; an empty selection means all. */
export function filterByCategory(
  events: readonly BabyEvent[],
  types: readonly EventType[],
  selected: ReadonlySet<CategoryName>,
): BabyEvent[] {
  if (selected.size === 0) return [...events];
  const byId = new Map(types.map((type) => [type.id, type]));
  return events.filter((e) => selected.has(typeCategory(byId.get(e.typeId))));
}

/** Whether a filter category is shown: an empty selection shows every category. */
export const isCategoryShown = (selected: ReadonlySet<CategoryName>, category: CategoryName) =>
  selected.size === 0 || selected.has(category);

/**
 * The filter selection after showing or hiding one category from the ribbon legend (the same
 * state as the filter sheet). Hiding from "everything" selects all the others; a selection that
 * covers every category, or would hide all of them, goes back to "everything" (empty).
 */
export function toggleShown(
  selected: ReadonlySet<CategoryName>,
  category: CategoryName,
  all: readonly CategoryName[],
): ReadonlySet<CategoryName> {
  const shown = new Set(selected.size === 0 ? all : selected);
  if (!shown.delete(category)) shown.add(category);
  if (shown.size === 0 || all.every((name) => shown.has(name))) return new Set();
  return shown;
}

/** A coloured stretch of the ribbon, as fractions (0 to 1) of the day. */
export interface RibbonSpan {
  id: string;
  from: number;
  to: number;
  category: 'sleep' | 'nightWaking';
}

/** A tick on the ribbon at a fraction of the day. */
export interface RibbonTick {
  id: string;
  at: number;
  category: CategoryName;
}

export interface DaySummary {
  /** Minutes of sleep (naps and night sleep) inside the day, running sleep counted until `now`. */
  sleepMinutes: number;
  /** Naps that started on the day. */
  naps: number;
  feeds: number;
  diapers: number;
  spans: RibbonSpan[];
  ticks: RibbonTick[];
}

const TICK_CATEGORIES: ReadonlySet<CategoryName> = new Set([
  'feeding',
  'diaper',
  'health',
  'care',
  'activity',
]);

/** Summary strip and ribbon of a day from the events loaded for it (see `queryRange`). */
export function summarizeDay(
  events: readonly BabyEvent[],
  types: readonly EventType[],
  bounds: DayBounds,
  now: Date,
): DaySummary {
  const startMs = bounds.start.getTime();
  const length = bounds.end.getTime() - startMs;
  const ratio = (ms: number) => Math.min(1, Math.max(0, (ms - startMs) / length));
  const sleepIds = typeIdsForKey(types, 'sleep');
  const feedIds = typeIdsForKey(types, 'feeding');
  const diaperIds = typeIdsForKey(types, 'diaper');
  const byId = new Map(types.map((type) => [type.id, type]));
  const summary: DaySummary = {
    sleepMinutes: 0,
    naps: 0,
    feeds: 0,
    diapers: 0,
    spans: [],
    ticks: [],
  };

  for (const event of events) {
    if (event.deletedAt !== null) continue;
    const begin = Date.parse(event.startedAt);
    const finish = event.endedAt === null ? now.getTime() : Date.parse(event.endedAt);
    const inDay = begin >= startMs && begin < bounds.end.getTime();

    if (sleepIds.has(event.typeId)) {
      const kind = sleepSessionKind(event);
      const waking = Object.hasOwn(event.payload, 'kind') && event.payload.kind === 'night_waking';
      if (kind === null && !waking) continue;
      const from = Math.max(begin, startMs);
      const to = Math.min(finish, bounds.end.getTime());
      if (to <= from) continue;
      // Effective minutes: a paused stretch is not sleep.
      if (kind === 'nap' && !waking && inDay) summary.naps += 1;
      if (kind !== null) {
        summary.sleepMinutes += Math.round(
          effectiveMsInWindow(event, startMs, bounds.end.getTime(), now) / MINUTE_MS,
        );
      }
      summary.spans.push({
        id: event.id,
        from: ratio(from),
        to: ratio(to),
        category: waking ? 'nightWaking' : 'sleep',
      });
      continue;
    }
    if (!inDay) continue;
    if (feedIds.has(event.typeId)) summary.feeds += 1;
    if (diaperIds.has(event.typeId)) summary.diapers += 1;
    const category = typeCategory(byId.get(event.typeId));
    if (TICK_CATEGORIES.has(category)) {
      summary.ticks.push({ id: event.id, at: ratio(begin), category });
    }
  }
  return summary;
}

/** A quiet line between rows: a nap or a night ended here. */
export interface SessionSeparator {
  kind: 'separator';
  /** The sleep event whose end it marks. */
  id: string;
  endedAt: string;
  durationMs: number;
}

export interface EventItem {
  kind: 'event';
  event: BabyEvent;
}

export type DayItem = EventItem | SessionSeparator;

/**
 * The rows of a day (newest first) with a separator where a nap or a night ended: placed between
 * the events that came after the end and the ones that started before it. Only sessions among
 * `rows` count, so a filter that hides sleep hides the separators too; running sessions and
 * markers (bedtime, woke up) have none.
 */
export function withSessionSeparators(
  rows: readonly BabyEvent[],
  types: readonly EventType[],
): DayItem[] {
  const sleepIds = typeIdsForKey(types, 'sleep');
  const separators: SessionSeparator[] = rows
    .filter(
      (event) =>
        sleepIds.has(event.typeId) && event.endedAt !== null && sleepSessionKind(event) !== null,
    )
    .map((event) => ({
      kind: 'separator' as const,
      id: event.id,
      endedAt: event.endedAt as string,
      durationMs: effectiveDurationMs(event),
    }))
    .filter((separator) => separator.durationMs > 0)
    .sort((a, b) => b.endedAt.localeCompare(a.endedAt));

  const items: DayItem[] = [];
  let next = 0;
  for (const event of rows) {
    // Every separator that ended after this event started goes above it.
    while (next < separators.length && separators[next].endedAt > event.startedAt) {
      items.push(separators[next]);
      next += 1;
    }
    items.push({ kind: 'event', event });
  }
  return items;
}
