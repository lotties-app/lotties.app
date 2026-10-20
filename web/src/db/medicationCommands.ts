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
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMedicationError';
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
