import type { Medication, Prescription, PrescriptionKind } from '../db/models';
import type { PrescriptionTerms } from '../db/prescriptionCommands';
import { formatDate, formatList, formatNumber, formatTime } from '../i18n/format';
import { t } from '../i18n/i18n';
import { INTERVAL_GROUP_MAX, normalizeGroupName } from './groupName';

/*
 * The state of the prescription editor, its validation (mirrors the API rules in
 * docs/SPEC.md "Medications: catalog, prescriptions, status") and the plain-language summary shown
 * at the top of the editor. Everything the parent types here is the doctor's prescription as the
 * parent understood it: the app computes with it, it never suggests a dose or an interval.
 */

export type RoundingChoice = 'none' | '0.1' | '0.5' | '1';
export type ScheduleBy = 'times' | 'every';

export const ROUNDING_CHOICES: readonly RoundingChoice[] = ['none', '0.1', '0.5', '1'];
/** Presets of the minimum interval stepper (hours). */
export const INTERVAL_PRESETS_HOURS: readonly number[] = [4, 6, 8, 12];
export const MIN_INTERVAL_MINUTES = 15;
export const MAX_INTERVAL_MINUTES = 7 * 24 * 60;
export const MAX_DOSES_LIMIT = 24;
export const MAX_TIMES = 24;
export const AMOUNT_MAX = 9_999_999.999;
export const UNIT_MAX = 20;
export const INDICATION_MAX = 200;
export const PRESCRIBER_MAX = 100;
export const INSTRUCTIONS_MAX = 1000;
export const EARLIEST_DATE = '2000-01-01';
export const LATEST_DATE = '2100-12-31';

export interface PrescriptionForm {
  medicationId: string | null;
  amount: number | null;
  unit: string;
  perKg: boolean;
  rounding: RoundingChoice;
  kind: PrescriptionKind;
  scheduleBy: ScheduleBy;
  times: string[];
  everyHours: number | null;
  minIntervalHours: number | null;
  maxDoses: number | null;
  indication: string;
  group: string;
  startDate: string;
  endDate: string;
  prescriber: string;
  instructions: string;
}

export type FormErrors = Partial<
  Record<
    | 'medication'
    | 'amount'
    | 'unit'
    | 'times'
    | 'every'
    | 'minInterval'
    | 'maxDoses'
    | 'indication'
    | 'group'
    | 'startDate'
    | 'endDate'
    | 'prescriber'
    | 'instructions',
    string
  >
>;

