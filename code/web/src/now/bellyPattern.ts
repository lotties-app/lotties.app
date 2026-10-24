import type { BabyEvent, EventType } from '../db/models';
import type { PredictionsDto, TimeOfDayPatternDto } from '../sync/contract';
import { MINUTE_MS, pastLiveEvents, typeIdsForKey } from './eventFacts';

/*
 * The belly pain suggestion on Now (docs/design/11-patterns.md): the pattern comes from the server
 * (the predictions response, cached for offline like the nap window); whether today's window is
 * already handled is decided from local events. Pure and language-free. The window helpers are
 * shared with the fussy pattern (now/fussyPattern.ts).
 */

export const BELLY_PAIN_KEY = 'belly_pain';
export const BELLY_MASSAGE_KEY = 'belly_massage';
/** The suggestion shows this long before the window when the server does not say. */
export const DEFAULT_LEAD_MINUTES = 45;

const MINUTES_PER_DAY = 24 * 60;
/** The server never sends a wider window (3 h); anything else is ignored as malformed. */
const MAX_WINDOW_MINUTES = 3 * 60;
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** One occurrence of a usual pattern window on the device's local timeline. */
export interface PatternWindow {
  /** Local date (`yyyy-mm-dd`) the window starts on: one suggestion and one "Not today" per date. */
  date: string;
  /** When the suggestion starts showing (window start minus the lead). */
  showFrom: Date;
  start: Date;
  end: Date;
  /** The usual time on this occurrence. */
  typical: Date;
}

/** Minutes after midnight of an `HH:mm` clock, or `undefined` when malformed. */
export function clockMinutes(clock: unknown): number | undefined {
  const match = typeof clock === 'string' ? CLOCK.exec(clock) : null;
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
}

/** The belly pain window (the same shape as every pattern window). */
export type BellyWindow = PatternWindow;

/** The well-formed pattern of `typeKey` in a predictions response, if any. */
export function patternOfType(
  predictions: PredictionsDto | null | undefined,
  typeKey: string,
): TimeOfDayPatternDto | null {
  const pattern = predictions?.patterns?.find((p) => p.typeKey === typeKey);
  if (!pattern) return null;
  const valid =
    clockMinutes(pattern.windowStart) !== undefined &&
    clockMinutes(pattern.typicalClock) !== undefined &&
    Number.isInteger(pattern.windowMinutes) &&
    pattern.windowMinutes > 0 &&
    pattern.windowMinutes <= MAX_WINDOW_MINUTES &&
    Array.isArray(pattern.days);
  return valid ? pattern : null;
}

/** The well-formed belly pain pattern of a predictions response, if any. */
export function bellyPainPattern(
  predictions: PredictionsDto | null | undefined,
): TimeOfDayPatternDto | null {
  return patternOfType(predictions, BELLY_PAIN_KEY);
}

const leadOf = (pattern: TimeOfDayPatternDto) => {
  const lead = pattern.rule?.leadMinutes;
  return typeof lead === 'number' && lead >= 0 && lead <= 180 ? lead : DEFAULT_LEAD_MINUTES;
};

const pad = (n: number) => String(n).padStart(2, '0');

/** `yyyy-mm-dd` of a local date. */
export const localDateKey = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** The occurrence of the window that starts on the local date `day` (any time of that day). */
export function occurrenceOn(pattern: TimeOfDayPatternDto, day: Date): PatternWindow {
  const startMinutes = clockMinutes(pattern.windowStart) ?? 0;
  const typicalAfter =
    ((clockMinutes(pattern.typicalClock) ?? startMinutes) - startMinutes + MINUTES_PER_DAY) %
    MINUTES_PER_DAY;
  const start = new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate(),
    Math.floor(startMinutes / 60),
    startMinutes % 60,
  );
  return {
    date: localDateKey(start),
    showFrom: new Date(start.getTime() - leadOf(pattern) * MINUTE_MS),
    start,
    end: new Date(start.getTime() + pattern.windowMinutes * MINUTE_MS),
    typical: new Date(start.getTime() + typicalAfter * MINUTE_MS),
  };
}

/**
 * The occurrence whose suggestion time contains `now` (from window start minus the lead until the
 * window ends), among the windows starting yesterday, today and tomorrow; `null` outside them.
 */
export function windowAround(pattern: TimeOfDayPatternDto, now: Date): PatternWindow | null {
  const days = [-1, 0, 1].map(
    (offset) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset),
  );
  return (
    days
      .map((day) => occurrenceOn(pattern, day))
      .find((window) => window.showFrom <= now && now < window.end) ?? null
  );
}

/**
 * A belly pain or belly massage (running or not) started from the suggestion time on, or a belly
 * massage still running from before it.
 */
export function isHandled(
  window: PatternWindow,
  events: readonly BabyEvent[],
  types: readonly EventType[],
  now: Date,
): boolean {
  const massage = typeIdsForKey(types, BELLY_MASSAGE_KEY);
  const ids = new Set([...typeIdsForKey(types, BELLY_PAIN_KEY), ...massage]);
  const from = window.showFrom.getTime();
  return pastLiveEvents(events, now).some(
    (event) =>
      ids.has(event.typeId) &&
      (Date.parse(event.startedAt) >= from || (massage.has(event.typeId) && !event.endedAt)),
  );
}

export interface PatternSuggestionInput {
  predictions: PredictionsDto | null | undefined;
  events: readonly BabyEvent[];
  types: readonly EventType[];
  now: Date;
  /** The window date "Not today" was chosen for, if any. */
  dismissedDate: string | null;
}

export interface PatternSuggestion {
  pattern: TimeOfDayPatternDto;
  window: PatternWindow;
}

export type BellySuggestionInput = PatternSuggestionInput;
export type BellySuggestion = PatternSuggestion;

/**
 * The suggestion to show now, or `null`: no pattern, outside the suggestion time, already handled
 * (a belly pain or massage logged since the suggestion time), or "Not today" for this window.
 */
export function bellySuggestion(input: BellySuggestionInput): BellySuggestion | null {
  const pattern = bellyPainPattern(input.predictions);
  if (!pattern) return null;
  const window = windowAround(pattern, input.now);
  if (!window || window.date === input.dismissedDate) return null;
  if (isHandled(window, input.events, input.types, input.now)) return null;
  return { pattern, window };
}
