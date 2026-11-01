import { RSV_MATERNAL_CONDITION, slotOf } from './vaccineSchedule';
import type { DoseRecurrence, ScheduledDose, VaccineSchedule } from './vaccineSchedule';

/*
 * The status of every scheduled dose for one baby on one day. Mirrors the API's
 * `Lotties.Domain.Vaccinations.VaccineStatusCalculator` (shared vectors in
 * vaccineStatusVectors.json; docs/design/18-vaccines.md section 3). Pure. Dates are local calendar
 * dates (`YYYY-MM-DD`) and ages whole days between them, counted on UTC day numbers so daylight
 * saving never moves a date.
 *
 * 1. Records satisfy their own dose and every dose it `covers`; records without a known dose id are
 *    ignored.
 * 2. A satisfied dose is `given` (the earliest record; for a yearly dose the latest one while within
 *    `everyDays`). Given wins over every rule below.
 * 3. `notApplicable`: another dose of the alternative group was given; the condition is not met; a
 *    private dose while the profile shows the public schedule only.
 * 4. The window: dueOn = birth + recommended, earliestOn = birth + earliest, both pushed to
 *    previous given + minimum interval when the latest given previous dose was late;
 *    latestOn = birth + latest.
 * 5. `expired` after latestOn (or when the push leaves no valid day), then `upcoming` before dueOn,
 *    `overdue` more than 30 days after it, else `due`.
 * 6. A yearly dose is due from its start age, then everyDays after the latest dose of its series
 *    (itself, its group or a previous dose); it waits (upcoming without a date) while a previous
 *    dose is still pending and none was given, and it is never overdue.
 */

/** A due dose becomes overdue after this many days. */
export const OVERDUE_AFTER_DAYS = 30;

/** Which recommendations the schedule shows: `public` (SUS/PNI) or also the private-clinic ones. */
export type VaccineCoverage = 'public' | 'public+private';

export type RsvMaternalVaccination = 'unknown' | 'yes' | 'no';

export interface VaccineProfile {
  coverage: VaccineCoverage;
  /** Weeks at birth; `null` = not told (term assumed). Under 37 = premature (notice only). */
  gestationalAgeWeeks: number | null;
  rsvMaternalVaccination: RsvMaternalVaccination | null;
}

/** Under this many weeks at birth the schedule shows the premature notice (dates unchanged). */
export const TERM_WEEKS = 37;

export const DEFAULT_VACCINE_PROFILE: VaccineProfile = {
  coverage: 'public',
  gestationalAgeWeeks: null,
  rsvMaternalVaccination: null,
};

/** A recorded vaccine as the engine sees it (deleted records left out by the caller). */
export interface VaccinationRecordInput {
  id: string;
  doseId: string | null;
  givenOn: string;
}

export interface VaccineStatusInput {
  schedule: VaccineSchedule;
  profile: VaccineProfile;
  birthDate: string;
  records: readonly VaccinationRecordInput[];
  today: string;
}

export type DoseState = 'given' | 'due' | 'overdue' | 'upcoming' | 'expired' | 'notApplicable';

export type NotApplicableReason = 'alternative' | 'condition' | 'network';

export interface DoseStatus {
  doseId: string;
  slot: string;
  state: DoseState;
  reason: NotApplicableReason | null;
  /** The day it becomes (or became) due; `null` for a given yearly dose or one still waiting. */
  dueOn: string | null;
  earliestOn: string | null;
  latestOn: string | null;
  overdueFrom: string | null;
  recordId: string | null;
  givenOn: string | null;
  /** The combined product's dose id when a covers rule satisfied this dose. */
  coveredBy: string | null;
  /** The given sibling of the alternative group (reason `alternative`). */
  alternativeOf: string | null;
  /** A private-clinic recommendation shown because the profile includes them. */
  optionalPrivate: boolean;
  /** A yearly dose: when the next one is due. */
  nextDueOn: string | null;
  /** A yearly dose waiting for this earlier dose. */
  waitingFor: string | null;
}

export interface VaccineStatusResult {
  ageDays: number;
  prematureNotice: boolean;
  /** Every scheduled dose (record-only products left out), in schedule order. */
  doses: DoseStatus[];
}

const DAY_MS = 86_400_000;

/** The UTC day number of a `YYYY-MM-DD` date. */
export function dayNumber(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
}

