import type { EventFieldDefinition, EventPayload, EventType } from '../db/models';
import { getOwn, setOwn } from '../util/ownProperty';
import { isFieldVisible } from './payloadRules';

/*
 * The last value used for each choice field (select, number, bool) per baby and event type, kept in
 * localStorage. It pre-selects the "Finish this ..." sheet and fills required fields of a timer
 * started with one tap, so most stops need no extra step. Free text is never remembered.
 */

const KEY_PREFIX = 'baby-routine.last-values.';
type Remembered = Record<string, string | number | boolean>;

const keyOf = (babyId: string, typeId: string) => `${KEY_PREFIX}${babyId}.${typeId}`;

function isRememberable(
  field: EventFieldDefinition,
  value: unknown,
): value is string | number | boolean {
  if (field.kind === 'select') return typeof value === 'string' && field.options.includes(value);
  if (field.kind === 'number') return typeof value === 'number' && Number.isFinite(value);
  return field.kind === 'bool' && typeof value === 'boolean';
}

function inRange(field: EventFieldDefinition, value: unknown): boolean {
  if (typeof value !== 'number') return true;
  return (field.min === null || value >= field.min) && (field.max === null || value <= field.max);
}

export function readLastUsed(babyId: string, typeId: string): Remembered {
  try {
    const raw = window.localStorage.getItem(keyOf(babyId, typeId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const result: Remembered = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (['string', 'number', 'boolean'].includes(typeof value)) setOwn(result, key, value);
    }
    return result;
  } catch {
    return {};
  }
}

/** Remembers the choice values of a saved payload (merged over the earlier ones). */
export function recordLastUsed(babyId: string, type: EventType, payload: EventPayload): void {
  const next = readLastUsed(babyId, type.id);
  for (const field of type.fields) {
    const value = getOwn(payload, field.key);
    if (isRememberable(field, value)) setOwn(next, field.key, value);
  }
  try {
    window.localStorage.setItem(keyOf(babyId, type.id), JSON.stringify(next));
  } catch {
    // Storage unavailable: nothing is remembered.
  }
}

/**
 * Remembered values for the given fields, only where they are still valid for the definition
 * (an option that was removed, or a number now out of range, is skipped).
 */
export function lastUsedFor(
  remembered: Remembered,
  fields: readonly EventFieldDefinition[],
): Remembered {
  const result: Remembered = {};
  for (const field of fields) {
    const value = getOwn(remembered, field.key);
    if (!isRememberable(field, value) || !inRange(field, value)) continue;
    setOwn(result, field.key, value);
  }
  return result;
}

/**
 * Payload of a timer started with one tap: the preset's defaults, plus the remembered value of
 * every visible required field still missing (repeating until stable, as a remembered choice can
 * reveal another required field). Fields without a remembered value stay empty: the stop then
 * asks for them.
 */
export function quickStartPayload(
  type: EventType,
  defaults: Readonly<EventPayload>,
  remembered: Remembered,
): EventPayload {
  const payload: EventPayload = { ...defaults };
  for (let pass = 0; pass <= type.fields.length; pass++) {
    const missing = type.fields.filter(
      (field) =>
        field.isRequired &&
        getOwn(payload, field.key) === undefined &&
        isFieldVisible(type.fields, field, (key) => getOwn(payload, key)),
    );
    const fill = lastUsedFor(remembered, missing);
    if (Object.keys(fill).length === 0) break;
    for (const [key, value] of Object.entries(fill)) setOwn<unknown>(payload, key, value);
  }
  return payload;
}

/** Forgets one baby's remembered values (the baby left this device). */
export function clearLastUsedForBaby(babyId: string): void {
  removeKeys((key) => key.startsWith(`${KEY_PREFIX}${babyId}.`));
}

/** Forgets every remembered value (sign-out, account switch). */
export function clearAllLastUsed(): void {
  removeKeys((key) => key.startsWith(KEY_PREFIX));
}

function removeKeys(matches: (key: string) => boolean): void {
  try {
    const storage = window.localStorage;
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i));
    for (const key of keys) if (key && matches(key)) storage.removeItem(key);
  } catch {
    // Storage unavailable: nothing to clear.
  }
}
