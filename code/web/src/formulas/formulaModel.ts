import type { BabyEvent, EventPayload, EventType, Formula } from '../db/models';
import { getOwn } from '../util/ownProperty';

/*
 * The baby's formulas on the device (docs/design/14-formulas.md), pure: which one is current, which
 * one a new bottle of formula preselects, and the payload members a bottle stores. Server rules
 * mirrored here: name 1-60 characters, at most one current formula, an archived one is never
 * current.
 */

export const FORMULA_LIMITS = { name: 60, brand: 60, stage: 10, notes: 1000 } as const;

/** Feeding payload members naming the formula of a bottle (hidden fields of the built-in type). */
export const FORMULA_ID_KEY = 'formula_id';
export const FORMULA_NAME_KEY = 'formula_name';
export const FORMULA_KEYS: readonly string[] = [FORMULA_ID_KEY, FORMULA_NAME_KEY];

const editTime = (f: Pick<Formula, 'clientUpdatedAt' | 'updatedAt'>) =>
  f.clientUpdatedAt ?? f.updatedAt;

/** Not archived, by name (the order of the chips and the settings list). */
export function activeFormulas(formulas: readonly Formula[]): Formula[] {
  return formulas
    .filter((f) => !f.archived)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/**
 * The baby's current formula: the one marked current and not archived. Should two be marked (a
 * pull has not brought the server's cleared copy yet) the newest edit wins, as on the server.
 */
export function currentFormula(formulas: readonly Formula[]): Formula | null {
  let best: Formula | null = null;
  for (const f of formulas) {
    if (!f.isCurrent || f.archived) continue;
    if (!best || editTime(f) > editTime(best)) best = f;
  }
  return best;
}

/** Whether a new formula should become the current one: the baby has none yet. */
export function shouldBecomeCurrent(formulas: readonly Formula[]): boolean {
  return currentFormula(formulas) === null;
}

/** The formula id a bottle names, if any. */
export function formulaIdOf(payload: EventPayload): string | null {
  const id = getOwn(payload, FORMULA_ID_KEY);
  return typeof id === 'string' && id !== '' ? id : null;
}

/** The formula of the newest bottle that names one still on the list (not archived). */
export function lastUsedFormula(
  formulas: readonly Formula[],
  events: readonly BabyEvent[],
  feedingTypeId?: string,
): Formula | null {
  const usable = new Map(activeFormulas(formulas).map((f) => [f.id, f]));
  let newest: { at: string; formula: Formula } | null = null;
  for (const event of events) {
    if (event.deletedAt !== null || (feedingTypeId && event.typeId !== feedingTypeId)) continue;
    const id = formulaIdOf(event.payload);
    const formula = id ? usable.get(id) : undefined;
    if (formula && (!newest || event.startedAt > newest.at)) {
      newest = { at: event.startedAt, formula };
    }
  }
  return newest?.formula ?? null;
}

/** What a new bottle of formula preselects: the current formula, else the last one used. */
export function defaultFormula(
  formulas: readonly Formula[],
  events: readonly BabyEvent[],
  feedingTypeId?: string,
): Formula | null {
  return currentFormula(formulas) ?? lastUsedFormula(formulas, events, feedingTypeId);
}

/** The payload members of a bottle of `formula` (the name is a snapshot for the history). */
export function formulaMembers(formula: Pick<Formula, 'id' | 'name'>): EventPayload {
  return { [FORMULA_ID_KEY]: formula.id, [FORMULA_NAME_KEY]: formula.name };
}

/** Whether the type is the built-in feeding type that declares the formula members. */
export function declaresFormula(type: Pick<EventType, 'babyId' | 'key' | 'fields'> | undefined) {
  return (
    !!type &&
    type.babyId === null &&
    type.key === 'feeding' &&
    type.fields.some((field) => field.key === FORMULA_ID_KEY)
  );
}

/** The name a bottle shows: its snapshot, else the formula's current name. */
export function bottleFormulaName(
  payload: EventPayload,
  formulas: readonly Formula[] = [],
): string | null {
  const snapshot = getOwn(payload, FORMULA_NAME_KEY);
  if (typeof snapshot === 'string' && snapshot.trim() !== '') return snapshot;
  const id = formulaIdOf(payload);
  return (id && formulas.find((f) => f.id === id)?.name) || null;
}
