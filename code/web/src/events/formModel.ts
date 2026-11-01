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
import { declaresFormula, FORMULA_KEYS } from '../formulas/formulaModel';
import { DRUNK_KEY, PREPARED_KEY, withoutRedundantDrunk } from './bottleAmounts';
import { visibleFields, withinDecimals } from './payloadRules';
import { fromLocalInput, toLocalInput } from './time';

export interface MedicationSelection {
  name: string;
  /** Dose inputs kept as text while editing. */
  amount: string;
  unit: string;
  /** Kept from a logged entry so editing the event never drops them. */
  prescriptionId?: string;
  kgUsed?: number;
  override?: true;
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

/**
 * Options of the built-in types that happen at a moment even though the type has a duration: solid
 * food is given and done (no timer), and bedtime, waking up and falling asleep are markers. Keyed
 * by `type.field`. A bottle is not one: it has a duration like nursing (how long the baby took to
 * drink it), so a new bottle starts as a running timer.
 */
const INSTANT_OPTIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['feeding.method', new Set(['solid'])],
  ['sleep.kind', new Set(['bed_time', 'woke_up', 'fell_asleep'])],
]);

/** Whether the event ends when it starts by its nature (solid food, a bedtime marker): no timer. */
export function isInstantByNature(
  type: Pick<EventType, 'key' | 'babyId' | 'hasDuration'> | undefined,
  values: EventFormState['values'],
): boolean {
  if (!type || !type.hasDuration || type.babyId !== null) return false;
  for (const [path, options] of INSTANT_OPTIONS) {
    const [typeKey, field] = path.split('.');
    if (typeKey !== type.key) continue;
    const value = getOwn(values, field);
    if (typeof value === 'string' && options.has(value)) return true;
  }
  return false;
}

/**
 * Whether a new event of this type and choices starts as a running timer ("Still running" on):
 * a type with a duration whose chosen method is not instant (nursing, a bottle, a nap, tummy time).
 */
export function defaultRunning(
  type: Pick<EventType, 'key' | 'babyId' | 'hasDuration'> | undefined,
  values: EventFormState['values'],
  timeBottles = true,
): boolean {
  if (!timeBottles && isBottle(type, values)) return false;
  return !!type?.hasDuration && !isInstantByNature(type, values);
}

/** A bottle of the built-in feeding type (the "Time bottle feedings" setting decides if it is timed). */
function isBottle(
  type: Pick<EventType, 'key' | 'babyId'> | undefined,
  values: EventFormState['values'],
): boolean {
  return type?.babyId === null && type.key === 'feeding' && getOwn(values, 'method') === 'bottle';
}

export function isMedicationType(type: EventType | undefined): boolean {
  return type?.key === MEDICATION_TYPE_KEY;
}

/**
 * Whether the form edits the field's value: every field that is not hidden, plus the hidden
 * formula members of the built-in feeding type, which the formula chips edit (not a generic
 * control).
 */
export function isFormField(type: EventType | undefined, field: EventFieldDefinition): boolean {
  return field.hidden !== true || (declaresFormula(type) && FORMULA_KEYS.includes(field.key));
}

