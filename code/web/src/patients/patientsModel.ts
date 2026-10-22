import Dexie from 'dexie';
import type { BabyRoutineDb } from '../db/database';
import type { Baby } from '../db/models';
import { sharedNotesBy } from '../notes/noteModel';

/** One baby on the doctor's Patients list. */
export interface PatientRow {
  baby: Baby;
  /** Start of the latest entry logged for the baby (UTC ISO), or `null` without any. */
  lastEventAt: string | null;
  /** The doctor's own shared notes on the baby (not deleted). */
  sharedNotes: number;
}

/** The babies where the user is the Doctor, by name. */
export function patientBabies(babies: readonly Baby[]): Baby[] {
  return babies
    .filter((baby) => baby.role === 'Doctor')
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/** Whether the user only follows babies as their Doctor (no baby of her own): Patients is home. */
export function isDoctorOnly(babies: readonly Baby[] | undefined): boolean {
  return !!babies && babies.length > 0 && babies.every((baby) => baby.role === 'Doctor');
}

async function lastEventAt(db: BabyRoutineDb, babyId: string): Promise<string | null> {
  const latest = await db.events
    .where('[babyId+startedAt]')
    .between([babyId, Dexie.minKey], [babyId, Dexie.maxKey])
    .reverse()
    .filter((event) => event.deletedAt === null)
    .first();
  return latest?.startedAt ?? null;
}

/** The Patients list rows, from the device (every patient is synced like any baby). */
export async function patientRows(db: BabyRoutineDb): Promise<PatientRow[]> {
  const patients = patientBabies(await db.babies.toArray());
  return Promise.all(
    patients.map(async (baby) => ({
      baby,
      lastEventAt: await lastEventAt(db, baby.id),
      sharedNotes: sharedNotesBy(
        await db.notes.where('babyId').equals(baby.id).toArray(),
        baby.userId,
      ),
    })),
  );
}

const CHOSEN_KEY = 'baby-routine.patient-chosen';

/** Whether the doctor opened a patient in this browser session (then `/` shows that patient). */
export function patientChosenThisSession(): boolean {
  try {
    return window.sessionStorage.getItem(CHOSEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markPatientChosen(): void {
  try {
    window.sessionStorage.setItem(CHOSEN_KEY, '1');
  } catch {
    // Storage unavailable: Patients stays the landing page.
  }
}
