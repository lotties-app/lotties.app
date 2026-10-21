import type { BabyEvent, Prescription } from '../db/models';
import { getOwn } from '../util/ownProperty';

/*
 * Offline mirror of the API's pure `MedicationStatusCalculator`
 * (api/src/BabyRoutine.Domain/Prescriptions, docs/SPEC.md "Calculator semantics"). Same rules:
 * - Doses of a prescription: payload entries naming it, or naming its medication; its own doses (for
 *   scheduled slots) exclude entries that name another prescription.
 * - Interval clock: the latest dose of the prescription's medication or of any other active member of
 *   its interval group; wait = its own interval, else the smallest interval of the other members.
 * - Max per 24h: doses of the medication in (now - 24h, now]; at the limit `availableAt` is at least
 *   when the oldest counted dose leaves the window.
 * - Times of day: slots of local yesterday/today/tomorrow inside the course; each slot takes the
 *   nearest unused dose within 90 minutes.
 * It never blocks anything: the parent decides (a dose logged early is recorded as `override`).
 * The UTC offset is fixed for the call (a DST change inside the window is not modelled).
 */

export const SLOT_MATCH_MS = 90 * 60_000;
export const DAILY_WINDOW_MS = 24 * 60 * 60_000;
export const MAX_UTC_OFFSET_MINUTES = 14 * 60;
/** A weight older than this many days is flagged as stale for per-kg suggestions. */
export const STALE_WEIGHT_DAYS = 30;
/** Doses are needed for the longest interval (7 days), the daily window and one day of slots. */
export const HISTORY_LOOK_BACK_MS = (7 * 24 * 60 + 24 * 60 + 24 * 60) * 60_000;

const MINUTE_MS = 60_000;

/** One medication entry of a logged event. */
export interface MedicationDose {
  /** Epoch milliseconds of the event start. */
  givenAt: number;
  medicationId: string | null;
  prescriptionId: string | null;
  override: boolean;
}

export interface BodyWeight {
  kg: number;
  /** Calendar date `yyyy-mm-dd`. */
  date: string;
}

export interface SuggestedDose {
  /** The exact amount rounded to the rounding step. */
  amount: number;
  /** Rule amount x weight, 3 decimals. */
  exactAmount: number;
  unit: string;
  perKgAmount: number;
  kgUsed: number;
  weightDate: string;
  stale: boolean;
  roundingStep: number | null;
}

export interface MedicationStatus {
  prescription: Prescription;
  courseStarted: boolean;
  courseEnded: boolean;
  availableNow: boolean;
  availableAt: Date | null;
  nextScheduledAt: Date | null;
  overdueByMinutes: number | null;
  lastDoseAt: Date | null;
  dosesLast24h: number;
  /** Client-only (not in the API): doses of the medication on the local day, for "2 of 3 today". */
  dosesToday: number;
  limitReached: boolean;
  suggestedDose: SuggestedDose | null;
  groupMemberIds: string[];
}

export interface MedicationStatusInput {
  prescriptions: readonly Prescription[];
  doses: readonly MedicationDose[];
  now: Date;
  /** Minutes east of UTC. */
  utcOffsetMinutes: number;
  weight: BodyWeight | null;
}

/* ---------- local calendar helpers (dates are `yyyy-mm-dd`) ---------- */

function pad(n: number) {
  return String(n).padStart(2, '0');
}

function dayOf(utcMs: number): string {
  const d = new Date(utcMs);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** The local calendar day of an instant for a fixed offset. */
export function localDay(instant: Date, utcOffsetMinutes: number): string {
  return dayOf(instant.getTime() + utcOffsetMinutes * MINUTE_MS);
}

export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return dayOf(Date.UTC(y, m - 1, d + days));
}

/** The instant of the local `day` + `HH:mm` for a fixed offset. */
function instantOf(day: string, time: string, utcOffsetMinutes: number): number {
  const [y, m, d] = day.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  return Date.UTC(y, m - 1, d, h, min) - utcOffsetMinutes * MINUTE_MS;
}

export function hasStartedOn(p: Pick<Prescription, 'startDate'>, day: string) {
  return day >= p.startDate;
}

export function hasEndedBefore(p: Pick<Prescription, 'endDate'>, day: string) {
  return p.endDate !== null && day > p.endDate;
}

export function coversDay(p: Pick<Prescription, 'startDate' | 'endDate'>, day: string) {
  return hasStartedOn(p, day) && !hasEndedBefore(p, day);
}

