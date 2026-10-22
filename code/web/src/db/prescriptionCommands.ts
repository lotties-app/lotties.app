import type { BabyRoutineDb } from './database';
import type { Prescription, PrescriptionStatus } from './models';
import { enqueueMutation } from './outbox';
import { toPrescriptionUpsertRequest } from '../sync/contract';
import type { CommandOptions } from './eventCommands';
import { isDoctorSourced } from '../proposals/proposalModel';

/** The terms a parent edits; ids, authorship and times are set by the commands. */
export type PrescriptionTerms = Pick<
  Prescription,
  | 'medicationId'
  | 'status'
  | 'kind'
  | 'dose'
  | 'timesOfDay'
  | 'everyMinutes'
  | 'dayParts'
  | 'dayPartReminders'
  | 'minIntervalMinutes'
  | 'maxDosesPer24h'
  | 'indication'
  | 'intervalGroup'
  | 'startDate'
  | 'endDate'
  | 'prescriber'
  | 'instructions'
>;

export class InvalidPrescriptionError extends Error {
  readonly code: 'gone';

  constructor(message: string) {
    super(message);
    this.name = 'InvalidPrescriptionError';
    this.code = 'gone';
  }
}

export function termsOf(p: Prescription): PrescriptionTerms {
  return {
    medicationId: p.medicationId,
    status: p.status,
    kind: p.kind,
    dose: p.dose,
    timesOfDay: p.timesOfDay,
    everyMinutes: p.everyMinutes,
    dayParts: p.dayParts ?? null,
    dayPartReminders: p.dayPartReminders ?? null,
    minIntervalMinutes: p.minIntervalMinutes,
    maxDosesPer24h: p.maxDosesPer24h,
    indication: p.indication,
    intervalGroup: p.intervalGroup,
    startDate: p.startDate,
    endDate: p.endDate,
    prescriber: p.prescriber,
    instructions: p.instructions,
  };
}

/** Key order and `undefined` never matter when two sets of terms are compared; the status is left out. */
function stableJson(terms: PrescriptionTerms): string {
  const sorted = Object.entries({ ...terms, status: 'active' }).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return JSON.stringify(sorted, (_key, value: unknown) => value ?? null);
}

/**
 * Whether the edit changes the content of a prescription a doctor suggested (anything but stopping
 * or resuming it): the server then flags it "changed by parent" for good; the device shows it at once.
 */
function changesDoctorContent(current: Prescription, terms: PrescriptionTerms): boolean {
  return isDoctorSourced(current) && stableJson(termsOf(current)) !== stableJson(terms);
}

async function queueUpsert(db: BabyRoutineDb, p: Prescription, now: string) {
  await enqueueMutation(db, {
    babyId: p.babyId,
    kind: 'upsert',
    entityType: 'prescription',
    entityId: p.id,
    payload: toPrescriptionUpsertRequest(p),
    createdAt: now,
  });
}

/** Adds a prescription locally and queues its upsert (`PUT /babies/{id}/prescriptions/{id}`). */
export async function createPrescription(
  db: BabyRoutineDb,
  babyId: string,
  terms: PrescriptionTerms,
  options: CommandOptions = {},
): Promise<Prescription> {
  const now = (options.now?.() ?? new Date()).toISOString();
  const prescription: Prescription = {
    ...terms,
    id: options.newId?.() ?? crypto.randomUUID(),
    babyId,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
    clientUpdatedAt: now,
    deletedAt: null,
  };
  await db.transaction('rw', db.prescriptions, db.outbox, async () => {
    await db.prescriptions.put(prescription);
    await queueUpsert(db, prescription, now);
  });
  return prescription;
}

/** Edits the terms of a prescription locally and queues its upsert. */
export async function updatePrescription(
  db: BabyRoutineDb,
  id: string,
  terms: PrescriptionTerms,
  options: CommandOptions = {},
): Promise<Prescription> {
  const now = (options.now?.() ?? new Date()).toISOString();
  return db.transaction('rw', db.prescriptions, db.outbox, async () => {
    const current = await db.prescriptions.get(id);
    if (!current || current.deletedAt) {
      throw new InvalidPrescriptionError('This prescription no longer exists.');
    }
    const updated: Prescription = {
      ...current,
      ...terms,
      ...(changesDoctorContent(current, terms) ? { changedByParent: true } : {}),
      updatedAt: now,
      clientUpdatedAt: now,
    };
    await db.prescriptions.put(updated);
    await queueUpsert(db, updated, now);
    return updated;
  });
}

/** Stops or resumes a prescription (a stopped one has no status and is not offered for logging). */
export function setPrescriptionStatus(
  db: BabyRoutineDb,
  id: string,
  status: PrescriptionStatus,
  options: CommandOptions = {},
): Promise<Prescription> {
  return db.transaction('rw', db.prescriptions, db.outbox, async () => {
    const current = await db.prescriptions.get(id);
    if (!current) throw new InvalidPrescriptionError('This prescription no longer exists.');
    return updatePrescription(db, id, { ...termsOf(current), status }, options);
  });
}

/**
 * Soft deletes a prescription locally (doses already logged keep naming it) and queues the delete.
 * Returns the deleted terms: the server never undeletes, so an Undo creates a new prescription.
 */
export async function deletePrescription(
  db: BabyRoutineDb,
  id: string,
  options: CommandOptions = {},
): Promise<PrescriptionTerms | undefined> {
  const now = (options.now?.() ?? new Date()).toISOString();
  return db.transaction('rw', db.prescriptions, db.outbox, async () => {
    const current = await db.prescriptions.get(id);
    if (!current || current.deletedAt) return undefined;
    await db.prescriptions.put({
      ...current,
      deletedAt: now,
      updatedAt: now,
      clientUpdatedAt: now,
    });
    await enqueueMutation(db, {
      babyId: current.babyId,
      kind: 'delete',
      entityType: 'prescription',
      entityId: id,
      payload: null,
      createdAt: now,
    });
    return termsOf(current);
  });
}