/** The `YYYY-MM-DD` date `days` after `date` (calendar days). */
export function addDays(date: string, days: number): string {
  return new Date((dayNumber(date) + days) * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `birthDate` to `date`. */
export function ageInDays(birthDate: string, date: string): number {
  return dayNumber(date) - dayNumber(birthDate);
}

export function isPremature(profile: VaccineProfile): boolean {
  return profile.gestationalAgeWeeks !== null && profile.gestationalAgeWeeks < TERM_WEEKS;
}

/** Whether a dose with `condition` applies to a baby with `profile`. */
export function isConditionMet(condition: string | null, profile: VaccineProfile): boolean {
  if (condition === RSV_MATERNAL_CONDITION) return profile.rsvMaternalVaccination !== 'yes';
  return true;
}

interface Satisfaction {
  doseId: string;
  record: VaccinationRecordInput;
  via: string | null;
  order: number;
}

interface Window {
  dueOn: string;
  earliestOn: string;
  latestOn: string | null;
}

const laterDate = (a: string | null, b: string | null): string | null =>
  a === null ? b : b === null ? a : a > b ? a : b;

const maxDate = (value: string, other: string | null): string =>
  other !== null && other > value ? other : value;

const hasPassed = (window: Window, today: string): boolean =>
  window.latestOn !== null && (today > window.latestOn || window.earliestOn > window.latestOn);

/** Earliest first: by date, then record order (date, then id text). */
const compareSatisfactions = (a: Satisfaction, b: Satisfaction): number =>
  a.record.givenOn < b.record.givenOn
    ? -1
    : a.record.givenOn > b.record.givenOn
      ? 1
      : a.order - b.order;

function satisfactionsOf(
  schedule: VaccineSchedule,
  records: readonly VaccinationRecordInput[],
): Map<string, Satisfaction[]> {
  const doses = new Map(schedule.doses.map((dose) => [dose.doseId, dose]));
  const ordered = [...records].sort((a, b) =>
    a.givenOn !== b.givenOn
      ? a.givenOn < b.givenOn
        ? -1
        : 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0,
  );
  const result = new Map<string, Satisfaction[]>();
  const add = (satisfaction: Satisfaction) => {
    const list = result.get(satisfaction.doseId);
    if (list) list.push(satisfaction);
    else result.set(satisfaction.doseId, [satisfaction]);
  };
  ordered.forEach((record, order) => {
    const dose = record.doseId === null ? undefined : doses.get(record.doseId);
    if (!dose) return;
    add({ doseId: dose.doseId, record, via: null, order });
    for (const covered of dose.covers) add({ doseId: covered, record, via: dose.doseId, order });
  });
  return result;
}

/** The status of every scheduled dose of the baby on `today`. */
export function calculateVaccineStatus(input: VaccineStatusInput): VaccineStatusResult {
  const { schedule, profile, birthDate, today } = input;
  const satisfactions = satisfactionsOf(schedule, input.records);
  const doseById = new Map(schedule.doses.map((dose) => [dose.doseId, dose]));
  const groups = new Map<string, ScheduledDose[]>();
  for (const dose of schedule.doses) {
    if (dose.recordOnly || dose.alternativeGroup === null) continue;
    groups.set(dose.alternativeGroup, [...(groups.get(dose.alternativeGroup) ?? []), dose]);
  }

  const at = (days: number) => addDays(birthDate, days);
  const firstOf = (doseId: string): Satisfaction | null => satisfactions.get(doseId)?.[0] ?? null;
  const lastOf = (doseIds: readonly string[]): Satisfaction | null => {
    const all = doseIds.flatMap((doseId) => satisfactions.get(doseId) ?? []);
    return all.length === 0 ? null : [...all].sort(compareSatisfactions)[all.length - 1];
  };
  const later = (a: Satisfaction | null, b: Satisfaction | null): Satisfaction | null =>
    a === null ? b : b === null ? a : b.record.givenOn > a.record.givenOn ? b : a;
  const siblingsOf = (dose: ScheduledDose): ScheduledDose[] =>
    dose.alternativeGroup === null
      ? []
      : (groups.get(dose.alternativeGroup) ?? []).filter((other) => other.doseId !== dose.doseId);
  const latestOn = (dose: ScheduledDose) =>
    dose.latestAgeDays === null ? null : at(dose.latestAgeDays);

  const notApplicableReason = (dose: ScheduledDose): NotApplicableReason | null =>
    !isConditionMet(dose.condition, profile)
      ? 'condition'
      : dose.network === 'private' && profile.coverage === 'public'
        ? 'network'
        : null;

  const windowOf = (dose: ScheduledDose): Window => {
    const previous = lastOf(dose.previousDoseIds)?.record.givenOn ?? null;
    const pushedTo =
      previous !== null && dose.minIntervalDaysFromPrevious !== null
        ? addDays(previous, dose.minIntervalDaysFromPrevious)
        : null;
    return {
      dueOn: maxDate(at(dose.recommendedAgeDays), pushedTo),
      earliestOn: maxDate(at(dose.earliestAgeDays), pushedTo),
      latestOn: latestOn(dose),
    };
  };

  const base = (dose: ScheduledDose, window: Window): DoseStatus => ({
    doseId: dose.doseId,
    slot: slotOf(dose),
    state: 'due',
    reason: null,
    dueOn: window.dueOn,
    earliestOn: window.earliestOn,
    latestOn: window.latestOn,
    overdueFrom: null,
    recordId: null,
    givenOn: null,
    coveredBy: null,
    alternativeOf: null,
    optionalPrivate: dose.network === 'private' && profile.coverage === 'public+private',
    nextDueOn: null,
    waitingFor: null,
  });

  const given = (status: DoseStatus, satisfaction: Satisfaction): DoseStatus => ({
    ...status,
    state: 'given',
    recordId: satisfaction.record.id,
    givenOn: satisfaction.record.givenOn,
    coveredBy: satisfaction.via,
  });

  const siblingGiven = (dose: ScheduledDose): string | null => {
    const found = siblingsOf(dose)
      .map((sibling) => firstOf(sibling.doseId))
      .filter((satisfaction): satisfaction is Satisfaction => satisfaction !== null)
      .sort(compareSatisfactions);
    return found[0]?.doseId ?? null;
  };

  const oneOff = (dose: ScheduledDose): DoseStatus => {
    const window = windowOf(dose);
    const status = base(dose, window);
    const own = firstOf(dose.doseId);
    if (own) return given(status, own);
    const sibling = siblingGiven(dose);
    if (sibling !== null)
      return { ...status, state: 'notApplicable', reason: 'alternative', alternativeOf: sibling };
    const reason = notApplicableReason(dose);
    if (reason !== null) return { ...status, state: 'notApplicable', reason };
    if (hasPassed(window, today)) return { ...status, state: 'expired' };
    if (today < window.dueOn) return { ...status, state: 'upcoming' };
    const overdueAfter = addDays(window.dueOn, OVERDUE_AFTER_DAYS);
    if (today > overdueAfter)
      return { ...status, state: 'overdue', overdueFrom: addDays(overdueAfter, 1) };
    return status;
  };

  const pendingPrevious = (dose: ScheduledDose): string | null => {
    for (const previousId of dose.previousDoseIds) {
      const previous = doseById.get(previousId);
      if (!previous || previous.recurrence !== null) continue;
      const state = oneOff(previous).state;
      if (state === 'upcoming' || state === 'due' || state === 'overdue') return previousId;
    }
    return null;
  };

  const recurring = (dose: ScheduledDose, recurrence: DoseRecurrence): DoseStatus => {
    const lastSelf = lastOf([dose.doseId]);
    const lastSibling = lastOf(siblingsOf(dose).map((sibling) => sibling.doseId));
    const lastSeason = later(lastSelf, lastSibling);
    const previous = lastOf(dose.previousDoseIds)?.record.givenOn ?? null;
    const anchor = laterDate(lastSeason?.record.givenOn ?? null, previous);
    const nextDue = maxDate(
      at(recurrence.startAgeDays),
      anchor === null ? null : addDays(anchor, recurrence.everyDays),
    );
    const window: Window = { dueOn: nextDue, earliestOn: nextDue, latestOn: latestOn(dose) };
    const status = base(dose, window);
    const inSeason =
      lastSeason !== null && today < addDays(lastSeason.record.givenOn, recurrence.everyDays);
    if (inSeason && lastSeason === lastSelf)
      return { ...given(status, lastSelf), dueOn: null, nextDueOn: nextDue };
    if (inSeason)
      return {
        ...status,
        state: 'notApplicable',
        reason: 'alternative',
        alternativeOf: lastSeason.doseId,
        nextDueOn: nextDue,
      };
    const reason = notApplicableReason(dose);
    if (reason !== null) return { ...status, state: 'notApplicable', reason };
    if (hasPassed(window, today)) return { ...status, state: 'expired' };
    const waitingFor = lastSeason === null && previous === null ? pendingPrevious(dose) : null;
    if (waitingFor !== null)
      return { ...status, state: 'upcoming', dueOn: null, earliestOn: null, waitingFor };
    if (today < nextDue) return { ...status, state: 'upcoming' };
    return status;
  };

  return {
    ageDays: ageInDays(birthDate, today),
    prematureNotice: isPremature(profile),
    doses: schedule.doses
      .filter((dose) => !dose.recordOnly)
      .map((dose) => (dose.recurrence === null ? oneOff(dose) : recurring(dose, dose.recurrence))),
  };
}
