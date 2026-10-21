import type { BabyEvent, EventPayload, EventType } from '../db/models';
import { getOwn } from '../util/ownProperty';
import type { EventFormState } from './formModel';
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
 * - `finish`: required fields are missing (or values invalid): ask for `fields` first.
 */
export type StopPlan =
  | { kind: 'stop' }
  | { kind: 'strip'; payload: EventPayload }
  | { kind: 'finish'; fields: string[] };

const askable = (problems: PayloadProblem[]) =>
  problems.filter((p) => p.code !== 'hidden').map((p) => p.field);

export function planStop(type: EventType | undefined, payload: EventPayload): StopPlan {
  if (!type) return { kind: 'stop' };
  const problems = validatePayload(type, payload, true);
  if (problems.length === 0) return { kind: 'stop' };
  const fields = askable(problems);
  if (fields.length === 0) return { kind: 'strip', payload: withoutHiddenValues(type, payload) };
  return { kind: 'finish', fields };
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
  return visibleFields(type.fields, (key) => getOwn(event.payload, key)).map((f) => f.key);
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
