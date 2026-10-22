import type {
  DayPart,
  Medication,
  Prescription,
  PrescriptionContent,
  PrescriptionKind,
} from '../db/models';
import type { PrescriptionTerms } from '../db/prescriptionCommands';
import { formatDate, formatList, formatNumber, formatTime } from '../i18n/format';
import { t } from '../i18n/i18n';
import { PROPOSAL_NAME_MAX, contentOf } from '../proposals/proposalModel';
import { clockText, dayPartName, dayPartPhrase } from './dayPartText';
import {
  DAY_PART_STARTS,
  DEFAULT_REMINDER_TIMES,
  dayPartEnd,
  partAt,
  sortDayParts,
} from './dayParts';
import { countedAmountText, countedUnitLabel, countedUnitOf, fitsAmountStep } from './doseUnits';
import { INTERVAL_GROUP_MAX, normalizeGroupName } from './groupName';

/*
 * The state of the prescription editor, its validation (mirrors the API rules in
 * docs/SPEC.md "Medications: catalog, prescriptions, status") and the plain-language summary shown
 * at the top of the editor. Everything the parent types here is the doctor's prescription as the
 * parent understood it: the app computes with it, it never suggests a dose or an interval.
 */

export type RoundingChoice = 'none' | '0.1' | '0.5' | '1';
export type ScheduleBy = 'times' | 'every' | 'parts';

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
export const INSTRUCTIONS_MAX = 2000;
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
  /** Part of the day: the chosen parts (one dose in each per day). */
  parts: DayPart[];
  /** Part of the day: reminders on (off by default). */
  partReminders: boolean;
  /** Part of the day: the reminder time of every part (`HH:mm`), used for the chosen ones. */
  reminderTimes: Record<DayPart, string>;
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
    | 'parts'
    | 'reminders'
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
    parts: [],
    partReminders: false,
    reminderTimes: { ...DEFAULT_REMINDER_TIMES },
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

function scheduleByOf(
  p: Pick<PrescriptionContent, 'everyMinutes'> & { dayParts?: DayPart[] | null },
): ScheduleBy {
  if (p.dayParts && p.dayParts.length > 0) return 'parts';
  return p.everyMinutes !== null ? 'every' : 'times';
}

function reminderTimesOf(p: {
  dayPartReminders?: PrescriptionContent['dayPartReminders'];
}): Record<DayPart, string> {
  const times = { ...DEFAULT_REMINDER_TIMES };
  for (const reminder of p.dayPartReminders ?? []) times[reminder.part] = reminder.time;
  return times;
}

/** The form for a prescription's content (a proposal's, or the one a change is proposed for). */
export function formFromContent(
  p: Omit<PrescriptionContent, 'dayParts' | 'dayPartReminders'> &
    Partial<Pick<PrescriptionContent, 'dayParts' | 'dayPartReminders'>>,
): Omit<PrescriptionForm, 'medicationId' | 'prescriber'> {
  return {
    amount: p.dose.amount,
    unit: p.dose.unit,
    perKg: p.dose.perKg,
    rounding: roundingOf(p.dose.roundingStep),
    kind: p.kind,
    scheduleBy: scheduleByOf(p),
    times: p.timesOfDay ? [...p.timesOfDay] : [],
    everyHours: hoursOf(p.everyMinutes),
    parts: p.dayParts ? [...p.dayParts] : [],
    partReminders: (p.dayPartReminders?.length ?? 0) > 0,
    reminderTimes: reminderTimesOf(p),
    minIntervalHours: hoursOf(p.minIntervalMinutes),
    maxDoses: p.maxDosesPer24h,
    indication: p.indication ?? '',
    group: p.intervalGroup ?? '',
    startDate: p.startDate,
    endDate: p.endDate ?? '',
    instructions: p.instructions ?? '',
  };
}

export function formFromPrescription(p: Prescription): PrescriptionForm {
  return { ...formFromContent(p), medicationId: p.medicationId, prescriber: p.prescriber ?? '' };
}

const minutesOf = (hours: number | null) => (hours === null ? null : Math.round(hours * 60));
const blankToNull = (text: string) => (text.trim() === '' ? null : text.trim());
const hasNul = (text: string) => text.includes(String.fromCharCode(0));

/**
 * The problems of the form, by field (empty when it can be saved). A proposal has no medication of
 * the baby's list necessarily: it passes the name it will carry instead (`medicationName`).
 */
