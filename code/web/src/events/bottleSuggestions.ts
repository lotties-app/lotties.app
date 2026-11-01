import { ageInDaysAt, type AgeNormSet } from '../ageNorms/ageNorms';
import type { BabyEvent } from '../db/models';
import { getOwn } from '../util/ownProperty';
import { drunkMl } from './bottleAmounts';
import {
  ageInMonths,
  ageRangeFor,
  NEUTRAL_BOTTLE_AMOUNTS,
  normBottleRange,
  rangeChips,
} from './bottleAgeDefaults';

/*
 * Bottle amount chips that follow the baby (docs/design/10-bottle-suggestions.md, phase 1): from
 * the baby's own recent bottles when there are enough, else from the published formula volume for
 * the baby's age or the static age table (bottleAgeDefaults.ts), else a neutral spread. Pure, offline, nothing leaves the device.
 */

/** The stepper's step and the rounding of history amounts. */
export const BOTTLE_STEP_ML = 10;
/** Only bottles started this recently count. */
export const HISTORY_DAYS = 30;
/** At most this many of the newest bottles count. */
export const HISTORY_LIMIT = 20;
/** The typical amount is the median of this many newest bottles. */
export const TYPICAL_OF = 7;
/** Fewer bottles than this: cold start (age table or neutral set). */
export const MIN_HISTORY = 3;
/** Never more chips than this. */
export const MAX_CHIPS = 5;
/** "Asks for more": the typical amount topped up by these (shown as totals). */
export const TOP_UPS_ML: readonly number[] = [30, 60];
/** Most frequent distinct amounts offered. */
const FREQUENT_COUNT = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

export type BottleSuggestionSource = 'history' | 'age' | 'neutral';

export interface BottleSuggestions {
  /** Chip amounts (ml), ascending, distinct, positive, at most `MAX_CHIPS`. */
  amounts: number[];
  /** The stepper's step (ml). */
  step: number;
  /** Where the chips come from: own history, the age table, or the neutral set. */
  source: BottleSuggestionSource;
  /** Whole months of age behind `source: 'age'`; `null` otherwise. */
  ageMonths: number | null;
  /** The published norm behind `source: 'age'` (docs/design/28-age-norms.md); `null` for the month table. */
  ageNormId: string | null;
  /** A neutral starting amount: the typical one, or the middle chip of the cold-start set. */
  preferred: number;
}

export interface BottleSuggestionInput {
  /** The baby's events, any order (other types and methods are ignored). */
  events: readonly BabyEvent[];
  /** The feeding type's id; when given, other types are ignored. */
  feedingTypeId?: string;
  /** The baby's birth date (`yyyy-mm-dd`). */
  birthDate?: string | null;
  /** The published age norms on the device; without them the month table is used. */
  ageNorms?: AgeNormSet | null;
  now: Date;
  /** The amount field's bounds. */
  min?: number | null;
  max?: number | null;
  /** An amount that must be a chip (the last or remembered one), kept as is. */
  include?: number | null;
}

/** Bottle amounts of the last `HISTORY_DAYS`, newest first, at most `HISTORY_LIMIT`. */
export function recentBottleAmounts(
  events: readonly BabyEvent[],
  now: Date,
  feedingTypeId?: string,
): number[] {
  const to = now.toISOString();
  const from = new Date(now.getTime() - HISTORY_DAYS * DAY_MS).toISOString();
  return events
    .filter(
      (e) =>
        e.deletedAt === null &&
        (feedingTypeId === undefined || e.typeId === feedingTypeId) &&
        e.startedAt >= from &&
        e.startedAt <= to &&
        getOwn(e.payload, 'method') === 'bottle' &&
        amountOf(e) !== null,
    )
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, HISTORY_LIMIT)
    .map((e) => amountOf(e) as number);
}

function amountOf(event: BabyEvent): number | null {
  const value = drunkMl(event.payload);
  return value !== undefined && value > 0 ? value : null;
}

/** `value` rounded to the nearest `BOTTLE_STEP_ML`. */
export const roundToStep = (value: number): number =>
  Math.round(value / BOTTLE_STEP_ML) * BOTTLE_STEP_ML;

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * The most frequent distinct amounts (rounded to the step), most frequent first; ties go to the
 * most recent. `amounts` is newest first.
 */
export function frequentAmounts(amounts: readonly number[], count = FREQUENT_COUNT): number[] {
  const tally = new Map<number, { hits: number; firstSeen: number }>();
  amounts.forEach((amount, index) => {
    const key = roundToStep(amount);
    const entry = tally.get(key);
    if (entry) entry.hits += 1;
    else tally.set(key, { hits: 1, firstSeen: index });
  });
  return [...tally.entries()]
    .sort(([, a], [, b]) => b.hits - a.hits || a.firstSeen - b.firstSeen)
    .slice(0, count)
    .map(([amount]) => amount);
}

/** The first `MAX_CHIPS` usable candidates (in priority order), ascending. */
function pick(candidates: readonly number[], min?: number | null, max?: number | null): number[] {
  const chosen: number[] = [];
  for (const amount of candidates) {
    if (chosen.length >= MAX_CHIPS) break;
    if (!Number.isFinite(amount) || amount <= 0) continue;
    if ((min != null && amount < min) || (max != null && amount > max)) continue;
    if (!chosen.includes(amount)) chosen.push(amount);
  }
  return chosen.sort((a, b) => a - b);
}

const middleOf = (values: readonly number[]) => values[Math.floor((values.length - 1) / 2)];

/**
 * The bottle chips for a baby. History (at least `MIN_HISTORY` bottles): the typical amount
 * (median of the newest `TYPICAL_OF`, rounded to 10 ml), the typical amount topped up (+30, +60)
 * and the most frequent amounts. Cold start: the chips of the published range for the age (a
 * usable norm only), else of the age table, or the neutral set without a birth date. `include` always comes first; then candidates are kept in priority order up to
 * `MAX_CHIPS` and sorted ascending.
 */
export function bottleSuggestions(input: BottleSuggestionInput): BottleSuggestions {
  const { min, max, now } = input;
  const include = input.include != null ? [input.include] : [];
  const amounts = recentBottleAmounts(input.events, now, input.feedingTypeId);

  if (amounts.length >= MIN_HISTORY) {
    const typical = roundToStep(median(amounts.slice(0, TYPICAL_OF)) as number);
    const candidates = [
      ...include,
      typical,
      ...TOP_UPS_ML.map((extra) => typical + extra),
      ...frequentAmounts(amounts),
    ];
    return {
      amounts: pick(candidates, min, max),
      step: BOTTLE_STEP_ML,
      source: 'history',
      ageMonths: null,
      ageNormId: null,
      preferred: typical,
    };
  }

  const months = ageInMonths(input.birthDate, now);
  const fromNorm =
    months === null ? null : normBottleRange(input.ageNorms, ageInDaysAt(input.birthDate, now));
  const base =
    months === null ? [...NEUTRAL_BOTTLE_AMOUNTS] : rangeChips(fromNorm ?? ageRangeFor(months));
  return {
    amounts: pick([...include, ...base], min, max),
    step: BOTTLE_STEP_ML,
    source: months === null ? 'neutral' : 'age',
    ageMonths: months,
    ageNormId: fromNorm?.normId ?? null,
    preferred: middleOf(base),
  };
}
