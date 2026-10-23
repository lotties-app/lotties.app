import { currentLocale, t } from './i18n';
import type { Locale } from './config';

/**
 * Locale-aware formatting through `Intl`, with the active UI language as the default. Pass
 * `locale` explicitly to format for another language (tests, previews). Components that call
 * these must also use `useTranslation()` so they re-render when the language changes.
 */

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

const cache = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat | Intl.RelativeTimeFormat>();

function cached<T extends Intl.DateTimeFormat | Intl.NumberFormat | Intl.RelativeTimeFormat>(
  key: string,
  create: () => T,
): T {
  let formatter = cache.get(key) as T | undefined;
  if (!formatter) {
    formatter = create();
    cache.set(key, formatter);
  }
  return formatter;
}

const toDate = (value: Date | string | number) => (value instanceof Date ? value : new Date(value));

/** `14:20`: 24-hour clock in every supported language. */
export function formatTime(value: Date | string | number, locale: Locale = currentLocale()) {
  const format = cached(
    `time|${locale}`,
    () => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
  );
  return format.format(toDate(value));
}

export type DateStyle =
  | 'dayMonth'
  | 'weekdayDayMonth'
  | 'dayMonthYear'
  | 'weekdayNarrow'
  | 'dayNumber'
  | 'monthYear'
  | 'weekdayLong';

const DATE_OPTIONS: Record<DateStyle, Intl.DateTimeFormatOptions> = {
  dayMonth: { day: 'numeric', month: 'short' },
  weekdayDayMonth: { weekday: 'short', day: 'numeric', month: 'short' },
  dayMonthYear: { day: 'numeric', month: 'short', year: 'numeric' },
  weekdayNarrow: { weekday: 'narrow' },
  dayNumber: { day: 'numeric' },
  monthYear: { month: 'long', year: 'numeric' },
  weekdayLong: { weekday: 'long', day: 'numeric', month: 'long' },
};

/** `yyyy-mm-dd` strings are calendar dates (no zone): they are formatted as UTC midnight. */
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A date in the viewer's locale and zone; calendar dates (`yyyy-mm-dd`) never shift zone. */
export function formatDate(
  value: Date | string | number,
  style: DateStyle = 'dayMonthYear',
  locale: Locale = currentLocale(),
) {
  const calendar = typeof value === 'string' && CALENDAR_DATE.test(value);
  const format = cached(
    `date|${locale}|${style}|${calendar}`,
    () =>
      new Intl.DateTimeFormat(locale, {
        ...DATE_OPTIONS[style],
        ...(calendar ? { timeZone: 'UTC' } : {}),
      }),
  );
  return format.format(calendar ? new Date(`${value}T00:00:00Z`) : toDate(value));
}