export function isActive(p: Pick<Prescription, 'status' | 'deletedAt'>) {
  return p.status === 'active' && p.deletedAt === null;
}

/* ---------- dose rule ---------- */

/** Rounds half away from zero to `places` decimals (like the API's decimal arithmetic). */
export function roundHalfAway(value: number, places: number): number {
  const factor = 10 ** places;
  const scaled = Math.abs(value) * factor;
  return (Math.sign(value) * Math.round(scaled + 1e-9)) / factor;
}

/** The per-kg suggestion for a weight; `null` when the rule is not per kg or no weight is known. */
export function suggestDose(
  dose: Prescription['dose'],
  weight: BodyWeight | null,
  today: string,
): SuggestedDose | null {
  if (!dose.perKg || !weight) return null;
  const exact = roundHalfAway(dose.amount * weight.kg, 3);
  const step = dose.roundingStep;
  const amount = step ? roundHalfAway(roundHalfAway(exact / step, 0) * step, 3) : exact;
  return {
    amount,
    exactAmount: exact,
    unit: dose.unit,
    perKgAmount: dose.amount,
    kgUsed: weight.kg,
    weightDate: weight.date,
    stale: weight.date < addDays(today, -STALE_WEIGHT_DAYS),
    roundingStep: step,
  };
}

/* ---------- doses from events ---------- */

/** The medication entries of live medication events, as doses (time = event start). */
export function dosesFromEvents(
  events: readonly BabyEvent[],
  medicationTypeIds: ReadonlySet<string>,
): MedicationDose[] {
  const doses: MedicationDose[] = [];
  for (const event of events) {
    if (event.deletedAt || !medicationTypeIds.has(event.typeId)) continue;
    const list = getOwn(event.payload as Record<string, unknown>, 'medications');
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      if (typeof entry !== 'object' || entry === null) continue;
      const record = entry as Record<string, unknown>;
      doses.push({
        givenAt: Date.parse(event.startedAt),
        medicationId: typeof record.medicationId === 'string' ? record.medicationId : null,
        prescriptionId: typeof record.prescriptionId === 'string' ? record.prescriptionId : null,
        override: record.override === true,
      });
    }
  }
  return doses;
}

/* ---------- calculation ---------- */

function ownIntervalMs(p: Prescription): number | null {
  const minutes = p.kind === 'asNeeded' ? p.minIntervalMinutes : p.everyMinutes;
  return minutes === null ? null : minutes * MINUTE_MS;
}

const sharesGroup = (a: Prescription, b: Prescription) =>
  a.intervalGroup !== null && a.intervalGroup === b.intervalGroup;

function medicationDosesOf(p: Prescription, doses: readonly MedicationDose[]) {
  return doses.filter((d) => d.prescriptionId === p.id || d.medicationId === p.medicationId);
}

function ownDosesOf(p: Prescription, doses: readonly MedicationDose[]) {
  return doses.filter(
    (d) =>
      d.prescriptionId === p.id || (d.prescriptionId === null && d.medicationId === p.medicationId),
  );
}

function latest(doses: readonly MedicationDose[]): number | null {
  return doses.length === 0 ? null : Math.max(...doses.map((d) => d.givenAt));
}

function later(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.max(a, b);
}

interface Schedule {
  nextAt: number | null;
  overdueMs: number | null;
}

const NO_SCHEDULE: Schedule = { nextAt: null, overdueMs: null };

interface Slot {
  day: string;
  at: number;
}

/** Each slot, in time order, takes the nearest dose within the window that no earlier slot took. */
function takenSlots(slots: readonly Slot[], doseTimes: readonly number[]): Set<number> {
  const used = new Set<number>();
  const taken = new Set<number>();
  for (const slot of slots) {
    let best = -1;
    let bestGap = Infinity;
    doseTimes.forEach((time, index) => {
      const gap = Math.abs(time - slot.at);
      if (!used.has(index) && gap <= SLOT_MATCH_MS && gap < bestGap) {
        best = index;
        bestGap = gap;
      }
    });
    if (best >= 0) {
      used.add(best);
      taken.add(slot.at);
    }
  }
  return taken;
}

