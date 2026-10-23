import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgeNormSet } from '../ageNorms/ageNorms';
import { AGE_NORMS_KEY } from '../ageNorms/ageNormsCache';
import type { BabyRoutineDb } from '../db/database';

/*
 * The real age norms the API serves (code/api/data/age-norms.json): published facts, no child
 * data, so tests read the shipped file instead of a copy (the tests run from code/web).
 */
export const SHIPPED_AGE_NORMS = JSON.parse(
  readFileSync(resolve(process.cwd(), '../api/data/age-norms.json'), 'utf8'),
) as AgeNormSet;

/** Stores `norms` as the device copy, checked at `checkedAt` (default: now, so no refresh runs). */
export async function seedAgeNorms(
  db: BabyRoutineDb,
  norms: AgeNormSet = SHIPPED_AGE_NORMS,
  etag: string | null = '"agenorms-test"',
  checkedAt: string = new Date().toISOString(),
): Promise<void> {
  await db.ageNorms.put({ key: AGE_NORMS_KEY, etag, norms, fetchedAt: checkedAt, checkedAt });
}
