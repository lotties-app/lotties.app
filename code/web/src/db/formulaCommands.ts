import type { BabyRoutineDb } from './database';
import type { Formula } from './models';
import { enqueueMutation } from './outbox';
import { toFormulaUpsertRequest } from '../sync/contract';
import type { CommandOptions } from './eventCommands';
import { FORMULA_LIMITS } from '../formulas/formulaModel';

/** The state a parent edits; ids, authorship and times are set by the commands. */
export type FormulaTerms = Pick<
  Formula,
  'name' | 'brand' | 'stage' | 'notes' | 'startedOn' | 'isCurrent' | 'archived'
>;

export class InvalidFormulaError extends Error {
  /** `name`: a name of 1-60 characters is required; `gone`: the formula is not on this device. */
  readonly code: 'name' | 'gone';

  constructor(message: string, code: 'name' | 'gone' = 'name') {
    super(message);
    this.name = 'InvalidFormulaError';
    this.code = code;
  }
}

export function formulaTermsOf(f: Formula): FormulaTerms {
  return {
    name: f.name,
    brand: f.brand,
    stage: f.stage,
    notes: f.notes,
    startedOn: f.startedOn,
    isCurrent: f.isCurrent,
    archived: f.archived,
  };
}

const optional = (value: string | null, max: number) => {
  const trimmed = value?.trim() ?? '';
  return trimmed === '' ? null : trimmed.slice(0, max);
};

/** Trimmed terms the server accepts: blank optional text is absent, an archived one is never current. */
function normalized(terms: FormulaTerms): FormulaTerms {
  const name = terms.name.trim();
  if (!name || name.length > FORMULA_LIMITS.name) {
    throw new InvalidFormulaError('A formula needs a name of 1 to 60 characters.');
  }
  return {
    name,
    brand: optional(terms.brand, FORMULA_LIMITS.brand),
    stage: optional(terms.stage, FORMULA_LIMITS.stage),
    notes: optional(terms.notes, FORMULA_LIMITS.notes),
    startedOn: terms.startedOn || null,
    isCurrent: terms.isCurrent && !terms.archived,
    archived: terms.archived,
  };
}

async function queueUpsert(db: BabyRoutineDb, f: Formula, now: string) {
  await enqueueMutation(db, {
    babyId: f.babyId,
    kind: 'upsert',
    entityType: 'formula',
    entityId: f.id,
    payload: toFormulaUpsertRequest(f),
    createdAt: now,
  });
}

/**
 * Adds a formula locally and queues its upsert (`PUT /babies/{id}/formulas/{id}`). Making it
 * current needs no change to the others: the server clears them and the delta brings them back.
 */
export async function createFormula(
  db: BabyRoutineDb,
  babyId: string,
  terms: FormulaTerms,
  options: CommandOptions = {},
): Promise<Formula> {
  const now = (options.now?.() ?? new Date()).toISOString();
  const formula: Formula = {
    ...normalized(terms),
    id: options.newId?.() ?? crypto.randomUUID(),
    babyId,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    clientUpdatedAt: now,
  };
  await db.transaction('rw', db.formulas, db.outbox, async () => {
    await db.formulas.put(formula);
    await queueUpsert(db, formula, now);
  });
  return formula;
}

/** Replaces the terms of a formula locally and queues its upsert. */
export async function updateFormula(
  db: BabyRoutineDb,
  id: string,
  terms: FormulaTerms,
  options: CommandOptions = {},
): Promise<Formula> {
  const now = (options.now?.() ?? new Date()).toISOString();
  return db.transaction('rw', db.formulas, db.outbox, async () => {
    const current = await db.formulas.get(id);
    if (!current) throw new InvalidFormulaError('This formula is not on this device.', 'gone');
    const updated: Formula = {
      ...current,
      ...normalized(terms),
      updatedAt: now,
      clientUpdatedAt: now,
    };
    await db.formulas.put(updated);
    await queueUpsert(db, updated, now);
    return updated;
  });
}

/** Changes one part of a formula's state (current, archived) and queues the full state. */
async function patchFormula(
  db: BabyRoutineDb,
  id: string,
  patch: Partial<FormulaTerms>,
  options: CommandOptions,
): Promise<Formula> {
  return db.transaction('rw', db.formulas, db.outbox, async () => {
    const current = await db.formulas.get(id);
    if (!current) throw new InvalidFormulaError('This formula is not on this device.', 'gone');
    return updateFormula(db, id, { ...formulaTermsOf(current), ...patch }, options);
  });
}

/** Makes the formula the baby's current one (an archived one is restored first). */
export function setCurrentFormula(db: BabyRoutineDb, id: string, options: CommandOptions = {}) {
  return patchFormula(db, id, { isCurrent: true, archived: false }, options);
}

/** Archives a formula (it stops being current) or restores it; bottles keep naming it either way. */
export function setFormulaArchived(
  db: BabyRoutineDb,
  id: string,
  archived: boolean,
  options: CommandOptions = {},
) {
  return patchFormula(db, id, archived ? { archived, isCurrent: false } : { archived }, options);
}
