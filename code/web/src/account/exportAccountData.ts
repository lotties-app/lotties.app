import type { BabyRoutineDb } from '../db/database';
import { saveFile } from '../platform/saveFile';

/** The synced tables of the account database; the outbox and caches are not the user's data. */
const EXPORTED_TABLES = [
  'babies',
  'eventTypes',
  'medications',
  'events',
  'prescriptions',
  'formulas',
  'appointments',
  'notes',
  'vaccinations',
] as const;

/** Everything the account database holds, as one JSON-ready object. */
export async function collectAccountData(db: BabyRoutineDb, now = new Date()) {
  const tables: Record<string, unknown[]> = {};
  for (const name of EXPORTED_TABLES) tables[name] = await db[name].toArray();
  return { app: 'lotties', exportedAt: now.toISOString(), tables };
}

/**
 * Saves the account data as a JSON file: a browser download, or the share sheet inside the native app.
 * Returns `false` when the browser cannot create object URLs.
 */
export async function downloadAccountData(db: BabyRoutineDb): Promise<boolean> {
  const data = await collectAccountData(db);
  return saveFile(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }),
    `lotties-data-${data.exportedAt.slice(0, 10)}.json`,
  );
}
