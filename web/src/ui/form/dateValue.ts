/** Calendar dates travel as `yyyy-mm-dd` strings (no zone), like the API's `birthDate`/`date`. */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const pad = (n: number) => String(n).padStart(2, '0');

/** The local `Date` (at local midnight) of a `yyyy-mm-dd` string; `null` when blank or invalid. */
export function dateFromIso(value: string): Date | null {
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day);
  const valid =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  return valid ? date : null;
}

/** `yyyy-mm-dd` of the local calendar day of `date`; `''` for an invalid date. */
export function isoFromDate(date: Date | null): string {
  if (!date || Number.isNaN(date.getTime())) return '';
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
