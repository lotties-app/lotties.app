import type { BabyRoutineDb } from '../db/database';
import type { Baby, MutationEntityType, SyncEntity } from '../db/models';
import { pendingEntityIds } from '../db/outbox';
import { pullNotes } from '../notes/noteSync';
import { pullProposals } from '../proposals/proposalSync';
import { apiPaths, fromMedicationDto, type MedicationDto } from '../sync/contract';
import { syncRequest, type SyncContext } from '../sync/syncContext';
import { scopesOf, type DoctorScope } from './scopes';

/*
 * The lean data model of a doctor's patients (docs/design/19-doctor-dashboard.md section 4). A
 * doctor may follow dozens of babies: her device never keeps their event history, formulas,
 * vaccinations or event types (the dashboard reads them on demand from the server), nor the
 * family's appointments and care providers (never a doctor's). What still
 * syncs is what she writes and works on offline, each only while its section is shared:
 *  - notes: her notes and the shared ones (`notes`);
 *  - medications: the baby's medication list and prescriptions (the Prescribe sheet and "Propose a
 *    change") and her own proposals (`medications`);
 *  - growth: the latest weight, for per-kg doses in the Prescribe sheet (`growth`).
 * When the owner turns a section off, the next pull forgets its rows (and queued changes) here.
 */

/** Tables a doctor's device never keeps for a patient, whatever was shared. */
const NEVER_KEPT_CURSORS: readonly SyncEntity[] = [
  'events',
  'formulas',
  'appointments',
  'careProviders',
  'vaccinations',
  'noteReads',
];

/** What each section keeps on the device: cursors and queued change kinds to forget with it. */
const KEPT_BY_SCOPE: Partial<
  Record<DoctorScope, { cursors: SyncEntity[]; mutations: MutationEntityType[] }>
> = {
  notes: { cursors: ['notes'], mutations: ['note'] },
  medications: { cursors: ['prescriptions', 'proposals'], mutations: ['proposal'] },
};

function forgetTables(db: BabyRoutineDb) {
  return [
    db.events,
    db.eventTypes,
    db.formulas,
    db.appointments,
    db.careProviders,
    db.vaccinations,
    db.noteReads,
    db.notes,
    db.medications,
    db.prescriptions,
    db.proposals,
    db.bodyWeights,
    db.outbox,
    db.syncState,
  ];
}

async function forgetCursors(db: BabyRoutineDb, babyId: string, entities: readonly SyncEntity[]) {
  await db.syncState.bulkDelete(entities.map((entity) => [babyId, entity] as [string, SyncEntity]));
}

async function forgetMutations(
  db: BabyRoutineDb,
  babyId: string,
  types: readonly MutationEntityType[],
) {
  if (types.length === 0) return;
  await db.outbox
    .where('babyId')
    .equals(babyId)
    .filter((mutation) => types.includes(mutation.entityType))
    .delete();
}

/**
 * Removes from the device what a doctor's patient must not keep: always the event history and the
 * other on-demand data, plus the rows of every section the family did not share (or stopped
 * sharing). Safe to run on every pull: it deletes nothing that is still shared.
 */
export async function forgetUnsharedPatientData(
  db: BabyRoutineDb,
  baby: Pick<Baby, 'id' | 'role' | 'doctorScopes'>,
): Promise<void> {
  // The family's own babies keep their full sync.
  if (baby.role !== 'Doctor') return;
  const babyId = baby.id;
  const scopes = scopesOf(baby);
  await db.transaction('rw', forgetTables(db), async () => {
    await db.events.where('babyId').equals(babyId).delete();
    await db.eventTypes.where('babyId').equals(babyId).delete();
    await db.formulas.where('babyId').equals(babyId).delete();
    await db.appointments.where('babyId').equals(babyId).delete();
    await db.careProviders.where('babyId').equals(babyId).delete();
    await db.vaccinations.where('babyId').equals(babyId).delete();
    await db.noteReads.where('babyId').equals(babyId).delete();
    await forgetCursors(db, babyId, NEVER_KEPT_CURSORS);
    if (!scopes.includes('notes')) {
      await db.notes.where('babyId').equals(babyId).delete();
      await forgetCursors(db, babyId, KEPT_BY_SCOPE.notes?.cursors ?? []);
      await forgetMutations(db, babyId, KEPT_BY_SCOPE.notes?.mutations ?? []);
    }
    if (!scopes.includes('medications')) {
      await db.medications.where('babyId').equals(babyId).delete();
      await db.prescriptions.where('babyId').equals(babyId).delete();
      await db.proposals.where('babyId').equals(babyId).delete();
      await forgetCursors(db, babyId, KEPT_BY_SCOPE.medications?.cursors ?? []);
      await forgetMutations(db, babyId, KEPT_BY_SCOPE.medications?.mutations ?? []);
    }
    if (!scopes.includes('growth')) await db.bodyWeights.delete(babyId);
  });
}

/** The baby's medication list (the Prescribe sheet's own list); queued local changes are kept. */
async function refreshMedications(ctx: SyncContext, babyId: string): Promise<void> {
  const medications = await syncRequest<MedicationDto[]>(ctx, apiPaths.medications(babyId));
  const { db } = ctx;
  await db.transaction('rw', db.medications, db.outbox, async () => {
    const pending = await pendingEntityIds(db, babyId);
    await db.medications
      .where('babyId')
      .equals(babyId)
      .filter((m) => !pending.has(m.id))
      .delete();
    await db.medications.bulkPut(
      (Array.isArray(medications) ? medications : [])
        .filter((m) => !pending.has(m.id))
        .map(fromMedicationDto),
    );
  });
}

export interface PatientPulls {
  pullPrescriptions: (ctx: SyncContext, babyId: string) => Promise<void>;
  refreshLatestWeight: (ctx: SyncContext, babyId: string) => Promise<void>;
}

/**
 * One patient of a doctor in `pullAll`: forget what is not (or no longer) shared, then pull only
 * the shared sections she works on offline. The parents' full pull never runs for her patients.
 */
export async function pullDoctorPatient(
  ctx: SyncContext,
  baby: Baby,
  pulls: PatientPulls,
): Promise<void> {
  await forgetUnsharedPatientData(ctx.db, baby);
  const scopes = scopesOf(baby);
  if (scopes.includes('medications')) {
    await refreshMedications(ctx, baby.id);
    await pulls.pullPrescriptions(ctx, baby.id);
    await pullProposals(ctx, baby.id);
  }
  if (scopes.includes('notes')) await pullNotes(ctx, baby.id);
  if (scopes.includes('growth')) await pulls.refreshLatestWeight(ctx, baby.id);
}
