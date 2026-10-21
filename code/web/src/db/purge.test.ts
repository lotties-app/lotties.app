import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readSelectedBabyId, writeSelectedBabyId } from '../baby/selectedBabyStorage';
import { readCachedPredictions, writeCachedPredictions } from '../predictions/predictionsCache';
import { DEFAULT_BACKOFF } from '../sync/backoff';
import { refreshBabies } from '../sync/pull';
import { BABY_ID, fakeApi, testDatabase } from '../test/fakeApi';
import { EVENT_TYPES } from '../test/seed';
import type { BabyRoutineDb } from './database';
import { enqueueMutation } from './outbox';
import { purgeBabyData } from './purge';

let db: BabyRoutineDb;
const OTHER = 'baby-2';

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await db.delete();
});

async function seedBabyData(babyId: string) {
  await db.babies.put({ id: babyId, name: babyId, birthDate: '2026-08-01', role: 'Parent' });
  await db.eventTypes.put({ ...EVENT_TYPES[0], id: `type-${babyId}`, babyId });
  await db.medications.put({
    id: `med-${babyId}`,
    babyId,
    name: 'Drops',
    defaultDosage: null,
    notes: null,
    isUsual: false,
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  await db.events.put({
    id: `evt-${babyId}`,
    babyId,
    typeId: 'type-feeding',
    startedAt: '2026-10-20T08:00:00.000Z',
    endedAt: null,
    payload: {},
    notes: null,
    createdBy: null,
    createdAt: '2026-10-20T08:00:00.000Z',
    updatedAt: '2026-10-20T08:00:00.000Z',
    deletedAt: null,
  });
  await enqueueMutation(db, {
    babyId,
    kind: 'delete',
    entityType: 'event',
    entityId: `evt-${babyId}`,
    payload: null,
    createdAt: '2026-10-20T08:00:00.000Z',
  });
  await db.syncState.put({ babyId, entity: 'events', lastSyncedAt: '2026-10-20T08:00:00.000Z' });
  writeCachedPredictions(babyId, {
    data: { babyId, generatedAt: 'x', predictions: [], insufficientData: [] },
    fetchedAt: 1,
  });
}

async function counts(babyId: string) {
  return [
    await db.babies.where('id').equals(babyId).count(),
    await db.events.where('babyId').equals(babyId).count(),
    await db.eventTypes.where('babyId').equals(babyId).count(),
    await db.medications.where('babyId').equals(babyId).count(),
    await db.outbox.where('babyId').equals(babyId).count(),
    await db.syncState.where('babyId').equals(babyId).count(),
  ];
}

describe('purgeBabyData', () => {
  it('removes one baby everywhere and leaves the others alone', async () => {
    await seedBabyData(BABY_ID);
    await seedBabyData(OTHER);
    writeSelectedBabyId(BABY_ID);

    await purgeBabyData(db, BABY_ID);

    expect(await counts(BABY_ID)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(await counts(OTHER)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(readSelectedBabyId()).toBeNull();
    expect(readCachedPredictions(BABY_ID)).toBeUndefined();
    expect(readCachedPredictions(OTHER)).toBeDefined();
  });

  it('keeps the selection when it points at another baby', async () => {
    await seedBabyData(BABY_ID);
    writeSelectedBabyId(OTHER);
    await purgeBabyData(db, BABY_ID);
    expect(readSelectedBabyId()).toBe(OTHER);
  });
});

describe('refreshBabies', () => {
  it('purges a baby the server no longer lists, including cached state', async () => {
    await seedBabyData(BABY_ID);
    await seedBabyData(OTHER);
    writeSelectedBabyId(OTHER);
    const { api } = fakeApi(); // default: the server lists only BABY_ID

    const ids = await refreshBabies({
      db,
      api,
      now: () => Date.now(),
      backoff: DEFAULT_BACKOFF,
      requestTimeoutMs: 30_000,
    });

    expect(ids).toEqual([BABY_ID]);
    expect(await counts(OTHER)).toEqual([0, 0, 0, 0, 0, 0]);
    expect((await counts(BABY_ID)).slice(1)).toEqual([1, 1, 1, 1, 1]);
    expect(readSelectedBabyId()).toBeNull();
    expect(readCachedPredictions(OTHER)).toBeUndefined();
    expect(readCachedPredictions(BABY_ID)).toBeDefined();
  });
});
