import type { MedicationStatus } from '../medications/statusCalculator';

/*
 * The "Reminder for 18:00" line of a dose reminder opened from a notification. Decided from local
 * data only (the notification is never trusted for a time, a dose or a decision): the open slot
 * of the prescription, or the next one when it is within the longest lead time.
 */

const MINUTE_MS = 60_000;
/** The longest dose lead time a user can choose (15 min before the slot). */
export const MAX_DOSE_LEAD_MS = 15 * MINUTE_MS;

/** The slot the reminder is about, or `null` when the local data shows nothing open. */
export function reminderSlotAt(status: MedicationStatus, now: Date): Date | null {
  if (status.prescription.kind !== 'scheduled') return null;
  if (status.dayParts) return dayPartReminderAt(status, now);
  if (status.overdueByMinutes !== null) {
    const at = now.getTime() - status.overdueByMinutes * MINUTE_MS;
    return new Date(Math.floor(at / MINUTE_MS) * MINUTE_MS);
  }
  const next = status.nextScheduledAt;
  return next && next.getTime() - now.getTime() <= MAX_DOSE_LEAD_MS ? next : null;
}

/**
 * A part-of-the-day reminder: the reminder time of the open part when it has no dose yet and the
 * reminder is due (or within the longest lead time).
 */
function dayPartReminderAt(status: MedicationStatus, now: Date): Date | null {
  const current = status.dayParts?.current;
  const at = current?.state === 'due' ? current.reminderAt : null;
  return at && at.getTime() - now.getTime() <= MAX_DOSE_LEAD_MS ? at : null;
}
