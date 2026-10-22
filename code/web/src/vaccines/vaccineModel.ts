import type { Baby, Vaccination } from '../db/models';
import { isCalendarDate } from './vaccinationModel';
import type { ScheduledDose, VaccineSchedule } from './vaccineSchedule';
import {
  DEFAULT_VACCINE_PROFILE,
  ageInDays,
  calculateVaccineStatus,
  type DoseStatus,
  type VaccineProfile,
} from './vaccineStatus';

/*
 * What the vaccines page shows (docs/design/18-vaccines.md): the engine's states paired with their
 * schedule entries, the filters, the groups by recommended age, what is due, and which dose a new
 * record defaults to. Pure: no clock, no storage, no text (see vaccineText.ts).
 */

export type VaccineFilter = 'all' | 'public' | 'private';

export const VACCINE_FILTERS: readonly VaccineFilter[] = ['all', 'public', 'private'];

/** A dose due further away than this reads "Due on <date>" instead of "Due in N days". */
export const DUE_IN_DAYS_MAX = 60;

/** The baby's vaccine profile as the engine reads it (rows stored before it existed read as the default). */
export function profileOf(
  baby: Pick<Baby, 'vaccineProfile' | 'gestationalAgeWeeks' | 'rsvMaternalVaccination'>,
): VaccineProfile {
  return {
    coverage: baby.vaccineProfile ?? DEFAULT_VACCINE_PROFILE.coverage,
    gestationalAgeWeeks: baby.gestationalAgeWeeks ?? null,
    rsvMaternalVaccination: baby.rsvMaternalVaccination ?? null,
  };
}

/** A schedule entry with its state for the baby today. */
export interface DoseView {
  dose: ScheduledDose;
  status: DoseStatus;
}

export interface VaccineOverview {
  ageDays: number;
  prematureNotice: boolean;
  /** Every scheduled dose in schedule order (combined products left out). */
  views: DoseView[];
}

export interface OverviewInput {
  schedule: VaccineSchedule;
  baby: Pick<
    Baby,
    'birthDate' | 'vaccineProfile' | 'gestationalAgeWeeks' | 'rsvMaternalVaccination'
  >;
  records: readonly Pick<Vaccination, 'id' | 'doseId' | 'givenOn'>[];
  /** Local calendar date `yyyy-mm-dd`. */
  today: string;
}

/** Whether the baby has a birth date the schedule can be counted from. */
export function hasBirthDate(baby: Pick<Baby, 'birthDate'>): boolean {
  return isCalendarDate(baby.birthDate);
}

/** The state of every dose for the baby on `today`; `null` without a usable birth date. */
export function overviewOf({
  schedule,
  baby,
  records,
  today,
}: OverviewInput): VaccineOverview | null {
  if (!hasBirthDate(baby)) return null;
  const result = calculateVaccineStatus({
    schedule,
    profile: profileOf(baby),
    birthDate: baby.birthDate,
    records: records.map(({ id, doseId, givenOn }) => ({ id, doseId, givenOn })),
    today,
  });
  const doses = new Map(schedule.doses.map((dose) => [dose.doseId, dose]));
  const views: DoseView[] = [];
  for (const status of result.doses) {
    const dose = doses.get(status.doseId);
    if (dose) views.push({ dose, status });
  }
  return { ageDays: result.ageDays, prematureNotice: result.prematureNotice, views };
}

/**
 * Whether a dose is listed under a filter. Doses that do not apply because another product of
 * their slot was given, or because of a condition (the mother's RSV vaccine), are never listed. A
 * private dose while the profile shows the public schedule only is listed under "Private" alone.
 * Otherwise the filter picks the network of the recommendation.
 */
export function isListed({ dose, status }: DoseView, filter: VaccineFilter): boolean {
  if (status.state === 'notApplicable') {
    return status.reason === 'network' && filter === 'private';
  }
  return filter === 'all' || dose.network === filter;
}

export type AgeBucket =
  | { kind: 'birth' }
  | { kind: 'months'; months: number }
  | { kind: 'years'; years: number; months: number };

const DAYS_PER_MONTH = 30.4375;

/**
 * The age a dose is recommended at, in the words of a vaccination card: at birth (under 30 days),
 * whole months up to 23, then years and months.
 */
export function ageBucketOf(days: number): AgeBucket {
  if (days < 30) return { kind: 'birth' };
  const months = Math.round(days / DAYS_PER_MONTH);
  if (months < 24) return { kind: 'months', months };
  return { kind: 'years', years: Math.floor(months / 12), months: months % 12 };
}

export const bucketKey = (bucket: AgeBucket): string =>
  bucket.kind === 'birth'
    ? 'birth'
    : bucket.kind === 'months'
      ? `m${bucket.months}`
      : `y${bucket.years}m${bucket.months}`;

export interface AgeGroup {
  key: string;
  bucket: AgeBucket;
  /** The smallest recommended age of its doses, in days. */
  ageDays: number;
  views: DoseView[];
}