/** The local calendar day of `now` as `yyyy-mm-dd`. */
export function todayKey(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function emptyForm(now: Date, medication?: Medication): PrescriptionForm {
  return {
    medicationId: medication?.id ?? null,
    amount: medication?.defaultDosage?.amount ?? null,
    unit: medication?.defaultDosage?.unit ?? '',
    perKg: false,
    rounding: 'none',
    kind: 'asNeeded',
    scheduleBy: 'times',
    times: [],
    everyHours: null,
    minIntervalHours: null,
    maxDoses: null,
    indication: '',
    group: '',
    startDate: todayKey(now),
    endDate: '',
    prescriber: '',
    instructions: '',
  };
}

const roundingOf = (step: number | null): RoundingChoice =>
  ROUNDING_CHOICES.find((choice) => choice !== 'none' && Number(choice) === step) ?? 'none';

const hoursOf = (minutes: number | null) => (minutes === null ? null : minutes / 60);

export function formFromPrescription(p: Prescription): PrescriptionForm {
  return {
    medicationId: p.medicationId,
    amount: p.dose.amount,
    unit: p.dose.unit,
    perKg: p.dose.perKg,
    rounding: roundingOf(p.dose.roundingStep),
    kind: p.kind,
    scheduleBy: p.everyMinutes !== null ? 'every' : 'times',
    times: p.timesOfDay ? [...p.timesOfDay] : [],
    everyHours: hoursOf(p.everyMinutes),
    minIntervalHours: hoursOf(p.minIntervalMinutes),
    maxDoses: p.maxDosesPer24h,
    indication: p.indication ?? '',
    group: p.intervalGroup ?? '',
    startDate: p.startDate,
    endDate: p.endDate ?? '',
    prescriber: p.prescriber ?? '',
    instructions: p.instructions ?? '',
  };
}

const minutesOf = (hours: number | null) => (hours === null ? null : Math.round(hours * 60));
const blankToNull = (text: string) => (text.trim() === '' ? null : text.trim());
const hasNul = (text: string) => text.includes(String.fromCharCode(0));

/** The problems of the form, by field (empty when it can be saved). */
export function validateForm(form: PrescriptionForm): FormErrors {
  const errors: FormErrors = {};
  if (!form.medicationId) errors.medication = t('medications.editor.errors.medication');
  if (form.amount === null || form.amount < 0.001 || form.amount > AMOUNT_MAX) {
    errors.amount = t('medications.editor.errors.amount');
  }
  if (form.unit.trim() === '' || form.unit.trim().length > UNIT_MAX) {
    errors.unit = t('medications.editor.errors.unit', { max: UNIT_MAX });
  }
  const interval = (minutes: number | null) =>
    minutes !== null && minutes >= MIN_INTERVAL_MINUTES && minutes <= MAX_INTERVAL_MINUTES;
  const intervalError = t('medications.editor.errors.interval');
  if (form.kind === 'scheduled' && form.scheduleBy === 'times') {
    if (form.times.length === 0) errors.times = t('medications.editor.errors.timesRequired');
    else if (new Set(form.times).size !== form.times.length) {
      errors.times = t('medications.editor.errors.timesDistinct');
    }
  }
  if (form.kind === 'scheduled' && form.scheduleBy === 'every') {
    if (!interval(minutesOf(form.everyHours))) errors.every = intervalError;
  }
  if (form.kind === 'asNeeded') {
    if (!interval(minutesOf(form.minIntervalHours))) errors.minInterval = intervalError;
    if (form.maxDoses !== null && (form.maxDoses < 1 || form.maxDoses > MAX_DOSES_LIMIT)) {
      errors.maxDoses = t('medications.editor.errors.maxDoses', { max: MAX_DOSES_LIMIT });
    }
  }
  const tooLong = (text: string, max: number) => text.trim().length > max || hasNul(text);
  if (tooLong(form.indication, INDICATION_MAX)) {
    errors.indication = t('medications.editor.errors.tooLong', { max: INDICATION_MAX });
  }
  if ((normalizeGroupName(form.group) ?? '').length > INTERVAL_GROUP_MAX || hasNul(form.group)) {
    errors.group = t('medications.editor.errors.tooLong', { max: INTERVAL_GROUP_MAX });
  }
  if (tooLong(form.prescriber, PRESCRIBER_MAX)) {
    errors.prescriber = t('medications.editor.errors.tooLong', { max: PRESCRIBER_MAX });
  }
  if (tooLong(form.instructions, INSTRUCTIONS_MAX)) {
    errors.instructions = t('medications.editor.errors.tooLong', { max: INSTRUCTIONS_MAX });
  }
  const inRange = (day: string) => day >= EARLIEST_DATE && day <= LATEST_DATE;
  if (form.startDate === '' || !inRange(form.startDate)) {
    errors.startDate = t('medications.editor.errors.date');
  }
  if (form.endDate !== '' && (!inRange(form.endDate) || form.endDate < form.startDate)) {
    errors.endDate = t('medications.editor.errors.endDate');
  }
  return errors;
}

/** The terms to save for a valid form (call after `validateForm` found no problems). */
export function toTerms(
  form: PrescriptionForm,
  status: Prescription['status'] = 'active',
): PrescriptionTerms {
  const scheduled = form.kind === 'scheduled';
  const byTimes = scheduled && form.scheduleBy === 'times';
  return {
    medicationId: form.medicationId ?? '',
    status,
    kind: form.kind,
    dose: {
      amount: form.amount ?? 0,
      unit: form.unit.trim(),
      perKg: form.perKg,
      roundingStep: form.perKg && form.rounding !== 'none' ? Number(form.rounding) : null,
    },
    timesOfDay: byTimes ? [...form.times].sort() : null,
    everyMinutes: scheduled && !byTimes ? minutesOf(form.everyHours) : null,
    minIntervalMinutes: scheduled ? null : minutesOf(form.minIntervalHours),
    maxDosesPer24h: scheduled ? null : form.maxDoses,
    indication: blankToNull(form.indication),
    intervalGroup: normalizeGroupName(form.group),
    startDate: form.startDate,
    endDate: form.endDate === '' ? null : form.endDate,
    prescriber: blankToNull(form.prescriber),
    instructions: blankToNull(form.instructions),
  };
}

/** "8 hours", "1.5 hours", "45 minutes", "2 days"-free: hours up to a week, minutes below an hour. */
export function intervalText(minutes: number): string {
  if (minutes < 60) return t('medications.interval.minutes', { count: minutes });
  const hours = minutes / 60;
  return t('medications.interval.hours', { count: hours });
}

const DROPS_UNITS = new Set(['drop', 'drops', 'gota', 'gotas']);

/**
 * "5 drops", but "1 drop": the drops unit follows the amount and the app language (a prescription
 * typed in English still reads "gotas" in Portuguese). Other units are shown as typed.
 */
export function amountWithUnit(amount: number, unit: string): string {
  const drops = DROPS_UNITS.has(unit.trim().toLowerCase());
  const word = drops ? t(amount === 1 ? 'ui.units.drop' : 'ui.units.drops') : unit;
  return `${formatNumber(amount)} ${word}`;
}

/** The unit alone, in the app language for drops ("drops" / "gotas"), else as typed. */
export function unitText(unit: string): string {
  return DROPS_UNITS.has(unit.trim().toLowerCase()) ? t('ui.units.drops') : unit;
}

/** The dose as the rule reads: "2 drops", or "1 drop per kg". */
export function doseText(dose: { amount: number; unit: string; perKg: boolean }): string {
  const base = amountWithUnit(dose.amount, dose.unit);
  return dose.perKg ? t('medications.dose.perKg', { dose: base }) : base;
}

/** A `yyyy-mm-dd` date in the app language. */
export function dayText(day: string): string {
  return formatDate(day, 'dayMonthYear');
}

function whenParts(terms: PrescriptionTerms): string[] {
  if (terms.kind === 'scheduled') {
    if (terms.timesOfDay) {
      const times = terms.timesOfDay.map((time) => {
        const [h, m] = time.split(':').map(Number);
        return formatTime(new Date(2000, 0, 1, h, m));
      });
      return [t('medications.summary.atTimes', { times: formatList(times) })];
    }
    return [t('medications.summary.every', { interval: intervalText(terms.everyMinutes ?? 0) })];
  }
  const parts = [
    t('medications.summary.noMoreOften', { interval: intervalText(terms.minIntervalMinutes ?? 0) }),
  ];
  if (terms.maxDosesPer24h !== null) {
    parts.push(t('medications.summary.maxDoses', { count: terms.maxDosesPer24h }));
  }
  return parts;
}

/**
 * "Give 1 drop per kg, no more often than every 8 hours, when belly pain": the rule as the parent
 * entered it, in plain words. `null` while the form cannot be summarized yet.
 */
export function summaryText(terms: PrescriptionTerms | null): string | null {
  if (!terms || terms.dose.amount <= 0 || terms.dose.unit === '') return null;
  const hasWhen =
    terms.timesOfDay !== null || (terms.everyMinutes ?? terms.minIntervalMinutes ?? 0) > 0;
  const parts = [
    t('medications.summary.give', { dose: doseText(terms.dose) }),
    ...(hasWhen ? whenParts(terms) : []),
    ...(terms.indication ? [t('medications.summary.when', { indication: terms.indication })] : []),
    ...(terms.endDate ? [t('medications.summary.until', { date: dayText(terms.endDate) })] : []),
  ];
  return parts.join(', ');
}

/** Terms for the live summary: the form read leniently (invalid parts simply do not show). */
export function lenientTerms(form: PrescriptionForm): PrescriptionTerms | null {
  if (form.amount === null || form.unit.trim() === '') return null;
  return toTerms(form);
}
