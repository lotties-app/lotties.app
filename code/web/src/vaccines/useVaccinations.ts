import { useLiveQuery } from 'dexie-react-hooks';
import { useDatabase } from '../db/DatabaseContext';
import type { Vaccination } from '../db/models';
import {
  createVaccination,
  deleteVaccination,
  updateVaccination,
  type VaccinationTerms,
} from '../db/vaccinationCommands';
import { byNewestGiven } from './vaccinationModel';

/** The baby's vaccination records that are not deleted, newest first (`undefined` while loading). */
export function useVaccinations(babyId: string): Vaccination[] | undefined {
  const db = useDatabase();
  return useLiveQuery(async () => {
    const list = await db.vaccinations.where('babyId').equals(babyId).toArray();
    return list.filter((v) => v.deletedAt === null).sort(byNewestGiven);
  }, [db, babyId]);
}

/** Vaccination commands bound to the account's database (saved on the device, queued for sync). */
export function useVaccinationCommands() {
  const db = useDatabase();
  return {
    create: (babyId: string, terms: VaccinationTerms) => createVaccination(db, babyId, terms),
    update: (id: string, terms: VaccinationTerms) => updateVaccination(db, id, terms),
    remove: (id: string) => deleteVaccination(db, id),
  };
}
