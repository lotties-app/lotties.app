import type { BabyEvent, EventPayload, EventType } from '../db/models';
import { getOwn, setOwn } from '../util/ownProperty';
import type { EventFormState } from './formModel';
import { FORMULA_KEYS } from '../formulas/formulaModel';
import { DRUNK_KEY, PREPARED_KEY } from './bottleAmounts';
import { lastUsedFor } from './lastUsedValues';
import {
  isComplete,
  validatePayload,
  visibleFields,
  withoutHiddenValues,
  type PayloadProblem,
} from './payloadRules';

/**
 * What stopping a running timer takes, checked with the same rules as the server (a stop the
 * server rejects would dead-letter and leave the timer running there):
 * - `stop`: the payload is complete, stop now;
 * - `strip`: only values of hidden fields are wrong, stop with them removed;
 * - `finish`: required fields are missing (or values invalid): ask for `fields` first; also for
 *   optional details that are only known at the end (a bottle's amount, see `askedAtStop`), which
 *   the sheet lets the parent leave empty.
 */
export type StopPlan =
  | { kind: 'stop' }
  | { kind: 'strip'; payload: EventPayload }
  | { kind: 'finish'; fields: string[] };

const askable = (problems: PayloadProblem[]) =>
  problems.filter((p) => p.code !== 'hidden').map((p) => p.field);

/**
 * Optional fields of a built-in type worth asking when its timer stops, because they are only known
 * then: how much was prepared and how much of it was drunk (and what was in it: the content and,
 * for formula, which one). Asked until both amounts are set; none of them is required, so the stop
 * never depends on them.
 */
function askedAtStop(type: EventType, payload: EventPayload): string[] {
  if (type.babyId !== null || type.key !== 'feeding') return [];
  if (
    getOwn(payload, 'method') !== 'bottle' ||
    (getOwn(payload, PREPARED_KEY) !== undefined && getOwn(payload, DRUNK_KEY) !== undefined)
  ) {
    return [];
  }
  const declared = new Set(type.fields.map((f) => f.key));
  return [PREPARED_KEY, DRUNK_KEY, 'bottle_feeding_type', ...FORMULA_KEYS].filter((key) =>
    declared.has(key),
  );
}

export function planStop(type: EventType | undefined, payload: EventPayload): StopPlan {
  if (!type) return { kind: 'stop' };
  const problems = validatePayload(type, payload, true);
  const fields = askable(problems);
  if (fields.length > 0) return { kind: 'finish', fields };
  const asked: string[] = askedAtStop(type, payload);
  // The finish sheet drops the values of hidden fields itself (as `strip` does).
  if (asked.length > 0) return { kind: 'finish', fields: asked };
  if (problems.length === 0) return { kind: 'stop' };
  return { kind: 'strip', payload: withoutHiddenValues(type, payload) };
}

/**
 * `stored` with only `fields` taken from `built`, and only where `stored` had no value (absent,
 * `null` or `''`): what a Caregiver's "Finish this ..." on someone else's timer may save.
 */
export function fillEmptyFields(
  stored: EventPayload,
  built: EventPayload,
  fields: readonly string[],
): EventPayload {
  const next: EventPayload = { ...stored };
  for (const key of fields) {
    const before = getOwn(stored, key);
    const value = getOwn(built, key);
    if ((before === undefined || before === null || before === '') && value !== undefined) {
      setOwn<unknown>(next, key, value);
    }
  }
  return next;
}

/**
 * Fields the Fix action of a rejected change asks for: what the local rules find wrong, plus the
 * field the server named; every visible field when neither names one (the rules disagree).
 */
export function fixFields(type: EventType, event: BabyEvent, rejectedField?: string | null) {
  const fields = askable(validatePayload(type, event.payload, isComplete(type, event.endedAt)));
  if (rejectedField && type.fields.some((f) => f.key === rejectedField)) {
    if (!fields.includes(rejectedField)) fields.push(rejectedField);
  }
  if (fields.length > 0) return fields;
  return visibleFields(type.fields, (key) => getOwn(event.payload, key))
    .filter((f) => f.hidden !== true)
    .map((f) => f.key);
}

/** Remembered values of `fields`, as form values (numbers become text, as typed). */
export function rememberedFormValues(
  type: EventType,
  fields: readonly string[],
  remembered: Record<string, string | number | boolean>,
): EventFormState['values'] {
  const definitions = type.fields.filter((f) => fields.includes(f.key));
  const values: EventFormState['values'] = {};
  for (const [key, value] of Object.entries(lastUsedFor(remembered, definitions))) {
    Object.defineProperty(values, key, {
      value: typeof value === 'number' ? String(value) : value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return values;
}
