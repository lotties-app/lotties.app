import { clearCachedPredictions } from '../predictions/predictionsCache';
import { clearPinned } from '../presets/pinnedStorage';
import { clearSelectedBabyId } from '../baby/selectedBabyStorage';
import { clearLastUsedForBaby } from '../events/lastUsedValues';
import { clearLastSeen } from '../now/lastSeen';
import type { BabyRoutineDb } from './database';

/** Tables a transaction must include to use `deleteBabyRows` (all of a baby's local data). */
export function purgeTables(db: BabyRoutineDb) {
  return [
    db.babies,
    db.events,
    db.eventTypes,
    db.medications,
    db.prescriptions,
    db.formulas,
    db.appointments,
    db.vaccinations,
    db.notes,
    db.proposals,
    db.noteReads,
    db.bodyWeights,
    db.outbox,
    db.syncState,
  ];
}

/**
 * Deletes every local row of the given babies (events, event types, medications, outbox, sync
 * cursors and the baby row). Must run inside a transaction that over `purgeTables`.
 */
export async function deleteBabyRows(db: BabyRoutineDb, babyIds: string[]): Promise<void> {
  if (babyIds.length === 0) return;
  await db.events.where('babyId').anyOf(babyIds).delete();
  await db.eventTypes.where('babyId').anyOf(babyIds).delete();
  await db.medications.where('babyId').anyOf(babyIds).delete();
  await db.prescriptions.where('babyId').anyOf(babyIds).delete();
  await db.formulas.where('babyId').anyOf(babyIds).delete();
  await db.appointments.where('babyId').anyOf(babyIds).delete();
  await db.vaccinations.where('babyId').anyOf(babyIds).delete();
  await db.notes.where('babyId').anyOf(babyIds).delete();
  await db.proposals.where('babyId').anyOf(babyIds).delete();
  await db.noteReads.where('babyId').anyOf(babyIds).delete();
  await db.bodyWeights.where('babyId').anyOf(babyIds).delete();
  await db.outbox.where('babyId').anyOf(babyIds).delete();
  await db.syncState.where('babyId').anyOf(babyIds).delete();
  await db.babies.bulkDelete(babyIds);
}

/**
 * Per-device leftovers outside IndexedDB: the saved selection, cached predictions, pinned presets,
 * remembered field values and the Now "last seen" time.
 */
export function clearBabyDeviceState(babyIds: string[]): void {
  for (const id of babyIds) {
    clearSelectedBabyId(id);
    clearCachedPredictions(id);
    clearPinned(id);
    clearLastUsedForBaby(id);
    clearLastSeen(id);
  }
}

/** Removes a baby from this device (after leaving it, or when the server no longer lists it). */
export async function purgeBabyData(db: BabyRoutineDb, babyId: string): Promise<void> {
  await db.transaction('rw', purgeTables(db), () => deleteBabyRows(db, [babyId]));
  clearBabyDeviceState([babyId]);
}
