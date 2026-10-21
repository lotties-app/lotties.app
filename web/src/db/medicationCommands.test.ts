import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BabyRoutineDb, SCHEMA_VERSIONS } from './database';
import {
  createMedication,
  deleteMedication,
  InvalidMedicationError,
  updateMedication,
} from './medicationCommands';
import { DEFAULT_BACKOFF } from '../sync/backoff';
import { refreshCatalogs } from '../sync/pull';
import { pushOutbox } from '../sync/push';
import type { SyncContext } from '../sync/syncContext';
import { BABY_ID, fakeApi, testDatabase, type ApiHandler } from '../test/fakeApi';
import { seedBaby } from '../test/seed';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await db.delete();
});

function ctxWith(handler?: ApiHandler) {
  const fake = fakeApi(handler);
  const ctx: SyncContext = {
    db,
    api: fake.api,
    now: () => Date.parse('2026-10-20T12:00:00.000Z'),
    backoff: DEFAULT_BACKOFF,
    requestTimeoutMs: 1000,
  };
  return { ctx, ...fake };
}

describe('medication commands', () => {
  it('create, update and delete write locally and queue PUT / PUT / DELETE', async () => {
    const created = await createMedication(db, {
      babyId: BABY_ID,
      name: ' Colidis ',
      isUsual: true,
    });
    const updated = await updateMedication(db, created.id, {
      name: 'Colidis Plus',
      defaultDosage: { amount: 5, unit: 'ml' },
      notes: 'after meals',
      isUsual: false,
    });
    expect(updated).toMatchObject({ id: created.id, name: 'Colidis Plus', isUsual: false });
    expect(await db.medications.get(created.id)).toEqual(updated);

    await deleteMedication(db, created.id);
    expect(await db.medications.count()).toBe(0);

    const queue = await db.outbox.orderBy('id').toArray();
    expect(queue.map((m) => [m.kind, m.entityType, m.entityId])).toEqual([
      ['upsert', 'medication', created.id],
      ['upsert', 'medication', created.id],
      ['delete', 'medication', created.id],
    ]);
    expect(queue[1].payload).toEqual({
      name: 'Colidis Plus',
      defaultDosage: { amount: 5, unit: 'ml' },
      notes: 'after meals',
      isUsual: false,
    });
    expect(queue[2].payload).toBeNull();
  });

  it('rejects blank names and unknown medications', async () => {
    await expect(createMedication(db, { babyId: BABY_ID, name: ' ' })).rejects.toBeInstanceOf(
      InvalidMedicationError,
    );
    await expect(
      updateMedication(db, 'nope', { name: 'x', defaultDosage: null, notes: null, isUsual: false }),
    ).rejects.toBeInstanceOf(InvalidMedicationError);
    expect(await db.outbox.count()).toBe(0);
  });

  it('pushes the queued edit as PUT and the delete as DELETE on the medication path', async () => {
    const created = await createMedication(db, { babyId: BABY_ID, name: 'Puravit' });
    const { ctx, writes } = ctxWith((call) => (call.method === 'PUT' ? {} : undefined));
    expect(await pushOutbox(ctx)).toEqual({ kind: 'drained' });

    await updateMedication(db, created.id, {
      name: 'Puravit kids',
      defaultDosage: null,
      notes: null,
      isUsual: true,
    });
    await deleteMedication(db, created.id);
    expect(await pushOutbox(ctx)).toEqual({ kind: 'drained' });

    // The queued edit is superseded by the later delete of the same medication (coalesced).
    const path = `/api/v1/babies/${BABY_ID}/medications/${created.id}`;
    expect(writes().map((c) => [c.method, c.path])).toEqual([
      ['PUT', path],
      ['DELETE', path],
    ]);
    expect(await db.outbox.count()).toBe(0);
  });

  it('does not let a catalog pull undo medication changes that are still queued', async () => {
    await seedBaby(db);
    const kept = await createMedication(db, { babyId: BABY_ID, name: 'Local only' });
    const deleted = await createMedication(db, { babyId: BABY_ID, name: 'Going away' });
    await db.outbox.clear();
    await deleteMedication(db, deleted.id);
    await db.medications.put({ ...kept, name: 'Edited locally' });
    await db.outbox.add({
      babyId: BABY_ID,
      kind: 'upsert',
      entityType: 'medication',
      entityId: kept.id,
      payload: {},
      createdAt: kept.createdAt,
      attempts: 0,
      lastError: null,
      status: 'pending',
      nextAttemptAt: null,
    });
    const server = [
      { ...kept, name: 'Old server name' },
      deleted,
      { ...kept, id: 'm-server', name: 'From server' },
    ];
    const { ctx } = ctxWith((call) =>
      call.path.endsWith('/medications')
        ? server
        : call.path.endsWith('/event-types')
          ? []
          : undefined,
    );

    await refreshCatalogs(ctx, BABY_ID);

    const names = (await db.medications.toArray()).map((m) => m.name).sort();
    expect(names).toEqual(['Edited locally', 'From server']);
  });
});

describe('schema v2 migration', () => {
  it('gives babies saved without a role the Parent role', async () => {
    const name = `migrate-${crypto.randomUUID()}`;
    const v1 = SCHEMA_VERSIONS[0];
    const old = new Dexie(name);
    old.version(1).stores(v1.stores as Record<string, string>);
    await old.table('babies').put({ id: 'b1', name: 'Lia', birthDate: '2026-08-01' });
    old.close();

    const upgraded = new BabyRoutineDb(name);
    expect(await upgraded.babies.get('b1')).toEqual({
      id: 'b1',
      name: 'Lia',
      birthDate: '2026-08-01',
      role: 'Parent',
    });
    await upgraded.delete();
  });
});
