/*
 * Birth is stored as its week (docs/design/46-privacy-first-onboarding.md section 2): the Monday
 * (ISO week start) on or before the date. Twin of C# `Lotties.Domain.Babies.BirthWeek`, both
 * checked against `birthWeekVectors.json`.
 */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The Monday on or before `date` (`yyyy-mm-dd`); an unreadable date comes back unchanged. */
export function mondayOf(date: string): string {
  const match = DATE.exec(date);
  if (!match) return date;
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const sinceMonday = (new Date(utc).getUTCDay() + 6) % 7;
  return new Date(utc - sinceMonday * 86_400_000).toISOString().slice(0, 10);
}
