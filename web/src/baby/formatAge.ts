const MS_PER_DAY = 86_400_000;

const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** Local calendar date as a UTC midnight timestamp, so day counts ignore DST shifts. */
const dayStamp = (y: number, m: number, d: number) => Date.UTC(y, m, d);

const daysInMonth = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/** Whole calendar months from `birth` to `now` (`yyyy-mm-dd` parts), and the day stamp reached. */
function wholeMonths(by: number, bm: number, bd: number, now: Date) {
  const ny = now.getFullYear();
  const nm = now.getMonth();
  let months = (ny - by) * 12 + (nm - bm);
  if (now.getDate() < bd) months -= 1;
  months = Math.max(0, months);
  const anchorMonth = bm + months;
  const ay = by + Math.floor(anchorMonth / 12);
  const am = anchorMonth % 12;
  const anchor = dayStamp(ay, am, Math.min(bd, daysInMonth(ay, am)));
  return { months, anchor };
}

/**
 * Baby age line from the birth date (`yyyy-mm-dd`, a calendar date) and the local "now":
 * "11 days" (under 2 weeks), "5 weeks" (under 8 weeks), "2 months, 3 weeks" (under 12 months),
 * then "1 year, 2 months". Invalid or future dates read "0 days".
 */
export function formatAge(birthDate: string, now: Date): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDate);
  if (!match) return '0 days';
  const [by, bm, bd] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const today = dayStamp(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.max(0, Math.round((today - dayStamp(by, bm, bd)) / MS_PER_DAY));

  if (days < 14) return plural(days, 'day');
  if (days < 56) return plural(Math.floor(days / 7), 'week');

  const { months, anchor } = wholeMonths(by, bm, bd, now);
  if (months < 12) {
    const weeks = Math.floor(Math.max(0, today - anchor) / MS_PER_DAY / 7);
    return weeks > 0
      ? `${plural(months, 'month')}, ${plural(weeks, 'week')}`
      : plural(months, 'month');
  }
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return rest > 0 ? `${plural(years, 'year')}, ${plural(rest, 'month')}` : plural(years, 'year');
}
