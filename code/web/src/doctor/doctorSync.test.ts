import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { Baby, BabyEvent, Note, OutboxMutation } from '../db/models';
import { DEFAULT_BACKOFF } from '../sync/backoff';
import { pullAll } from '../sync/pull';
import type { SyncContext } from '../sync/syncContext';
import { fakeApi, testDatabase, type ApiHandler } from '../test/fakeApi';
import { forgetUnsharedPatientData } from './doctorSync';
import type { DoctorScope } from './scopes';

/*
 * The lean data model of a doctor's patients (docs/design/19-doctor-dashboard.md section 4): her
 * device never keeps a patient's event history, only what she works on offline for the sections the
 * family shares, and it forgets a section as soon as a pull sees it was turned off.
 */

const LIA = 'lia';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await db.delete();
});

const doctorBaby = (doctorScopes?: DoctorScope[]): Baby => ({
  id: LIA,
  name: 'Lia',
  birthDate: '2026-08-01',
  role: 'Doctor',
  userId: 'doc',
  ...(doctorScopes ? { doctorScopes } : {}),
});

const event = (id: string): BabyEvent => ({
  id,
  babyId: LIA,
  typeId: 't',
  startedAt: '2026-10-20T10:00:00.000Z',
  endedAt: null,
  payload: {},
  notes: null,
  createdBy: 'mom',
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
  deletedAt: null,
});

const note = (id: string): Note => ({
  id,
  babyId: LIA,
  authorUserId: 'doc',
  author: null,
  kind: 'note',
  visibility: 'shared',
  body: 'Hello',
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
  deletedAt: null,
});

const mutation = (id: number, entityType: OutboxMutation['entityType']): OutboxMutation => ({
  id,
  babyId: LIA,
  kind: 'upsert',
  entityType,
  entityId: `${entityType}-${id}`,
  payload: {},
  createdAt: '2026-10-20T10:00:00.000Z',
  attempts: 0,
  lastError: null,
  status: 'pending',
  nextAttemptAt: null,
});

async function seedEverything() {
  await db.events.put(event('e1'));
  await db.notes.put(note('n1'));
  await db.medications.put({
    id: 'm1',
    babyId: LIA,
    name: 'Vitamin D',
    defaultDosage: null,
    notes: null,
    isUsual: true,
    productId: null,
    createdAt: '2026-10-01T00:00:00.000Z',
  });
  await db.bodyWeights.put({ babyId: LIA, kg: 5.4, date: '2026-10-10' });
  await db.careProviders.put({
    id: 'p1',
    babyId: LIA,
    name: 'Dr. Ana',
    specialty: null,
    registrationCouncil: null,
    registrationNumber: null,
    registrationRegion: null,
    clinicName: null,
    address: null,
    phone: null,
    whatsapp: null,
    email: null,
    website: null,
    notes: null,
    favorite: false,
    deleted: false,
    createdBy: 'mom',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
  });
  await db.outbox.bulkPut([mutation(1, 'note'), mutation(2, 'proposal')]);
  await db.syncState.bulkPut([
    { babyId: LIA, entity: 'events', lastSyncedAt: '2026-10-20T10:00:00.000Z' },
    { babyId: LIA, entity: 'careProviders', lastSyncedAt: '2026-10-20T10:00:00.000Z' },
    { babyId: LIA, entity: 'notes', lastSyncedAt: '2026-10-20T10:00:00.000Z' },
    { babyId: LIA, entity: 'proposals', lastSyncedAt: '2026-10-20T10:00:00.000Z' },
  ]);
}

const cursors = async () =>
  (await db.syncState.where('babyId').equals(LIA).toArray()).map((row) => row.entity).sort();

describe('forgetting what a family does not share', () => {
  it('never keeps the event history, and keeps every shared section', async () => {
    await seedEverything();

    await forgetUnsharedPatientData(db, doctorBaby());

    expect(await db.events.count()).toBe(0);
    expect(await db.careProviders.count()).toBe(0);
    expect(await db.notes.count()).toBe(1);
    expect(await db.medications.count()).toBe(1);
    expect(await db.bodyWeights.count()).toBe(1);
    expect(await db.outbox.count()).toBe(2);
    expect(await cursors()).toEqual(['notes', 'proposals']);
  });

  it('purges a revoked section: its rows, cursor and queued changes', async () => {
    await seedEverything();

    await forgetUnsharedPatientData(db, doctorBaby(['daily_log', 'vaccines']));

    expect(await db.notes.count()).toBe(0);
    expect(await db.medications.count()).toBe(0);
    expect(await db.bodyWeights.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
    expect(await cursors()).toEqual([]);
  });

  it('touches no baby of the family', async () => {
    await seedEverything();

    await forgetUnsharedPatientData(db, { ...doctorBaby([]), role: 'Owner' });

    expect(await db.events.count()).toBe(1);
    expect(await db.careProviders.count()).toBe(1);
    expect(await db.notes.count()).toBe(1);
  });
});

function ctxWith(handler: ApiHandler) {
  const fake = fakeApi(handler);
  const ctx: SyncContext = {
    db,
    api: fake.api,
    now: () => Date.now(),
    backoff: DEFAULT_BACKOFF,
    requestTimeoutMs: 30_000,
  };
  return { ctx, ...fake };
}

describe('pulling a patient', () => {
  const serverBaby = (doctorScopes: string[] | null) => ({
    id: LIA,
    name: 'Lia',
    birthDate: '2026-08-01',
    role: 'Doctor',
    userId: 'doc',
    doctorScopes,
  });

  it('pulls only the shared sections she works on, never the events', async () => {
    const { ctx, calls } = ctxWith((call) =>
      call.path === '/api/v1/babies' ? [serverBaby(['daily_log', 'notes'])] : undefined,
    );

    expect(await pullAll(ctx)).toEqual([]);

    const paths = calls.map((call) => call.path.split('?')[0]);
    expect(paths).toEqual(['/api/v1/babies', `/api/v1/babies/${LIA}/notes`]);
    expect((await db.babies.get(LIA))?.doctorScopes).toEqual(['daily_log', 'notes']);
  });

  it('pulls medications, prescriptions, her proposals and the weight when they are shared', async () => {
    const { ctx, calls } = ctxWith((call) =>
      call.path === '/api/v1/babies' ? [serverBaby(null)] : undefined,
    );

    await pullAll(ctx);

    const paths = calls.map((call) => call.path.split('?')[0]);
    expect(paths).toEqual([
      '/api/v1/babies',
      `/api/v1/babies/${LIA}/medications`,
      `/api/v1/babies/${LIA}/prescriptions`,
      `/api/v1/babies/${LIA}/prescription-proposals`,
      `/api/v1/babies/${LIA}/notes`,
      `/api/v1/babies/${LIA}/measurements`,
    ]);
    expect(paths.some((path) => path.endsWith('/events'))).toBe(false);
    expect(paths.some((path) => path.endsWith('/members'))).toBe(false);
  });

  it('forgets a section on the first pull after the family turned it off', async () => {
    await db.babies.put(doctorBaby());
    await seedEverything();
    const { ctx } = ctxWith((call) =>
      call.path === '/api/v1/babies' ? [serverBaby(['growth'])] : undefined,
    );

    await pullAll(ctx);

    expect(await db.notes.count()).toBe(0);
    expect(await db.medications.count()).toBe(0);
    expect(await db.events.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });
});
