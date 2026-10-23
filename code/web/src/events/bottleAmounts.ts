import type { EventPayload } from '../db/models';
import { getOwn, withoutOwn } from '../util/ownProperty';

/*
 * The two amounts of a bottle (docs/design/20-feeding-amounts.md): `amount_ml` is what was
 * prepared, `amount_drunk_ml` what the baby drank. Totals, insights, the formula comparison, the
 * bottle suggestions and the daily summaries read the DRUNK amount (`drunkMl`); a bottle without a
 * drunk value (every bottle logged before it existed, or one that was finished entirely) counts as
 * fully drunk, so old data keeps its totals.
 */

export const PREPARED_KEY = 'amount_ml';
export const DRUNK_KEY = 'amount_drunk_ml';
/** Hidden feeding field: `sleep` when a starting sleep stopped the timer. */
export const ENDED_BY_KEY = 'ended_by';
export const ENDED_BY_SLEEP = 'sleep';

/** Rounding step of the drunk quick choices (ml). */
const CHOICE_STEP_ML = 5;

const finiteAmount = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;

/** What was prepared (ml), or `undefined` when the payload has no valid amount. */
export function preparedMl(payload: EventPayload): number | undefined {
  return finiteAmount(getOwn(payload, PREPARED_KEY));
}

/**
 * What the baby drank (ml): the drunk amount (never above the prepared one), else the prepared
 * amount (fully drunk); `undefined` when the payload has neither.
 */
export function drunkMl(payload: EventPayload): number | undefined {
  const prepared = preparedMl(payload);
  const drunk = finiteAmount(getOwn(payload, DRUNK_KEY));
  if (drunk === undefined) return prepared;
  return prepared === undefined ? drunk : Math.min(drunk, prepared);
}

/** How much of the prepared amount was not drunk (ml; 0 when all was, or an amount is missing). */
export function leftOverMl(payload: EventPayload): number {
  const prepared = preparedMl(payload);
  const drunk = drunkMl(payload);
  return prepared !== undefined && drunk !== undefined ? Math.max(0, prepared - drunk) : 0;
}

/** `payload` without a drunk amount equal to (or above) the prepared one: "all" is stored as nothing. */
export function withoutRedundantDrunk(payload: EventPayload): EventPayload {
  const prepared = preparedMl(payload);
  const drunk = finiteAmount(getOwn(payload, DRUNK_KEY));
  if (drunk === undefined || prepared === undefined || drunk < prepared) return payload;
  return withoutOwn<unknown>(payload, DRUNK_KEY);
}

export type DrunkShare = 'all' | 'threeQuarters' | 'half' | 'quarter';

export interface DrunkChoice {
  ml: number;
  share: DrunkShare;
}

const SHARES: readonly { share: DrunkShare; factor: number }[] = [
  { share: 'all', factor: 1 },
  { share: 'threeQuarters', factor: 0.75 },
  { share: 'half', factor: 0.5 },
  { share: 'quarter', factor: 0.25 },
];

/**
 * The quick choices for what was drunk of `preparedMl`: all, 3/4, half and 1/4, rounded to 5 ml
 * (all is exact), ascending, each amount once (the larger share keeps it) and never zero.
 */
export function drunkChoices(preparedMl: number | null | undefined): DrunkChoice[] {
  if (preparedMl == null || !Number.isFinite(preparedMl) || preparedMl <= 0) return [];
  const choices: DrunkChoice[] = [];
  for (const { share, factor } of SHARES) {
    const ml =
      share === 'all'
        ? preparedMl
        : Math.min(preparedMl, Math.round((preparedMl * factor) / CHOICE_STEP_ML) * CHOICE_STEP_ML);
    if (ml > 0 && !choices.some((c) => c.ml === ml)) choices.push({ ml, share });
  }
  return choices.sort((a, b) => a.ml - b.ml);
}
