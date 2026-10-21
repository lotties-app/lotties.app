import type {
  BabyEvent,
  Dosage,
  EventFieldDefinition,
  EventPayload,
  EventType,
  MedicationEventPayload,
} from '../db/models';
import { getOwn, setOwn } from '../util/ownProperty';
import { fromLocalInput, toLocalInput } from './time';

export interface MedicationSelection {
  name: string;
  /** Dose inputs kept as text while editing. */
  amount: string;
  unit: string;
}

export interface EventFormState {
  typeId: string;
  /** `datetime-local` values (local zone). */
  startedAt: string;
  endedAt: string;
  notes: string;
  /**
   * Field values by field key: text for text/number/select, boolean for bool. Keys come from the
   * server, so read and write them with `getOwn`/`withOwn` (util/ownProperty), never `values[key]`.
   */
  values: Record<string, string | boolean>;
  /** Checked medications by catalog id (same own-property rule as `values`). */
  medications: Record<string, MedicationSelection>;
}

export const MEDICATION_TYPE_KEY = 'medication';

export function isMedicationType(type: EventType | undefined): boolean {
  return type?.key === MEDICATION_TYPE_KEY;
}

function valuesFromPayload(type: EventType | undefined, payload: EventPayload) {
  const values: EventFormState['values'] = {};
  for (const field of type?.fields ?? []) {
    const raw = getOwn(payload, field.key);
    if (raw === undefined || raw === null) continue;
    setOwn(values, field.key, field.kind === 'bool' ? raw === true : String(raw));
  }
  return values;
}

function medicationsFromPayload(payload: EventPayload) {
  const result: EventFormState['medications'] = {};
  const list = (payload as Partial<MedicationEventPayload>).medications;
  for (const m of Array.isArray(list) ? list : []) {
    if (typeof m?.medicationId !== 'string') continue;
    setOwn(result, m.medicationId, {
      name: m.name ?? '',
      amount: m.dose ? String(m.dose.amount) : '',
      unit: m.dose?.unit ?? '',
    });
  }
  return result;
}

export function initialForm(
  types: EventType[],
  event: BabyEvent | undefined,
  typeId: string | undefined,
  now: Date,
): EventFormState {
  if (event) {
    const type = types.find((t) => t.id === event.typeId);
    return {
      typeId: event.typeId,
      startedAt: toLocalInput(event.startedAt),
      endedAt: event.endedAt ? toLocalInput(event.endedAt) : '',
      notes: event.notes ?? '',
      values: valuesFromPayload(type, event.payload),
      medications: medicationsFromPayload(event.payload),
    };
  }
  return {
    typeId: typeId ?? types[0]?.id ?? '',
    startedAt: toLocalInput(now.toISOString()),
    endedAt: '',
    notes: '',
    values: {},
    medications: {},
  };
}

function parseNumber(raw: string | boolean | undefined): number | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : Number.NaN;
}

function fieldError(field: EventFieldDefinition, raw: string | boolean | undefined) {
  const empty = raw === undefined || raw === '';
  if (empty)
    return field.isRequired && field.kind !== 'bool' ? `${field.label} is required.` : null;
  if (field.kind !== 'number') return null;
  const n = parseNumber(raw);
  if (n === null || Number.isNaN(n)) return `${field.label} must be a number.`;
  if (field.min !== null && n < field.min) return `${field.label} must be at least ${field.min}.`;
  if (field.max !== null && n > field.max) return `${field.label} must be at most ${field.max}.`;
  return null;
}

function doseError(name: string, m: MedicationSelection) {
  if (!m.amount.trim()) return null;
  const amount = parseNumber(m.amount);
  if (amount === null || Number.isNaN(amount) || amount <= 0) {
    return `Dose for ${name} must be a positive number.`;
  }
  return m.unit.trim() ? null : `Dose for ${name} needs a unit.`;
}

export function validateForm(form: EventFormState, type: EventType | undefined): string[] {
  const errors: string[] = [];
  if (!type) return ['Choose an event type.'];
  const start = fromLocalInput(form.startedAt);
  if (!start) errors.push('Start time is required.');
  const end = fromLocalInput(form.endedAt);
  if (type.hasDuration && start && end && end < start) {
    errors.push('End time must not be before the start time.');
  }
  for (const field of type.fields) {
    const error = fieldError(field, getOwn(form.values, field.key));
    if (error) errors.push(error);
  }
  if (isMedicationType(type)) {
    const selected = Object.values(form.medications);
    if (selected.length === 0) errors.push('Select at least one medication.');
    for (const m of selected) {
      const error = doseError(m.name, m);
      if (error) errors.push(error);
    }
  }
  return errors;
}

function toDose(m: MedicationSelection): Dosage | undefined {
  const amount = parseNumber(m.amount);
  return amount === null || !m.unit.trim() ? undefined : { amount, unit: m.unit.trim() };
}

/** Payload for a valid form; call after `validateForm` returned no errors. */
export function buildPayload(form: EventFormState, type: EventType): EventPayload {
  if (isMedicationType(type)) {
    const medications = Object.entries(form.medications).map(([medicationId, m]) => {
      const dose = toDose(m);
      return { medicationId, name: m.name, ...(dose ? { dose } : {}) };
    });
    return { medications } satisfies MedicationEventPayload;
  }
  const payload: EventPayload = {};
  for (const field of type.fields) {
    const raw = getOwn(form.values, field.key);
    if (raw === undefined || raw === '') continue;
    setOwn<unknown>(payload, field.key, field.kind === 'number' ? parseNumber(raw) : raw);
  }
  return payload;
}

/** Start/end ISO strings to send: instant types end when they start; blank end = running. */
export function buildTimes(form: EventFormState, type: EventType) {
  const startedAt = fromLocalInput(form.startedAt)!;
  const endedAt = type.hasDuration ? fromLocalInput(form.endedAt) : startedAt;
  return { startedAt, endedAt };
}
