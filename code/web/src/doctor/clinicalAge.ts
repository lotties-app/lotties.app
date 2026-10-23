import type { Locale } from '../i18n/config';
import { currentLocale, t } from '../i18n/i18n';

const MS_PER_DAY = 86_400_000;

/** Local calendar date as a UTC midnight stamp, so day counts ignore DST shifts. */
const stamp = (y: number, m: number, d: number) => Date.UTC(y, m, d);
const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** Whole months and the days after the last monthly anniversary, from a `yyyy-mm-dd` birth date. */
export function monthsAndDays(birthDate: string, now: Date): { months: number; days: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDate);
  if (!match) return { months: 0, days: 0 };
  const [by, bm, bd] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const today = stamp(now.getFullYear(), now.getMonth(), now.getDate());
  if (today < stamp(by, bm, bd)) return { months: 0, days: 0 };
  let months = (now.getFullYear() - by) * 12 + (now.getMonth() - bm);
  if (now.getDate() < Math.min(bd, daysInMonth(now.getFullYear(), now.getMonth()))) months -= 1;
  months = Math.max(0, months);
  const anchorMonth = bm + months;
  const ay = by + Math.floor(anchorMonth / 12);
  const am = anchorMonth % 12;
  const anchor = stamp(ay, am, Math.min(bd, daysInMonth(ay, am)));
  return { months, days: Math.max(0, Math.round((today - anchor) / MS_PER_DAY)) };
}

/**
 * The age a clinician reads (docs/design/19-doctor-dashboard.md): "2 months, 3 days"; "12 days"
 * under a month; "2 months" on a monthly anniversary.
 */
export function clinicalAge(birthDate: string, now: Date, locale: Locale = currentLocale()) {
  const { months, days } = monthsAndDays(birthDate, now);
  const lng = locale;
  const dayText = t('age.day', { count: days, lng });
  if (months === 0) return dayText;
  const monthText = t('age.month', { count: months, lng });
  return days === 0 ? monthText : t('age.join', { first: monthText, second: dayText, lng });
}
