import type { Appointment } from '../db/models';

/*
 * Calendar maths of the appointments page (docs/design/15-appointments.md), pure and DST safe:
 * instants are UTC; a "day" is a local calendar date `yyyy-mm-dd` read in the device zone (or in
 * `timeZone`, for tests and previews) through `Intl`, never by adding 24 hours. Month grids are
 * built from calendar dates alone (UTC arithmetic), so a daylight saving change never shifts a cell.
 */

/** A local calendar date, `yyyy-mm-dd`. */
export type DayKey = string;

export interface MonthRef {
  year: number;
  /** 1-12. */
  month: number;
}

export interface MonthCell {
  key: DayKey;
  /** Day of the month, 1-31. */
  day: number;
  /** Whether the date belongs to the shown month (else it only fills the first or last week). */
  inMonth: boolean;
}

const DAY_MS = 86_400_000;
const pad = (value: number) => String(value).padStart(2, '0');

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone?: string): Intl.DateTimeFormat {
  const key = timeZone ?? '';
  let formatter = partFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partFormatters.set(key, formatter);
  }
  return formatter;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** The wall clock of `instant` in the device zone (or `timeZone`). */
export function wallClockOf(instant: number, timeZone?: string): WallClock {
  const parts: Record<string, number> = {};
  for (const part of partsFormatter(timeZone).formatToParts(new Date(instant))) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return {
    year: parts.year ?? 1970,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: (parts.hour ?? 0) % 24,
    minute: parts.minute ?? 0,
    second: parts.second ?? 0,
  };
}

const toMs = (value: number | string | Date) =>
  value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : value;

/** The local calendar date of an instant. */
export function dayKeyOf(instant: number | string | Date, timeZone?: string): DayKey {
  const wall = wallClockOf(toMs(instant), timeZone);
  return `${wall.year}-${pad(wall.month)}-${pad(wall.day)}`;
}

/** The local time of day of an instant, `HH:MM`. */
export function timeOfDayOf(instant: number | string | Date, timeZone?: string): string {
  const wall = wallClockOf(toMs(instant), timeZone);
  return `${pad(wall.hour)}:${pad(wall.minute)}`;
}

/** The zone's offset from UTC at `instant`, in milliseconds (seconds ignored). */
function offsetAt(instant: number, timeZone?: string): number {
  const wall = wallClockOf(instant, timeZone);
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * The UTC instant (ISO) of a local date and time of day. A time a daylight saving change skips
 * lands just after the gap (02:30 becomes 03:30); a repeated time is its first occurrence.
 */
export function instantOf(day: DayKey, time: string, timeZone?: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wall = Date.UTC(year ?? 1970, (month ?? 1) - 1, date ?? 1, hour ?? 0, minute ?? 0);
  const candidates = [
    wall - offsetAt(wall - 12 * 3_600_000, timeZone),
    wall - offsetAt(wall + 12 * 3_600_000, timeZone),
  ];
  const valid = candidates.filter((t) => t + offsetAt(t, timeZone) === wall);
  const chosen = valid.length > 0 ? Math.min(...valid) : Math.max(...candidates);
  return new Date(chosen).toISOString();
}

const keyToUtc = (key: DayKey) => Date.parse(`${key}T00:00:00Z`);
const utcToKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The calendar date `days` after `key` (negative: before). */
export function addDays(key: DayKey, days: number): DayKey {
  return utcToKey(keyToUtc(key) + days * DAY_MS);
}

/** Day of the week of a calendar date, 0 = Sunday. */
export function weekdayOf(key: DayKey): number {
  return new Date(keyToUtc(key)).getUTCDay();
}

export function monthOfKey(key: DayKey): MonthRef {
  const [year, month] = key.split('-').map(Number);
  return { year: year ?? 1970, month: month ?? 1 };
}

export function shiftMonth({ year, month }: MonthRef, delta: number): MonthRef {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function sameMonth(a: MonthRef, b: MonthRef): boolean {
  return a.year === b.year && a.month === b.month;
}

/**
 * The weeks shown for a month: whole weeks from the one holding the 1st to the one holding the
 * last day, each starting on `weekStartsOn` (0 = Sunday ... 6 = Saturday).
 */
export function monthGrid({ year, month }: MonthRef, weekStartsOn: number): MonthCell[][] {
  const first: DayKey = `${year}-${pad(month)}-01`;
  const next = shiftMonth({ year, month }, 1);
  const last = addDays(`${next.year}-${pad(next.month)}-01`, -1);
  const lead = (weekdayOf(first) - weekStartsOn + 7) % 7;
  const trail = (weekStartsOn + 6 - weekdayOf(last) + 7) % 7;
  const start = addDays(first, -lead);
  const total = lead + Number(last.slice(8)) + trail;
  const cells: MonthCell[] = Array.from({ length: total }, (_, index) => {
    const key = addDays(start, index);
    return { key, day: Number(key.slice(8)), inMonth: key.slice(0, 7) === first.slice(0, 7) };
  });
  return Array.from({ length: total / 7 }, (_, week) => cells.slice(week * 7, week * 7 + 7));
}

/** Regions whose calendars start the week on Sunday (used when `Intl` cannot tell). */
const SUNDAY_FIRST = new Set(['US', 'CA', 'BR', 'MX', 'JP', 'IL', 'PH', 'KR', 'TW', 'HK', 'IN']);

interface WeekInfo {
  firstDay?: number;
}

type LocaleWithWeekInfo = Intl.Locale & { getWeekInfo?: () => WeekInfo; weekInfo?: WeekInfo };

function weekStartOfTag(tag: string): number | undefined {
  try {
    const locale = new Intl.Locale(tag) as LocaleWithWeekInfo;
    const info = locale.getWeekInfo?.() ?? locale.weekInfo;
    if (info?.firstDay) return info.firstDay % 7;
    const region = locale.maximize().region;
    return region ? (SUNDAY_FIRST.has(region) ? 0 : 1) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The first day of the week (0 = Sunday, 1 = Monday) for the app language: the device's own
 * language tag when it is the same language (an English user in the UK starts on Monday), else
 * the app language's default region (English: the US, Portuguese: Brazil).
 */
export function firstDayOfWeek(appLocale: string, deviceLanguages: readonly string[] = []): number {
  const language = appLocale.split('-')[0]?.toLowerCase();
  const device = deviceLanguages.find((tag) => tag.split('-')[0]?.toLowerCase() === language);
  const fromDevice = device?.includes('-') ? weekStartOfTag(device) : undefined;
  return fromDevice ?? weekStartOfTag(appLocale) ?? 1;
}

/** The appointments of each local day, by start. */
export function appointmentsByDay(
  appointments: readonly Appointment[],
  timeZone?: string,
): Map<DayKey, Appointment[]> {
  const days = new Map<DayKey, Appointment[]>();
  for (const appointment of [...appointments].sort((a, b) =>
    a.startsAt.localeCompare(b.startsAt),
  )) {
    const key = dayKeyOf(appointment.startsAt, timeZone);
    days.set(key, [...(days.get(key) ?? []), appointment]);
  }
  return days;
}
