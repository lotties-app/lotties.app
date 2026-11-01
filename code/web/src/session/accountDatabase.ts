import Dexie from 'dexie';
import { createDatabase, type BabyRoutineDb } from '../db/database';
import { sha256Hex } from './sha256';

/** The single shared database used before per-account databases (dropped, pre-release). */
export const LEGACY_DATABASE_NAME = 'baby-routine';

/**
 * Local database name of an account (`AuthApi.accountId`): `BabyRoutineDb-` plus the first 16
 * hex chars of SHA-256(`issuer|sub`). Each account on a device gets its own store, so a user switch never
 * shows (or replays) another account's data and queue; the hash keeps the subject out of the name.
 */
export function accountDatabaseName(accountId: string): string {
  return `BabyRoutineDb-${sha256Hex(accountId).slice(0, 16)}`;
}

export function openAccountDatabase(accountId: string): BabyRoutineDb {
  return createDatabase(accountDatabaseName(accountId));
}

/**
 * Deletes the pre-release shared database. Its rows belong to an unknown account, so they are
 * dropped rather than migrated (unsynced changes in it are lost; accepted before the first release).
 */
export async function deleteLegacyDatabase(): Promise<void> {
  try {
    if (await Dexie.exists(LEGACY_DATABASE_NAME)) await Dexie.delete(LEGACY_DATABASE_NAME);
  } catch {
    // IndexedDB unavailable or the delete is blocked: retried on the next start.
  }
}
