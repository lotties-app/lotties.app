import type { TFunction } from 'i18next';
import type { Appointment, AppointmentType, ReminderOffset } from '../db/models';
import { formatDate, formatList, formatTime } from '../i18n/format';
import type { IconName } from '../ui/icons';

/** The icon of each appointment type (also on its type chip). */
export const TYPE_ICON: Readonly<Record<AppointmentType, IconName>> = {
  consultation: 'stethoscope',
  vaccine: 'vaccine',
  exam: 'microscope',
  other: 'calendar',
};

/** "Tue, 3 Mar · 15:30" or, with a duration, "Tue, 3 Mar · 15:30–16:00" (device zone). */
export function whenLine(a: Pick<Appointment, 'startsAt' | 'durationMinutes'>): string {
  const day = formatDate(a.startsAt, 'weekdayDayMonth');
  const start = formatTime(a.startsAt);
  if (a.durationMinutes === null) return `${day} · ${start}`;
  const end = formatTime(Date.parse(a.startsAt) + a.durationMinutes * 60_000);
  return `${day} · ${start}–${end}`;
}

/** "1 day and 2 hours before" from the reminder chips' labels; `null` without reminders. */
export function remindersLine(t: TFunction, offsets: readonly ReminderOffset[]): string | null {
  if (offsets.length === 0) return null;
  const labels = offsets.map((offset) => t(`appointments.reminders.${offset}`));
  return t('appointments.detail.remindersBefore', { list: formatList(labels) });
}