export function formatDateTime(value: Date | string | number, locale: Locale = currentLocale()) {
  const format = cached(
    `datetime|${locale}`,
    () =>
      new Intl.DateTimeFormat(locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
  );
  return format.format(toDate(value));
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Rounded to whole minutes: `45m`, `1h`, `2h 05m` (en); `45 min`, `1 h`, `2 h 05 min` (pt-BR).
 * Unit labels come from the catalog (`Intl.DurationFormat` is not available everywhere yet).
 */
export function formatDuration(ms: number, locale: Locale = currentLocale()) {
  const minutes = Math.max(0, Math.round(ms / MS_PER_MINUTE));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return t('format.durationM', { m, lng: locale });
  if (m === 0) return t('format.durationH', { h, lng: locale });
  return t('format.durationHM', { h, m: pad(m), lng: locale });
}

/**
 * Tight variant of `formatDuration` for small tiles: `9h 36min` (pt-BR) instead of `9 h 36 min`,
 * so a value fits one line. Same rounding; the English form equals `formatDuration`.
 */
export function formatDurationCompact(ms: number, locale: Locale = currentLocale()) {
  const minutes = Math.max(0, Math.round(ms / MS_PER_MINUTE));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return t('format.durationCompactM', { m, lng: locale });
  if (m === 0) return t('format.durationCompactH', { h, lng: locale });
  return t('format.durationCompactHM', { h, m: pad(m), lng: locale });
}

/** `in 24 minutes` / `em 24 minutos`; hours from 60 minutes on, days from 24 hours. */
export function formatRelative(
  targetMs: number,
  nowMs: number,
  locale: Locale = currentLocale(),
): string {
  const format = cached(
    `relative|${locale}`,
    () => new Intl.RelativeTimeFormat(locale, { numeric: 'auto', style: 'long' }),
  );
  const minutes = Math.round((targetMs - nowMs) / MS_PER_MINUTE);
  if (Math.abs(minutes) < 60) return format.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return format.format(hours, 'hour');
  return format.format(Math.round((targetMs - nowMs) / MS_PER_DAY), 'day');
}

export function formatNumber(
  value: number,
  options?: Intl.NumberFormatOptions,
  locale: Locale = currentLocale(),
) {
  const key = `number|${locale}|${options ? JSON.stringify(options) : ''}`;
  return cached(key, () => new Intl.NumberFormat(locale, options)).format(value);
}

export type MeasureUnit = 'kilogram' | 'centimeter' | 'milliliter';

/** `7,5 kg` / `7.5 kg`: a number with a metric unit. */
export function formatUnit(value: number, unit: MeasureUnit, locale: Locale = currentLocale()) {
  return formatNumber(value, { style: 'unit', unit, unitDisplay: 'short' }, locale);
}

/** `A, B and C` / `A, B e C`. */
export function formatList(
  items: readonly string[],
  type: Intl.ListFormatType = 'conjunction',
  locale: Locale = currentLocale(),
) {
  return new Intl.ListFormat(locale, { style: 'long', type }).format(items);
}

const MS_PER_WEEK = 7 * MS_PER_DAY;

/** Local calendar date as a UTC midnight timestamp, so day counts ignore DST shifts. */
const dayStamp = (y: number, m: number, d: number) => Date.UTC(y, m, d);

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** Whole calendar months from the birth date to `now`, and the day stamp reached. */
function wholeMonths(by: number, bm: number, bd: number, now: Date) {
  let months = (now.getFullYear() - by) * 12 + (now.getMonth() - bm);
  if (now.getDate() < bd) months -= 1;
  months = Math.max(0, months);
  const anchorMonth = bm + months;
  const ay = by + Math.floor(anchorMonth / 12);
  const am = anchorMonth % 12;
  return { months, anchor: dayStamp(ay, am, Math.min(bd, daysInMonth(ay, am))) };
}

/**
 * Baby age line from the birth date (`yyyy-mm-dd`, a calendar date) and the local "now":
 * "11 days" (under 2 weeks), "5 weeks" (under 8 weeks), "2 months, 3 weeks" (under 12 months),
 * then "1 year, 2 months". Invalid or future dates read "0 days".
 */
export function formatAge(birthDate: string, now: Date, locale: Locale = currentLocale()): string {
  const lng = locale;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDate);
  if (!match) return t('age.day', { count: 0, lng });
  const [by, bm, bd] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const today = dayStamp(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.max(0, Math.round((today - dayStamp(by, bm, bd)) / MS_PER_DAY));

  if (days < 14) return t('age.day', { count: days, lng });
  if (days < 56) return t('age.week', { count: Math.floor(days / 7), lng });

  const { months, anchor } = wholeMonths(by, bm, bd, now);
  if (months < 12) {
    const weeks = Math.floor(Math.max(0, today - anchor) / MS_PER_WEEK);
    const monthsText = t('age.month', { count: months, lng });
    return weeks > 0
      ? t('age.join', { first: monthsText, second: t('age.week', { count: weeks, lng }), lng })
      : monthsText;
  }
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const yearsText = t('age.year', { count: years, lng });
  return rest > 0
    ? t('age.join', { first: yearsText, second: t('age.month', { count: rest, lng }), lng })
    : yearsText;
}
