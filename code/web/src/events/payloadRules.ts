import type { EventFieldDefinition, EventPayload, EventType } from '../db/models';
import { getOwn, setOwn } from '../util/ownProperty';

/*
 * Client mirror of the API's payload field rules (docs/SPEC.md "Payload field rules",
 * `EventPayloadFieldRules` in the Domain). Keep the two in sync: anything this accepts the server
 * must accept, or the change dead-letters.
 */

export type PayloadProblemCode =
  /** A visible required field has no value on a complete event. */
  | 'required'
  /** A value was sent for a field whose `visibleWhen` is not met. */
  | 'hidden'
  | 'text'
  | 'number'
  /** A whole number was required (`integer` fields). */
  | 'integer'
  /** Too many decimal places (`decimals` fields). */
  | 'decimals'
  | 'option'
  | 'bool'
  | 'min'
  | 'max';

export interface PayloadProblem {
  field: string;
  code: PayloadProblemCode;
}

/** Reads a field's raw value; `undefined`, `null` and `''` mean "no value". */
export type ValueOf = (key: string) => unknown;

const hasValue = (raw: unknown) => raw !== undefined && raw !== null && raw !== '';

/** First definition per key (the API ignores later duplicates). */
function byKey(fields: readonly EventFieldDefinition[]): Map<string, EventFieldDefinition> {
  const map = new Map<string, EventFieldDefinition>();
  for (const field of fields) if (!map.has(field.key)) map.set(field.key, field);
  return map;
}

function isVisibleIn(
  fields: Map<string, EventFieldDefinition>,
  field: EventFieldDefinition,
  valueOf: ValueOf,
  remainingSteps: number,
): boolean {
  const condition = field.visibleWhen;
  const controller = condition ? fields.get(condition.field) : undefined;
  // A condition naming no field of the type hides nothing (as on the server).
  if (!condition || !controller) return true;
  if (remainingSteps <= 0) return false;
  const selected = valueOf(controller.key);
  return (
    typeof selected === 'string' &&
    selected !== '' &&
    condition.equals.includes(selected) &&
    isVisibleIn(fields, controller, valueOf, remainingSteps - 1)
  );
}

/**
 * Whether `field` is shown given the current values: its `visibleWhen` select holds one of the
 * listed options and that select is visible itself. Bounded, so even a cyclic definition ends.
 */
export function isFieldVisible(
  fields: readonly EventFieldDefinition[],
  field: EventFieldDefinition,
  valueOf: ValueOf,
): boolean {
  const map = byKey(fields);
  return isVisibleIn(map, field, valueOf, map.size);
}

/** The fields shown for the given values, in definition order. */
export function visibleFields(
  fields: readonly EventFieldDefinition[],
  valueOf: ValueOf,
): EventFieldDefinition[] {
  const map = byKey(fields);
  return fields.filter((field) => isVisibleIn(map, field, valueOf, map.size));
}

function kindProblem(field: EventFieldDefinition, value: unknown): PayloadProblemCode | null {
  switch (field.kind) {
    case 'text':
      return typeof value === 'string' ? null : 'text';
    case 'bool':
      return typeof value === 'boolean' ? null : 'bool';
    case 'select':
      return typeof value === 'string' && field.options.includes(value) ? null : 'option';
    case 'number':
      if (typeof value !== 'number' || Number.isNaN(value)) return 'number';
      if (field.integer === true && !Number.isInteger(value)) return 'integer';
      if (!withinDecimals(field, value)) return 'decimals';
      if (field.min !== null && value < field.min) return 'min';
      if (field.max !== null && value > field.max) return 'max';
      return null;
  }
}

/** Whether `value` has no more decimal places than the field's `decimals` allows (any when unset). */
export function withinDecimals(
  field: Pick<EventFieldDefinition, 'decimals'>,
  value: number,
): boolean {
  return field.decimals === undefined || Number(value.toFixed(field.decimals)) === value;
}

const payloadValue = (payload: EventPayload) => (key: string) => getOwn(payload, key);

/**
 * Problems the server would report for `payload` (400 `validation_failed`), in field order.
 * `completing`: the event is complete (an instant type, or a timer being stopped / already
 * stopped); only then are visible required fields enforced (a required bool may be absent).
 * Members no field declares are not checked (e.g. the medication list).
 */
export function validatePayload(
  type: Pick<EventType, 'fields'>,
  payload: EventPayload,
  completing: boolean,
): PayloadProblem[] {
  const map = byKey(type.fields);
  const valueOf = payloadValue(payload);
  const problems: PayloadProblem[] = [];
  for (const field of map.values()) {
    const value = valueOf(field.key);
    const visible = isVisibleIn(map, field, valueOf, map.size);
    if (value === undefined || value === null) {
      if (visible && completing && field.isRequired && field.kind !== 'bool') {
        problems.push({ field: field.key, code: 'required' });
      }
      continue;
    }
    if (!visible) {
      problems.push({ field: field.key, code: 'hidden' });
      continue;
    }
    const code = kindProblem(field, value);
    if (code) problems.push({ field: field.key, code });
  }
  return problems;
}

/** Whether the event is complete once it has `endedAt` (instant types always are). */
export function isComplete(type: Pick<EventType, 'hasDuration'>, endedAt: string | null): boolean {
  return !type.hasDuration || endedAt !== null;
}

/** `payload` without the values of hidden fields (what the server accepts). */
export function withoutHiddenValues(
  type: Pick<EventType, 'fields'>,
  payload: EventPayload,
): EventPayload {
  const map = byKey(type.fields);
  const valueOf = payloadValue(payload);
  const result: EventPayload = {};
  for (const [key, value] of Object.entries(payload)) {
    const field = map.get(key);
    if (field && hasValue(value) && !isVisibleIn(map, field, valueOf, map.size)) continue;
    setOwn(result, key, value);
  }
  return result;
}
