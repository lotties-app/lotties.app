/*
 * Cold-start bottle amounts by age (docs/design/10-bottle-suggestions.md): used only until the baby
 * has a few bottles of their own. Typical ranges, not medical advice, review with the pediatrician.
 * The values are informational chips, never a target: the stepper stays free entry.
 */

export interface BottleAgeRange {
  /** First whole month of age the row applies to (until the next row's month). */
  fromMonths: number;
  minMl: number;
  maxMl: number;
}

/** Typical per-feed ranges (ml) by whole months of age; typical ranges, not medical advice. */
export const BOTTLE_AGE_RANGES: readonly BottleAgeRange[] = [
  { fromMonths: 0, minMl: 30, maxMl: 90 },
  { fromMonths: 1, minMl: 90, maxMl: 120 },
  { fromMonths: 2, minMl: 120, maxMl: 150 },
  { fromMonths: 3, minMl: 120, maxMl: 180 },
  { fromMonths: 4, minMl: 160, maxMl: 200 },
  { fromMonths: 5, minMl: 180, maxMl: 240 },
  { fromMonths: 7, minMl: 180, maxMl: 240 },
];

/** Without a birth date: a neutral spread, nothing said about age. */
export const NEUTRAL_BOTTLE_AMOUNTS: readonly number[] = [60, 90, 120, 150, 180];

/** Chips inside a range step by this much. */
export const AGE_CHIP_STEP_ML = 30;
/** The range's top is added as its own chip only when this far from the last step. */
const TOP_MIN_GAP_ML = 20;

/**
 * Whole calendar months from `birthDate` (`yyyy-mm-dd`) to the local `now`; `null` when the date
 * is missing, malformed or in the future.
 */
export function ageInMonths(birthDate: string | null | undefined, now: Date): number | null {
  const match = birthDate ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate) : null;
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const birth = new Date(year, month, day);
  if (birth.getMonth() !== month || birth.getTime() > now.getTime()) return null;
  let months = (now.getFullYear() - year) * 12 + (now.getMonth() - month);
  if (now.getDate() < day) months -= 1;
  return Math.max(0, months);
}

/** The table row for `months` of age. */
export function ageRangeFor(months: number): BottleAgeRange {
  let row = BOTTLE_AGE_RANGES[0];
  for (const candidate of BOTTLE_AGE_RANGES) if (months >= candidate.fromMonths) row = candidate;
  return row;
}

/** Chips inside a range: from its bottom at 30 ml steps, plus its top when it is not too close. */
export function rangeChips({ minMl, maxMl }: Pick<BottleAgeRange, 'minMl' | 'maxMl'>): number[] {
  const chips: number[] = [];
  for (let ml = minMl; ml <= maxMl; ml += AGE_CHIP_STEP_ML) chips.push(ml);
  const top = chips[chips.length - 1];
  if (top !== undefined && maxMl - top >= TOP_MIN_GAP_ML) chips.push(maxMl);
  return chips;
}
