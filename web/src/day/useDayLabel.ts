import { useTranslation } from 'react-i18next';
import { formatDate } from '../i18n/format';
import { addDays, isSameDay } from './dayModel';

/** `Today, Oct 21`, `Yesterday, Oct 20`, `Mon, Oct 19`. */
export function useDayLabel(day: Date, today: Date): string {
  const { t } = useTranslation();
  if (isSameDay(day, today)) {
    return t('day.relativeDate', {
      relative: t('timeline.today'),
      date: formatDate(day, 'dayMonth'),
    });
  }
  if (isSameDay(day, addDays(today, -1))) {
    return t('day.relativeDate', {
      relative: t('timeline.yesterday'),
      date: formatDate(day, 'dayMonth'),
    });
  }
  return formatDate(day, 'weekdayDayMonth');
}