function valuesFromPayload(type: EventType | undefined, payload: EventPayload) {
  const values: EventFormState['values'] = {};
  for (const field of type?.fields ?? []) {
    // Hidden fields (pause keys, deprecated ones) have no control; `buildPayload` keeps their values.
    if (!isFormField(type, field)) continue;
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
      ...(typeof m.prescriptionId === 'string' ? { prescriptionId: m.prescriptionId } : {}),
      ...(typeof m.kgUsed === 'number' ? { kgUsed: m.kgUsed } : {}),
      ...(m.override === true ? { override: true as const } : {}),
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
  if (field.integer === true && !Number.isInteger(n)) {
    return t('events.validation.fieldInteger', { label });
  }
  if (!withinDecimals(field, n)) {
    return t('events.validation.fieldDecimals', { label, count: field.decimals });
  }
  if (field.min !== null && n < field.min) {
    return t('events.validation.fieldMin', { label, min: formatNumber(field.min) });
  }
  if (field.max !== null && n > field.max) {
    return t('events.validation.fieldMax', { label, max: formatNumber(field.max) });
  }
  return null;
}

/** The drunk amount of a bottle above the prepared one. */
function drunkError(
  label: string,
  type: EventType,
  field: EventFieldDefinition,
  values: EventFormState['values'],
): string | null {
  if (type.babyId !== null || type.key !== 'feeding' || field.key !== DRUNK_KEY) return null;
  const drunk = parseNumber(getOwn(values, DRUNK_KEY));
  const prepared = parseNumber(getOwn(values, PREPARED_KEY));
  return drunk !== null && prepared !== null && drunk > prepared
    ? t('feedingAmounts.drunkAbovePrepared', { label })
    : null;
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
  return type
    ? visibleFields(type.fields, formValue(form.values)).filter((field) => field.hidden !== true)
    : [];
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

/** One thing to fix: which control it belongs to (`start`, `end`, `type`, `medications` or a field key). */
export interface FormProblem {
  field: string;
  message: string;
}

/**
 * Field and time problems of the form, in display order, each tied to its control so the sheet can
 * show it under the field and focus the first one. Only visible fields are checked: a hidden
 * field is never required.
 */
export function formProblems(
  form: EventFormState,
  type: EventType | undefined,
  names: EventTypeText = eventTypeText,
  options: { instant?: boolean } = {},
): FormProblem[] {
  const problems: FormProblem[] = [];
  if (!type) return [{ field: 'type', message: t('events.validation.chooseType') }];
  const start = fromLocalInput(form.startedAt);
  if (!start) problems.push({ field: 'start', message: t('events.validation.startRequired') });
  const end = fromLocalInput(form.endedAt);
  if (type.hasDuration && !options.instant && start && end && end < start) {
    problems.push({ field: 'end', message: t('events.validation.endBeforeStart') });
  }
  for (const field of shownFields(form, type)) {
    const message =
      fieldError(names.fieldLabel(type, field), field, getOwn(form.values, field.key)) ??
      drunkError(names.fieldLabel(type, field), type, field, form.values);
    if (message) problems.push({ field: field.key, message });
  }
  if (isMedicationType(type)) {
    const selected = Object.values(form.medications);
    if (selected.length === 0) {
      problems.push({ field: 'medications', message: t('events.validation.selectMedication') });
    }
    for (const m of selected) {
      const message = doseError(m.name, m);
      if (message) problems.push({ field: 'medications', message });
    }
  }
  return problems;
}

/** The messages of `formProblems`. */
export function validateForm(
  form: EventFormState,
  type: EventType | undefined,
  names: EventTypeText = eventTypeText,
): string[] {
  return formProblems(form, type, names).map((problem) => problem.message);
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
      return {
        medicationId,
        name: m.name,
        ...(dose ? { dose } : {}),
        ...(m.prescriptionId ? { prescriptionId: m.prescriptionId } : {}),
        ...(m.kgUsed !== undefined ? { kgUsed: m.kgUsed } : {}),
        ...(m.override ? { override: true as const } : {}),
      };
    });
    return { medications } satisfies MedicationEventPayload;
  }
  const payload: EventPayload = {};
  // Members no field declares (imports) and the values of hidden fields (pause keys) are kept.
  const editable = new Set(type.fields.filter((f) => isFormField(type, f)).map((f) => f.key));
  const visible = visibleFields(type.fields, formValue(form.values));
  // A kept value of a field the new choices hide (a bottle's stretches after switching to nursing) goes.
  const shown = new Set(visible.map((f) => f.key));
  const declared = new Set(type.fields.map((f) => f.key));
  for (const [key, value] of Object.entries(base)) {
    if (!editable.has(key) && (!declared.has(key) || shown.has(key))) setOwn(payload, key, value);
  }
  for (const field of visible.filter((f) => isFormField(type, f))) {
    const raw = getOwn(form.values, field.key);
    if (raw === undefined || raw === '') continue;
    setOwn<unknown>(payload, field.key, field.kind === 'number' ? parseNumber(raw) : raw);
  }
  // "All was drunk" is stored as no drunk amount, so editing the prepared amount later cannot leave it above.
  return type.babyId === null && type.key === 'feeding' ? withoutRedundantDrunk(payload) : payload;
}

/**
 * Start/end ISO strings to send: instant types (and instant choices, see `isInstantByNature`) end
 * when they start; a blank end = running.
 */
export function buildTimes(form: EventFormState, type: EventType, instant = false) {
  const startedAt = fromLocalInput(form.startedAt)!;
  const endedAt = type.hasDuration && !instant ? fromLocalInput(form.endedAt) : startedAt;
  return { startedAt, endedAt };
}

/** Whether `value` is something the (other) type's `field` accepts: same kind, option listed, range kept. */
function acceptedBy(
  field: EventFieldDefinition,
  from: EventFieldDefinition,
  value: string | boolean,
) {
  if (field.kind !== from.kind) return false;
  if (field.kind === 'select') return typeof value === 'string' && field.options.includes(value);
  if (field.kind === 'bool') return typeof value === 'boolean';
  if (field.kind === 'number') {
    const n = parseNumber(value);
    if (n === null || Number.isNaN(n)) return false;
    if (field.integer === true && !Number.isInteger(n)) return false;
    if (!withinDecimals(field, n)) return false;
    return (field.min === null || n >= field.min) && (field.max === null || n <= field.max);
  }
  return typeof value === 'string';
}

/**
 * The form after changing the event type: times and notes stay, values stay where the new type has
 * a field with the same key that accepts them, everything else (and the medications of another
 * type) is cleared. `cleared` says whether anything was dropped.
 */
export function switchFormType(
  form: EventFormState,
  from: EventType | undefined,
  to: EventType,
): { form: EventFormState; cleared: boolean } {
  const kept: EventFormState['values'] = {};
  let cleared = Object.keys(form.medications).length > 0 && !isMedicationType(to);
  for (const [key, value] of Object.entries(form.values)) {
    const source = from?.fields.find((f) => f.key === key);
    const target = to.fields.find((f) => f.key === key);
    if (source && target && acceptedBy(target, source, value)) setOwn(kept, key, value);
    else if (value !== '' && value !== false) cleared = true;
  }
  const next: EventFormState = {
    ...form,
    typeId: to.id,
    values: pruneHiddenValues(kept, to),
    medications: isMedicationType(to) ? form.medications : {},
  };
  if (!to.hasDuration) next.endedAt = '';
  return { form: next, cleared };
}
