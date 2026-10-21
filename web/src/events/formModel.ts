import type {
  BabyEvent,
  Dosage,
  EventFieldDefinition,
  EventPayload,
  EventType,
  MedicationEventPayload,
} from '../db/models';
import { eventTypeText, type EventTypeText } from '../i18n/eventTypeText';
import { t } from '../i18n/i18n';
import { getOwn, setOwn } from '../util/ownProperty';
import { formatNumber } from '../i18n/format';
import { visibleFields } from './payloadRules';
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

/** Values to start a new event from (a `sheet` preset: type, start/end and payload defaults). */
export interface FormPrefill {
  typeId: string;
  startedAt: string;
  endedAt: string | null;
  payload: EventPayload;
}

export function initialForm(
  types: EventType[],
  event: BabyEvent | Pick<BabyEvent, 'typeId' | 'startedAt' | 'endedAt' | 'payload'> | undefined,
  typeId: string | undefined,
  now: Date,
): EventFormState {
  if (event) {
    const type = types.find((t) => t.id === event.typeId);
    return {
      typeId: event.typeId,
      startedAt: toLocalInput(event.startedAt),
      endedAt: event.endedAt ? toLocalInput(event.endedAt) : '',
      notes: ('notes' in event ? event.notes : null) ?? '',
      values: pruneHiddenValues(valuesFromPayload(type, event.payload), type),
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

function fieldError(label: string, field: EventFieldDefinition, raw: string | boolean | undefined) {
  const empty = raw === undefined || raw === '';
  if (empty) {
    return field.isRequired && field.kind !== 'bool'
      ? t('events.validation.fieldRequired', { label })
      : null;
  }
  if (field.kind !== 'number') return null;
  const n = parseNumber(raw);
  if (n === null || Number.isNaN(n)) return t('events.validation.fieldNumber', { label });
  if (field.min !== null && n < field.min) {
    return t('events.validation.fieldMin', { label, min: formatNumber(field.min) });
  }
  if (field.max !== null && n > field.max) {
    return t('events.validation.fieldMax', { label, max: formatNumber(field.max) });
  }
  return null;
}

function doseError(name: string, m: MedicationSelection) {
  if (!m.amount.trim()) return null;
  const amount = parseNumber(m.amount);
  if (amount === null || Number.isNaN(amount) || amount <= 0) {
    return t('events.validation.doseInvalid', { name });
  }
  return m.unit.trim() ? null : t('events.validation.doseUnit', { name });
}

/** Reads a form value for the visibility rules (`''` = no value). */
const formValue = (values: EventFormState['values']) => (key: string) => getOwn(values, key);

/** The type's fields shown for the current form values (`visibleWhen` evaluated live). */
export function shownFields(form: Pick<EventFormState, 'values'>, type: EventType | undefined) {
  return type ? visibleFields(type.fields, formValue(form.values)) : [];
}

/**
 * `values` without the values of fields that are hidden for them (e.g. the breast sides after
 * switching the method to bottle), so they are never sent.
 */
export function pruneHiddenValues(
  values: EventFormState['values'],
  type: EventType | undefined,
): EventFormState['values'] {
  if (!type) return values;
  const shown = new Set(visibleFields(type.fields, formValue(values)).map((f) => f.key));
  const declared = new Set(type.fields.map((f) => f.key));
  const result: EventFormState['values'] = {};
  for (const [key, value] of Object.entries(values)) {
    if (!declared.has(key) || shown.has(key)) setOwn(result, key, value);
  }
  return result;
}

/**
 * Field and time problems of the form, in display order. Only visible fields are checked: a hidden
 * field is never required.
 */
export function validateForm(
  form: EventFormState,
  type: EventType | undefined,
  names: EventTypeText = eventTypeText,
): string[] {
  const errors: string[] = [];
  if (!type) return [t('events.validation.chooseType')];
  const start = fromLocalInput(form.startedAt);
  if (!start) errors.push(t('events.validation.startRequired'));
  const end = fromLocalInput(form.endedAt);
  if (type.hasDuration && start && end && end < start) {
    errors.push(t('events.validation.endBeforeStart'));
  }
  for (const field of shownFields(form, type)) {
    const error = fieldError(names.fieldLabel(type, field), field, getOwn(form.values, field.key));
    if (error) errors.push(error);
  }
  if (isMedicationType(type)) {
    const selected = Object.values(form.medications);
    if (selected.length === 0) errors.push(t('events.validation.selectMedication'));
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

/**
 * Payload for a valid form; call after `validateForm` returned no errors. Values of hidden fields
 * are dropped. `base` members no field declares (e.g. from an import) are kept.
 */
export function buildPayload(
  form: EventFormState,
  type: EventType,
  base: EventPayload = {},
): EventPayload {
  if (isMedicationType(type)) {
    const medications = Object.entries(form.medications).map(([medicationId, m]) => {
      const dose = toDose(m);
      return { medicationId, name: m.name, ...(dose ? { dose } : {}) };
    });
    return { medications } satisfies MedicationEventPayload;
  }
  const payload: EventPayload = {};
  const declared = new Set(type.fields.map((f) => f.key));
  for (const [key, value] of Object.entries(base)) {
    if (!declared.has(key)) setOwn(payload, key, value);
  }
  for (const field of shownFields(form, type)) {
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
