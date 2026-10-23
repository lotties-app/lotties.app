import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { seedBaby } from '../test/seed';
import { collectAccountData } from './exportAccountData';

let db: BabyRoutineDb;

beforeEach(async () => {
  db = testDatabase();
  await seedBaby(db);
});

afterEach(async () => {
  await db.delete();
});

describe('collectAccountData', () => {
  it('holds the synced tables and leaves the outbox and caches out', async () => {
    const data = await collectAccountData(db, new Date('2026-10-22T10:00:00Z'));

    expect(data.app).toBe('lotties');
    expect(data.exportedAt).toBe('2026-10-22T10:00:00.000Z');
    expect(Object.keys(data.tables).sort()).toEqual([
      'appointments',
      'babies',
      'eventTypes',
      'events',
      'formulas',
      'medications',
      'notes',
      'prescriptions',
      'vaccinations',
    ]);
    expect(data.tables.babies).toEqual([expect.objectContaining({ id: BABY_ID })]);
  });
});