export function validateForm(
  form: PrescriptionForm,
  proposal?: { medicationName: string },
): FormErrors {
  const errors: FormErrors = {};
  if (proposal) {
    const name = proposal.medicationName.trim();
    if (name === '') errors.medication = t('medications.editor.errors.medication');
    else if (name.length > PROPOSAL_NAME_MAX) {
      errors.medication = t('medications.editor.errors.tooLong', { max: PROPOSAL_NAME_MAX });
    }
  } else if (!form.medicationId) errors.medication = t('medications.editor.errors.medication');
  if (form.amount === null || form.amount < 0.001 || form.amount > AMOUNT_MAX) {
    errors.amount = t('medications.editor.errors.amount');
  }
  if (form.unit.trim() === '' || form.unit.trim().length > UNIT_MAX) {
    errors.unit = t('medications.editor.errors.unit', { max: UNIT_MAX });
  }
  const counted = countedUnitOf(form.unit);
  if (counted && form.perKg) errors.unit = t('medications.editor.errors.perKgCounted');
  if (counted && form.amount !== null && !fitsAmountStep(form.amount, counted) && !errors.amount) {
    errors.amount =
      counted === 'suppository'
        ? t('medications.editor.errors.halfCount')
        : t('medications.editor.errors.wholeCount');
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
  if (form.kind === 'scheduled' && form.scheduleBy === 'parts') {
    if (form.parts.length === 0) errors.parts = t('medications.editor.errors.partsRequired');
    const reminderError = form.partReminders ? partReminderError(form) : null;
    if (reminderError) errors.reminders = reminderError;
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

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The first chosen part whose reminder time is missing or outside its window. */
export function wrongReminderPart(form: PrescriptionForm): DayPart | null {
  if (!form.partReminders) return null;
  const wrong = sortDayParts(form.parts).find((part) => {
    const time = form.reminderTimes[part];
    return !CLOCK.test(time) || partAt(time) !== part;
  });
  return wrong ?? null;
}

function partReminderError(form: PrescriptionForm): string | null {
  const wrong = wrongReminderPart(form);
  if (!wrong) return null;
  return t('medications.editor.errors.reminderWindow', {
    part: dayPartName(wrong),
    start: clockText(DAY_PART_STARTS[wrong]),
    end: clockText(dayPartEnd(wrong)),
  });
}

/** The terms to save for a valid form (call after `validateForm` found no problems). */
export function toTerms(
  form: PrescriptionForm,
  status: Prescription['status'] = 'active',
): PrescriptionTerms {
  const scheduled = form.kind === 'scheduled';
  const byTimes = scheduled && form.scheduleBy === 'times';
  const byParts = scheduled && form.scheduleBy === 'parts';
  const parts = byParts ? sortDayParts(form.parts) : [];
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
    everyMinutes: scheduled && form.scheduleBy === 'every' ? minutesOf(form.everyHours) : null,
    dayParts: parts.length > 0 ? parts : null,
    dayPartReminders:
      parts.length > 0 && form.partReminders
        ? parts.map((part) => ({ part, time: form.reminderTimes[part] }))
        : null,
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

/** The content of a valid form without a medication or a prescriber: what a proposal carries. */
export function toContent(form: PrescriptionForm): PrescriptionContent {
  return contentOf(toTerms(form));
}

/**
 * Whether saved terms can produce a medicine reminder (to offer turning reminders on): scheduled
 * clock times or periods, or parts of the day with reminders on.
 */
export function canRemind(terms: PrescriptionTerms): boolean {
  if (terms.kind !== 'scheduled') return false;
  return !terms.dayParts || (terms.dayPartReminders?.length ?? 0) > 0;
}

/** "8 hours", "1.5 hours", "45 minutes", "2 days"-free: hours up to a week, minutes below an hour. */
export function intervalText(minutes: number): string {
  if (minutes < 60) return t('medications.interval.minutes', { count: minutes });
  const hours = minutes / 60;
  return t('medications.interval.hours', { count: hours });
}

/** What the plain-language summary reads: the dose, the schedule, the indication and the end date. */
export type SummaryTerms = Pick<
  PrescriptionContent,
  | 'dose'
  | 'kind'
  | 'timesOfDay'
  | 'everyMinutes'
  | 'minIntervalMinutes'
  | 'maxDosesPer24h'
  | 'indication'
  | 'endDate'
> & { dayParts?: DayPart[] | null };

const DROPS_UNITS = new Set(['drop', 'drops', 'gota', 'gotas']);

/**
 * "5 drops", but "1 drop": the drops unit follows the amount and the app language (a prescription
 * typed in English still reads "gotas" in Portuguese); so do the counted units ("2 sprays",
 * "2 jatos", "1 suppository"). Other units are shown as typed.
 */
export function amountWithUnit(amount: number, unit: string): string {
  const counted = countedUnitOf(unit);
  if (counted) return countedAmountText(amount, counted);
  const drops = DROPS_UNITS.has(unit.trim().toLowerCase());
  const word = drops ? t(amount === 1 ? 'ui.units.drop' : 'ui.units.drops') : unit;
  return `${formatNumber(amount)} ${word}`;
}

/** The unit alone, in the app language for drops and counted units ("gotas", "jatos"), else as typed. */
export function unitText(unit: string): string {
  const counted = countedUnitOf(unit);
  if (counted) return countedUnitLabel(counted);
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

function whenParts(terms: SummaryTerms): string[] {
  if (terms.kind === 'scheduled') {
    if (terms.dayParts && terms.dayParts.length > 0) {
      return [formatList(terms.dayParts.map(dayPartPhrase))];
    }
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
export function summaryText(terms: SummaryTerms | null): string | null {
  if (!terms || terms.dose.amount <= 0 || terms.dose.unit === '') return null;
  const hasWhen =
    terms.timesOfDay !== null ||
    (terms.dayParts?.length ?? 0) > 0 ||
    (terms.everyMinutes ?? terms.minIntervalMinutes ?? 0) > 0;
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
