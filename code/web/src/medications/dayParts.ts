import type { DayPart } from '../db/models';

/*
 * The parts of the baby's day for prescriptions such as "1 drop in the morning", where the clock
 * time does not matter. Mirrors the API's `Lotties.Domain.Prescriptions.DayPartWindows` (the same
 * fixed windows, shared vectors in dayPartVectors.json): morning 05:00-12:00, afternoon
 * 12:00-18:00, evening 18:00-22:00, night 22:00-05:00 (crossing midnight). A routine day starts at
 * 05:00, so the night belongs to the day it started on. Pure: local time = the instant seen with a
 * fixed UTC offset (minutes east of UTC).
 */

const MINUTE_MS = 60_000;

/** Every part, in the order of the day. */
export const DAY_PARTS: readonly DayPart[] = ['morning', 'afternoon', 'evening', 'night'];

/** Local start of each part (`HH:mm`); a part ends where the next one starts. */
export const DAY_PART_STARTS: Readonly<Record<DayPart, string>> = {
  morning: '05:00',
  afternoon: '12:00',
  evening: '18:00',
  night: '22:00',
};

/** The suggested reminder time of each part when reminders are turned on. */
export const DEFAULT_REMINDER_TIMES: Readonly<Record<DayPart, string>> = {
  morning: '08:00',
  afternoon: '14:00',
  evening: '19:00',
  night: '22:00',
};

const NEXT: Readonly<Record<DayPart, DayPart>> = {
  morning: 'afternoon',
  afternoon: 'evening',
  evening: 'night',
  night: 'morning',
};

/** Local end (exclusive) of a part: the start of the next one. */
export function dayPartEnd(part: DayPart): string {
  return DAY_PART_STARTS[NEXT[part]];
}

export function isDayPart(value: unknown): value is DayPart {
  return typeof value === 'string' && (DAY_PARTS as readonly string[]).includes(value);
}

/** The chosen parts in day order, without repeats. */
export function sortDayParts(parts: readonly DayPart[]): DayPart[] {
  return DAY_PARTS.filter((part) => parts.includes(part));
}

/** The part an `HH:mm` local time falls in (before 05:00 is night). */
export function partAt(time: string): DayPart {
  if (time >= DAY_PART_STARTS.night || time < DAY_PART_STARTS.morning) return 'night';
  if (time >= DAY_PART_STARTS.evening) return 'evening';
  if (time >= DAY_PART_STARTS.afternoon) return 'afternoon';
  return 'morning';
}

const pad = (n: number) => String(n).padStart(2, '0');

function dateOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function shiftDay(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return dateOf(Date.UTC(y, m - 1, d + days));
}

/** The instant (epoch ms) of the local `day` + `HH:mm` for a fixed offset. */
function instantOf(day: string, time: string, utcOffsetMinutes: number): number {
  const [y, m, d] = day.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, h, min) - utcOffsetMinutes * MINUTE_MS;
}

export interface DayPartOfDay {
  /** The routine day `yyyy-mm-dd` (the night after midnight belongs to the day before). */
  day: string;
  part: DayPart;
}

/** The routine day and part of an instant seen with a fixed UTC offset. */
export function dayPartOf(instant: Date | number, utcOffsetMinutes: number): DayPartOfDay {
  const local = new Date(new Date(instant).getTime() + utcOffsetMinutes * MINUTE_MS);
  const date = dateOf(local.getTime());
  const time = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
  return { day: time < DAY_PART_STARTS.morning ? shiftDay(date, -1) : date, part: partAt(time) };
}

export interface DayPartWindow {
  part: DayPart;
  /** The routine day `yyyy-mm-dd`. */
  day: string;
  /** Epoch ms, inclusive. */
  start: number;
  /** Epoch ms, exclusive. */
  end: number;
}

/** The instant of a local `HH:mm` inside a part of the routine day (a night time before 05:00 is on the next date). */
export function instantInPart(
  day: string,
  part: DayPart,
  time: string,
  utcOffsetMinutes: number,
): number {
  const date = part === 'night' && time < DAY_PART_STARTS.morning ? shiftDay(day, 1) : day;
  return instantOf(date, time, utcOffsetMinutes);
}

/** The window of `part` on the routine day `day`. */
export function dayPartWindow(day: string, part: DayPart, utcOffsetMinutes: number): DayPartWindow {
  const endDay = part === 'night' ? shiftDay(day, 1) : day;
  return {
    part,
    day,
    start: instantOf(day, DAY_PART_STARTS[part], utcOffsetMinutes),
    end: instantOf(endDay, dayPartEnd(part), utcOffsetMinutes),
  };
}

/** The next calendar day of a routine day. */
export function nextDay(day: string): string {
  return shiftDay(day, 1);
}