function scheduledSlots(
  p: Prescription,
  times: readonly string[],
  ownDoses: readonly MedicationDose[],
  now: number,
  today: string,
  offset: number,
): Schedule {
  const slots: Slot[] = [-1, 0, 1]
    .map((delta) => addDays(today, delta))
    .filter((day) => coversDay(p, day))
    .flatMap((day) => times.map((time) => ({ day, at: instantOf(day, time, offset) })))
    .sort((a, b) => a.at - b.at);
  const taken = takenSlots(
    slots,
    ownDoses.map((d) => d.givenAt).sort((a, b) => a - b),
  );
  const open = slots.filter((slot) => !taken.has(slot.at));
  const createdAt = Date.parse(p.createdAt);
  const next = open.find((slot) => slot.at > now)?.at ?? null;
  const overdue = open
    .filter(
      (slot) =>
        slot.at <= now &&
        slot.at >= createdAt &&
        (slot.day === today || now - slot.at <= SLOT_MATCH_MS),
    )
    .at(-1);
  return { nextAt: next, overdueMs: overdue ? now - overdue.at : null };
}

function scheduleOf(
  p: Prescription,
  ownDoses: readonly MedicationDose[],
  lastDoseAt: number | null,
  now: number,
  today: string,
  offset: number,
  inCourse: boolean,
): Schedule {
  if (p.kind === 'scheduled' && p.timesOfDay) {
    return scheduledSlots(p, [...p.timesOfDay].sort(), ownDoses, now, today, offset);
  }
  if (p.kind === 'scheduled' && p.everyMinutes !== null && inCourse && lastDoseAt !== null) {
    const nextAt = lastDoseAt + p.everyMinutes * MINUTE_MS;
    return { nextAt, overdueMs: nextAt < now ? now - nextAt : null };
  }
  return NO_SCHEDULE;
}

function statusOf(
  p: Prescription,
  active: readonly Prescription[],
  input: MedicationStatusInput,
  today: string,
): MedicationStatus {
  const now = input.now.getTime();
  const members = active.filter((other) => other.id !== p.id && sharesGroup(p, other));
  const medicationDoses = medicationDosesOf(p, input.doses);
  const clockDoses = [
    ...members.flatMap((m) => medicationDosesOf(m, input.doses)),
    ...medicationDoses,
  ];
  const lastDoseAt = latest(medicationDoses);
  const recent = medicationDoses
    .filter((d) => d.givenAt > now - DAILY_WINDOW_MS && d.givenAt <= now)
    .sort((a, b) => a.givenAt - b.givenAt);
  const max = p.maxDosesPer24h;
  const limitUntil =
    max !== null && recent.length >= max
      ? recent[recent.length - max].givenAt + DAILY_WINDOW_MS
      : null;
  const memberIntervals = members.map(ownIntervalMs).filter((v): v is number => v !== null);
  const interval =
    ownIntervalMs(p) ?? (memberIntervals.length > 0 ? Math.min(...memberIntervals) : null);
  const clock = latest(clockDoses);
  const availableAt = later(
    clock !== null && interval !== null ? clock + interval : null,
    limitUntil,
  );
  const inCourse = coversDay(p, today);
  const schedule = scheduleOf(
    p,
    ownDosesOf(p, input.doses),
    lastDoseAt,
    now,
    today,
    input.utcOffsetMinutes,
    inCourse,
  );
  const toDate = (ms: number | null) => (ms === null ? null : new Date(ms));
  return {
    prescription: p,
    courseStarted: hasStartedOn(p, today),
    courseEnded: hasEndedBefore(p, today),
    availableNow: inCourse && (availableAt === null || availableAt <= now),
    availableAt: toDate(availableAt),
    nextScheduledAt: toDate(schedule.nextAt),
    overdueByMinutes:
      schedule.overdueMs === null ? null : Math.floor(schedule.overdueMs / MINUTE_MS),
    lastDoseAt: toDate(lastDoseAt),
    dosesLast24h: recent.length,
    dosesToday: medicationDoses.filter(
      (d) => localDay(new Date(d.givenAt), input.utcOffsetMinutes) === today,
    ).length,
    limitReached: limitUntil !== null,
    suggestedDose: suggestDose(p.dose, input.weight, today),
    groupMemberIds: members.map((m) => m.id),
  };
}

/** The status of every active, non-deleted prescription, oldest course first (like the API). */
export function calculateMedicationStatus(input: MedicationStatusInput): MedicationStatus[] {
  if (Math.abs(input.utcOffsetMinutes) > MAX_UTC_OFFSET_MINUTES) {
    throw new RangeError('The UTC offset must be within 14 hours.');
  }
  const today = localDay(input.now, input.utcOffsetMinutes);
  const active = input.prescriptions
    .filter(isActive)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id));
  return active.map((p) => statusOf(p, active, input, today));
}
