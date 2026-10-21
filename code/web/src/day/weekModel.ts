import { addDays, startOfDay } from './dayModel';

/*
 * Pure model of the Day week strip: which seven days it shows and how it moves. Days are local
 * calendar days (`Date` setters, so DST safe).
 */

/** 1 = Monday ... 7 = Sunday, as `Intl.Locale` week info reports it. */
export type FirstDay = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** The first day of the week in `locale` (Sunday for en-US and pt-BR), Monday when unknown. */
export function firstWeekday(locale: string): FirstDay {
  try {
    const intlLocale = new Intl.Locale(locale) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const info = intlLocale.getWeekInfo?.() ?? intlLocale.weekInfo;
    const first = info?.firstDay;
    if (typeof first === 'number' && first >= 1 && first <= 7) return first as FirstDay;
  } catch {
    // Unknown locale: fall through.
  }
  return 1;
}

/** The first day of the week that contains `day`, at 00:00. */
export function weekStart(day: Date, firstDay: FirstDay): Date {
  const iso = day.getDay() === 0 ? 7 : day.getDay();
  return addDays(startOfDay(day), -((iso - firstDay + 7) % 7));
}

/** The seven days of the week that contains `day`. */
export function weekDays(day: Date, firstDay: FirstDay): Date[] {
  const start = weekStart(day, firstDay);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

/**
 * Where a week jump lands: the same weekday one week away, but never after `today` (there is no
 * later day to look at).
 */
export function jumpWeek(day: Date, weeks: number, today: Date): Date {
  const target = addDays(day, weeks * 7);
  return target.getTime() > startOfDay(today).getTime() ? startOfDay(today) : target;
}
