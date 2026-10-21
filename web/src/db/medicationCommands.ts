import type { BabyRoutineDb } from './database';
import type { Dosage, Medication } from './models';
import { enqueueMutation } from './outbox';
import { toMedicationUpsertRequest } from '../sync/contract';
import type { CommandOptions } from './eventCommands';

export interface CreateMedicationInput {
  babyId: string;
  name: string;
  defaultDosage?: Dosage | null;
  notes?: string | null;
  isUsual?: boolean;
}

export class InvalidMedicationError extends Error {
  /** `gone`: the medication no longer exists; `name`: a name is required. */
  readonly code: 'name' | 'gone';

  constructor(message: string, code: 'name' | 'gone' = 'name') {
    super(message);
    this.name = 'InvalidMedicationError';
    this.code = code;
  }
}

/** Adds a catalog entry locally and queues its upsert. */
export async function createMedication(
  db: BabyRoutineDb,
  input: CreateMedicationInput,
  options: CommandOptions = {},
): Promise<Medication> {
  const name = input.name.trim();
  if (!name) throw new InvalidMedicationError('A medication needs a name.');
  const now = (options.now?.() ?? new Date()).toISOString();
  const medication: Medication = {
    id: options.newId?.() ?? crypto.randomUUID(),
    babyId: input.babyId,
    name,
    defaultDosage: input.defaultDosage ?? null,
    notes: input.notes ?? null,
    isUsual: input.isUsual ?? false,
    createdAt: now,
  };
  await db.transaction('rw', db.medications, db.outbox, async () => {
    await db.medications.put(medication);
    await enqueueMutation(db, {
      babyId: medication.babyId,
      kind: 'upsert',
      entityType: 'medication',
      entityId: medication.id,
      payload: toMedicationUpsertRequest(medication),
      createdAt: now,
    });
  });
  return medication;
}

export interface MedicationChanges {
  name: string;
  defaultDosage: Dosage | null;
  notes: string | null;
  isUsual: boolean;
}

/** Edits a catalog entry locally and queues its upsert (`PUT /babies/{id}/medications/{id}`). */
export async function updateMedication(
  db: BabyRoutineDb,
  id: string,
  changes: MedicationChanges,
  options: CommandOptions = {},
): Promise<Medication> {
  const name = changes.name.trim();
  if (!name) throw new InvalidMedicationError('A medication needs a name.');
  const now = (options.now?.() ?? new Date()).toISOString();
  return db.transaction('rw', db.medications, db.outbox, async () => {
    const current = await db.medications.get(id);
    if (!current) throw new InvalidMedicationError('This medication no longer exists.', 'gone');
    const updated: Medication = { ...current, ...changes, name };
    await db.medications.put(updated);
    await enqueueMutation(db, {
      babyId: updated.babyId,
      kind: 'upsert',
      entityType: 'medication',
      entityId: id,
      payload: toMedicationUpsertRequest(updated),
      createdAt: now,
    });
    return updated;
  });
}

/** Removes a catalog entry locally and queues `DELETE /babies/{id}/medications/{id}`. */
export async function deleteMedication(
  db: BabyRoutineDb,
  id: string,
  options: CommandOptions = {},
): Promise<void> {
  const now = (options.now?.() ?? new Date()).toISOString();
  await db.transaction('rw', db.medications, db.outbox, async () => {
    const current = await db.medications.get(id);
    if (!current) return;
    await db.medications.delete(id);
    await enqueueMutation(db, {
      babyId: current.babyId,
      kind: 'delete',
      entityType: 'medication',
      entityId: id,
      payload: null,
      createdAt: now,
    });
  });
}
