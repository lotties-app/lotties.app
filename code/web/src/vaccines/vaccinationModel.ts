import type { Vaccination } from '../db/models';
import type { VaccineNetwork } from './vaccineSchedule';

/*
 * Rules of a baby's vaccination records on the device (docs/design/18-vaccines.md), mirroring the
 * API's `VaccinationTerms`: limits, the slug shape of the schedule keys and the date window. Pure:
 * no clock, no storage.
 */

export const VACCINATION_LIMITS = {
  vaccineKey: 40,
  doseId: 60,
  customName: 80,
  doseLabel: 80,
  clinic: 120,
  lot: 40,
  administeredBy: 80,
  notes: 1000,
} as const;

/** The earliest `givenOn` the server accepts. */
export const EARLIEST_GIVEN_ON = '2000-01-01';

/** What a parent edits; ids, authorship and times are set by the commands. */
export type VaccinationTerms = Pick<
  Vaccination,
  | 'vaccineKey'
  | 'doseId'
  | 'customName'
  | 'doseLabel'
  | 'givenOn'
  | 'network'
  | 'clinic'
  | 'lot'
  | 'administeredBy'
  | 'notes'
>;

export function vaccinationTermsOf(v: Vaccination): VaccinationTerms {
  return {
    vaccineKey: v.vaccineKey,
    doseId: v.doseId,
    customName: v.customName,
    doseLabel: v.doseLabel,
    givenOn: v.givenOn,
    network: v.network,
    clinic: v.clinic,
    lot: v.lot,
    administeredBy: v.administeredBy,
    notes: v.notes,
  };
}

export function isVaccineNetwork(value: unknown): value is VaccineNetwork {
  return value === 'public' || value === 'private';
}

/** Lower-case words joined by hyphens, as the schedule's vaccine and dose ids. */
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isSlug(value: string, max: number): boolean {
  return value.length > 0 && value.length <= max && SLUG.test(value);
}

const CALENDAR_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whether `value` is a real calendar date `yyyy-mm-dd`. */
export function isCalendarDate(value: string): boolean {
  const match = CALENDAR_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Newest first: the date given, then the last edit, then the id (a stable order). */
export function byNewestGiven(a: Vaccination, b: Vaccination): number {
  return (
    b.givenOn.localeCompare(a.givenOn) ||
    (b.clientUpdatedAt ?? b.updatedAt).localeCompare(a.clientUpdatedAt ?? a.updatedAt) ||
    a.id.localeCompare(b.id)
  );
}
