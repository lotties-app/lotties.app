import type { BabyEvent } from '../db/models';
import { SEGMENTS_KEY } from '../events/bottleSegments';
import { PAUSE_KEYS, SEGMENT_START_KEY } from '../timers/pauseMath';
import { getOwn } from '../util/ownProperty';

/*
 * "Change time" of the Day row menu (docs/design/03-interaction.md, "Press and hold a Day row"):
 * moves the start (and the end) of an entry without opening the full event sheet. Only for entries
 * whose payload holds nothing tied to their times; anything else opens the full sheet, which knows
 * how to rebase a bottle's history and the nursing sides. Pure.
 */

/** Payload members measured against the event's times: their owner is the full sheet. */
const TIME_BOUND_KEYS: readonly string[] = [
  SEGMENTS_KEY,
  SEGMENT_START_KEY,
  ...PAUSE_KEYS,
  'breast_left_seconds',
  'breast_right_seconds',
];

/** Whether the quick time sheet may move this entry (no history, pauses or nursing sides). */
export function quickTimeAllowed(event: Pick<BabyEvent, 'payload'>): boolean {
  return TIME_BOUND_KEYS.every((key) => getOwn(event.payload, key) === undefined);
}

/** An entry that ends when it starts (a diaper, a bedtime marker): one time moves both. */
export function isMomentEntry(event: Pick<BabyEvent, 'startedAt' | 'endedAt'>): boolean {
  return event.endedAt !== null && Date.parse(event.endedAt) === Date.parse(event.startedAt);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Local `HH:MM` of `date` (the native time input's value). */
export function clockOf(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** `date` on its own local day at `hhmm`, or `null` for an incomplete value. */
export function atClock(date: Date, hhmm: string): Date | null {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  const next = new Date(date);
  next.setHours(hours, minutes, 0, 0);
  return next;
}

/** `date` moved by `minutes` (may cross midnight). */
export function nudged(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export type QuickTimeProblem = 'endBeforeStart' | 'startInFuture';

/**
 * What stops the save: an end before the start (as the event sheet's check) or a running timer
 * that would start after now.
 */
export function quickTimeProblem(
  start: Date,
  end: Date | null,
  running: boolean,
  now: Date,
): QuickTimeProblem | null {
  if (end !== null && end < start) return 'endBeforeStart';
  if (running && start > now) return 'startInFuture';
  return null;
}

/** The times to save: a moment ends when it starts, a running entry stays running. */
export function quickTimeChanges(
  event: Pick<BabyEvent, 'startedAt' | 'endedAt'>,
  start: Date,
  end: Date | null,
): { startedAt: string; endedAt: string | null } {
  const startedAt = start.toISOString();
  if (event.endedAt === null) return { startedAt, endedAt: null };
  if (isMomentEntry(event)) return { startedAt, endedAt: startedAt };
  return { startedAt, endedAt: (end ?? start).toISOString() };
}
