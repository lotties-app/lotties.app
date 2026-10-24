import type { ApiClient } from '../api/apiClient';
import { listMeasurements } from '../api/measurementsApi';
import type { BabyRoutineDb } from '../db/database';
import type { Baby } from '../db/models';
import { getProfessionalProfile } from '../professional/professionalApi';
import { saveFile } from '../platform/saveFile';

/*
 * "Download my data" in the doctor's shell (/doctor/settings): what she produced as a professional,
 * never her patients' records (a Doctor has no export of a baby, docs/design/16-doctor-access.md):
 * her professional profile, the notes and prescription suggestions she wrote, and the measurements
 * she recorded in consultations. Rows name a patient by its id only. Online: the profile and the
 * measurements come from the server.
 */

const isPatient = (baby: Baby) => baby.role === 'Doctor';

const sharesGrowth = (baby: Baby) =>
  baby.doctorScopes === undefined || baby.doctorScopes.includes('growth');

/** Her data as one JSON-ready object. Throws when the server cannot be reached. */
export async function collectProfessionalData(db: BabyRoutineDb, api: ApiClient, now = new Date()) {
  const patients = (await db.babies.toArray()).filter(isPatient);
  const mine = new Set(patients.map((baby) => baby.userId).filter((id): id is string => !!id));
  const patientIds = new Set(patients.map((baby) => baby.id));
  const wrote = (row: { babyId: string; authorUserId: string | null }) =>
    patientIds.has(row.babyId) && row.authorUserId !== null && mine.has(row.authorUserId);
  const professionalProfile = await getProfessionalProfile(api);
  const notes = (await db.notes.toArray()).filter(wrote);
  const proposals = (await db.proposals.toArray()).filter(wrote);
  const measurements = [];
  for (const baby of patients.filter(sharesGrowth)) {
    const rows = await listMeasurements(api, baby.id);
    measurements.push(...rows.filter((row) => row.createdBy !== null && mine.has(row.createdBy)));
  }
  return {
    app: 'lotties',
    kind: 'professional',
    exportedAt: now.toISOString(),
    professionalProfile,
    notes,
    proposals,
    measurements,
  };
}

/**
 * Saves her data as a JSON file (a browser download, or the share sheet inside the native app).
 * Returns `false` when the browser cannot create object URLs; throws when the server cannot be reached.
 */
export async function downloadProfessionalData(
  db: BabyRoutineDb,
  api: ApiClient,
): Promise<boolean> {
  const data = await collectProfessionalData(db, api);
  return saveFile(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }),
    `lotties-professional-data-${data.exportedAt.slice(0, 10)}.json`,
  );
}
