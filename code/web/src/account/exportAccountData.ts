import type { BabyRoutineDb } from '../db/database';

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
 * Saves the account data as a JSON file through a Blob link. Returns `false` when the browser cannot
 * create object URLs. Not available inside the native shell (a download link goes nowhere there).
 */
export async function downloadAccountData(db: BabyRoutineDb): Promise<boolean> {
  if (typeof URL.createObjectURL !== 'function') return false;
  const data = await collectAccountData(db);
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `lotties-data-${data.exportedAt.slice(0, 10)}.json`;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
