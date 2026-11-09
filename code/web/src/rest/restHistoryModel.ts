import { HISTORY_NIGHTS, type HistoryNights, type RestHistoryNight } from './restApi';

/*
 * Pure geometry and preferences of the rest history (docs/design/41-caregiver-rest.md section 12).
 * Times are placed on one axis of hours from the local midnight of the date each night starts, so
 * every night shares the same columns (21:20 is 21.33, 06:30 the next morning is 30.5).
 */

const HOUR_MS = 3_600_000;

/** Local midnight (viewer's zone, like every time the tab shows) of a `yyyy-mm-dd` night. */
export function nightOrigin(night: string): number {
  const [y, m, d] = night.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
}

/** Hours from the night's local midnight. */
export const hoursFrom = (night: string, instant: string) =>
  (Date.parse(instant) - nightOrigin(night)) / HOUR_MS;

export interface NightAxis {
  /** Whole hours from the night's local midnight. */
  start: number;
  end: number;
  ticks: number[];
}

const TICK_STEPS = [1, 2, 3, 4, 6];
const MAX_TICKS = 5;

/**
 * The shared time axis of the nights chart, from the earliest part start to the latest part end
 * (whole hours), with at most five hour ticks. `null` when no night has a finished part.
 */
export function nightAxis(nights: readonly RestHistoryNight[]): NightAxis | null {
  let min = Infinity;
  let max = -Infinity;
  for (const night of nights) {
    for (const part of night.parts) {
      if (!part.end) continue;
      min = Math.min(min, hoursFrom(night.night, part.start));
      max = Math.max(max, hoursFrom(night.night, part.end));
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  const step = TICK_STEPS.find((s) => (Math.ceil(max) - Math.floor(min)) / s <= MAX_TICKS - 1) ?? 6;
  const start = Math.floor(min / step) * step;
  const end = Math.max(start + step, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let tick = start; tick <= end; tick += step) ticks.push(tick);
  return { start, end, ticks };
}

/** A part as a percentage span of the axis, clamped to it. */
export function spanOnAxis(
  axis: NightAxis,
  night: string,
  start: string,
  end: string,
): { left: number; width: number } {
  const total = axis.end - axis.start;
  const from = Math.max(axis.start, hoursFrom(night, start));
  const to = Math.min(axis.end, hoursFrom(night, end));
  return {
    left: ((from - axis.start) / total) * 100,
    width: (Math.max(0, to - from) / total) * 100,
  };
}

/** A wall-clock hour (may be 24 or more on the axis) as a time for `formatTime`. */
export const hourAsDate = (hour: number) => new Date(2000, 0, 1, ((hour % 24) + 24) % 24);

/** Why a night is drawn muted, or `null` when it is in the summaries. */
export function mutedReason(night: RestHistoryNight): 'workOverlap' | 'notCounted' | null {
  if (night.status !== 'ok') return null;
  if (night.workOverlap) return 'workOverlap';
  return night.counted ? null : 'notCounted';
}

/** Newest first, like the Day list. */
export const newestFirst = (nights: readonly RestHistoryNight[]) =>
  [...nights].sort((a, b) => (a.night < b.night ? 1 : a.night > b.night ? -1 : 0));

/** Remembered choice of 14 or 28 nights: a display preference, never rest data. */
export const HISTORY_NIGHTS_KEY = 'baby-routine.restHistoryNights';

export function readHistoryNights(): HistoryNights {
  try {
    const stored = Number(window.localStorage.getItem(HISTORY_NIGHTS_KEY));
    return HISTORY_NIGHTS.find((n) => n === stored) ?? 14;
  } catch {
    return 14;
  }
}

export function writeHistoryNights(nights: HistoryNights): void {
  try {
    window.localStorage.setItem(HISTORY_NIGHTS_KEY, String(nights));
  } catch {
    /* private mode or blocked storage: the choice is simply not remembered */
  }
}
