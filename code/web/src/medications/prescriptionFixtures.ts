import type { DayPart, DayPartReminder, Prescription, PrescriptionDose } from '../db/models';
import {
  calculateMedicationStatus,
  type BodyWeight,
  type MedicationDose,
  type MedicationStatus,
} from './statusCalculator';

/** Builders for tests of the medications feature (prescriptions, doses, status). */

export const BABY = 'baby-1';
export const MED_A = 'med-a';
export const MED_B = 'med-b';

const TWO_DROPS: PrescriptionDose = { amount: 2, unit: 'drops', perKg: false, roundingStep: null };

let counter = 0;

export function prescription(over: Partial<Prescription> = {}): Prescription {
  counter += 1;
  return {
    id: `rx-${String(counter).padStart(4, '0')}`,
    babyId: BABY,
    medicationId: MED_A,
    status: 'active',
    kind: 'asNeeded',
    dose: TWO_DROPS,
    timesOfDay: null,
    everyMinutes: null,
    minIntervalMinutes: null,
    maxDosesPer24h: null,
    indication: null,
    intervalGroup: null,
    startDate: '2026-01-01',
    endDate: null,
    prescriber: null,
    instructions: null,
    createdBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    deletedAt: null,
    ...over,
  };
}

interface Options {
  group?: string | null;
  start?: string;
  end?: string | null;
  dose?: PrescriptionDose;
  maxDoses?: number | null;
  createdAt?: Date;
}

const normalizeGroup = (group: string | null | undefined) =>
  group ? group.trim().toLowerCase() : null;

export function asNeeded(medicationId: string, minIntervalMinutes: number, o: Options = {}) {
  return prescription({
    medicationId,
    kind: 'asNeeded',
    minIntervalMinutes,
    maxDosesPer24h: o.maxDoses ?? null,
    intervalGroup: normalizeGroup(o.group),
    dose: o.dose ?? TWO_DROPS,
    startDate: o.start ?? '2026-01-01',
    endDate: o.end ?? null,
  });
}

export function atTimes(medicationId: string, times: string[], o: Options = {}) {
  return prescription({
    medicationId,
    kind: 'scheduled',
    timesOfDay: times,
    intervalGroup: normalizeGroup(o.group),
    startDate: o.start ?? '2026-01-01',
    endDate: o.end ?? null,
    ...(o.createdAt ? { createdAt: o.createdAt.toISOString() } : {}),
  });
}

/** A part-of-the-day prescription ("1 drop in the morning"), reminders off unless given. */
export function byParts(
  medicationId: string,
  parts: DayPart[],
  o: Options & { reminders?: DayPartReminder[] } = {},
) {
  return prescription({
    medicationId,
    kind: 'scheduled',
    dayParts: parts,
    dayPartReminders: o.reminders ?? null,
    intervalGroup: normalizeGroup(o.group),
    dose: o.dose ?? TWO_DROPS,
    startDate: o.start ?? '2026-01-01',
    endDate: o.end ?? null,
    ...(o.createdAt ? { createdAt: o.createdAt.toISOString() } : {}),
  });
}

export function every(medicationId: string, everyMinutes: number) {
  return prescription({ medicationId, kind: 'scheduled', everyMinutes });
}

export function dose(
  givenAt: Date,
  medicationId: string,
  prescriptionId: string | null = null,
): MedicationDose {
  return { givenAt: givenAt.getTime(), medicationId, prescriptionId, override: false };
}

/** A local wall-clock time with the given UTC offset in minutes. */
export function local(
  y: number,
  mo: number,
  d: number,
  h: number,
  mi: number,
  offsetMinutes: number,
) {
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - offsetMinutes * 60_000);
}

export function calc(
  prescriptions: Prescription[],
  doses: MedicationDose[],
  now: Date,
  utcOffsetMinutes = 0,
  weight: BodyWeight | null = null,
): MedicationStatus[] {
  return calculateMedicationStatus({ prescriptions, doses, now, utcOffsetMinutes, weight });
}