/** Groups doses by recommended age, youngest first; inside a group the schedule order is kept. */
export function groupByAge(views: readonly DoseView[]): AgeGroup[] {
  const groups = new Map<string, AgeGroup>();
  for (const view of views) {
    const bucket = ageBucketOf(view.dose.recommendedAgeDays);
    const key = bucketKey(bucket);
    const group = groups.get(key);
    if (group) {
      group.views.push(view);
      group.ageDays = Math.min(group.ageDays, view.dose.recommendedAgeDays);
    } else {
      groups.set(key, { key, bucket, ageDays: view.dose.recommendedAgeDays, views: [view] });
    }
  }
  return [...groups.values()].sort((a, b) => a.ageDays - b.ageDays);
}

/** How a dose's state reads, without the words (vaccineText.ts words it). */
export type StatusDescriptor =
  | { kind: 'given'; givenOn: string; coveredBy: string | null; nextDueOn: string | null }
  | { kind: 'due' }
  | { kind: 'overdue'; recommendedAgeDays: number }
  | { kind: 'dueIn'; days: number }
  | { kind: 'dueOn'; date: string }
  | { kind: 'waiting' }
  | { kind: 'notInPublic' }
  | { kind: 'expired' };

export function describeStatus({ dose, status }: DoseView, today: string): StatusDescriptor {
  switch (status.state) {
    case 'given':
      return {
        kind: 'given',
        givenOn: status.givenOn ?? today,
        coveredBy: status.coveredBy,
        nextDueOn: status.nextDueOn,
      };
    case 'due':
      return { kind: 'due' };
    case 'overdue':
      return { kind: 'overdue', recommendedAgeDays: dose.recommendedAgeDays };
    case 'expired':
      return { kind: 'expired' };
    case 'notApplicable':
      return { kind: 'notInPublic' };
    case 'upcoming': {
      if (status.waitingFor !== null || status.dueOn === null) return { kind: 'waiting' };
      const days = ageInDays(today, status.dueOn);
      return days <= DUE_IN_DAYS_MAX
        ? { kind: 'dueIn', days: Math.max(days, 0) }
        : { kind: 'dueOn', date: status.dueOn };
    }
  }
}

/** The doses that may be due now (due or overdue), one per slot, the one waiting the longest first. */
export function dueNow(views: readonly DoseView[]): DoseView[] {
  const open = views.filter(({ status }) => status.state === 'due' || status.state === 'overdue');
  const bySlot = new Map<string, DoseView>();
  for (const view of open) {
    const kept = bySlot.get(view.status.slot);
    if (!kept || (view.status.dueOn ?? '9999') < (kept.status.dueOn ?? '9999')) {
      bySlot.set(view.status.slot, view);
    }
  }
  return [...bySlot.values()].sort((a, b) =>
    (a.status.dueOn ?? '9999').localeCompare(b.status.dueOn ?? '9999'),
  );
}

/**
 * The dose a new record of `vaccineKey` defaults to: the first dose of the vaccine, in schedule
 * order, that is not given and not covered by another product of its slot. A combined product
 * (record only) defaults to its first dose whose covered doses are not all given. `null` = no dose
 * (a vaccine without schedule entries, or every dose given and none yearly): "Not in the schedule".
 */
export function nextPendingDoseId(
  schedule: VaccineSchedule,
  statuses: readonly DoseStatus[],
  vaccineKey: string,
): string | null {
  const doses = schedule.doses.filter((dose) => dose.vaccineKey === vaccineKey);
  if (doses.length === 0) return null;
  const byId = new Map(statuses.map((status) => [status.doseId, status]));
  const real = doses.filter((dose) => !dose.recordOnly);
  if (real.length === 0) {
    const open = doses.find((dose) => dose.covers.some((id) => byId.get(id)?.state !== 'given'));
    return (open ?? doses[0]!).doseId;
  }
  const pending = real.find((dose) => {
    const status = byId.get(dose.doseId);
    return (
      status !== undefined &&
      status.state !== 'given' &&
      !(status.state === 'notApplicable' && status.reason === 'alternative')
    );
  });
  return pending?.doseId ?? real.find((dose) => dose.recurrence !== null)?.doseId ?? null;
}

/** The doses of one vaccine, record-only products included, in schedule order. */
export function dosesOfVaccine(schedule: VaccineSchedule, vaccineKey: string): ScheduledDose[] {
  return schedule.doses.filter((dose) => dose.vaccineKey === vaccineKey);
}

/**
 * Whether a dose carries the "confirm with your pediatrician" marker: the data flags it for review,
 * or the sources disagree on it (another product of its slot is listed beside it under `filter`).
 */
export function needsConfirmation(
  view: DoseView,
  views: readonly DoseView[],
  filter: VaccineFilter,
): boolean {
  if (view.dose.needsReview) return true;
  const group = view.dose.alternativeGroup;
  if (group === null) return false;
  return views.some(
    (other) =>
      other.dose.doseId !== view.dose.doseId &&
      other.dose.alternativeGroup === group &&
      isListed(other, filter),
  );
}
