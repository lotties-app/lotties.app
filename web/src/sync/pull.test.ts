import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { createEvent } from '../db/eventCommands';
import type { BabyEvent } from '../db/models';
import {
  BABY_ID,
  TYPE_ID,
  fakeApi,
  networkError,
  serverEvent,
  testDatabase,
  type ApiHandler,
} from '../test/fakeApi';
import { DEFAULT_BACKOFF } from './backoff';
import { fromEventDto, type EventDto } from './contract';
import { mergeEventDelta, pullAll } from './pull';
import { SyncEngine } from './SyncEngine';
import type { SyncContext } from './syncContext';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete();
});

function ctxWith(handler?: ApiHandler) {
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

function deltaHandler(...pages: EventDto[][]): ApiHandler {
  return (call) => (call.path.includes('/events') ? (pages.shift() ?? []) : undefined);
}

const cursor = () => db.syncState.get([BABY_ID, 'events']);

async function seedLocal(overrides: Partial<BabyEvent>) {
  const event = { ...fromEventDto(serverEvent()), ...overrides };
  await db.events.put(event);
  return event;
}

describe('delta merge (last write wins)', () => {
  it('inserts new events and applies newer remote versions, including deletions', async () => {
    await seedLocal({ id: 'evt-old', notes: 'local', updatedAt: '2026-10-20T09:00:00.000Z' });
    await mergeEventDelta(db, BABY_ID, [
      serverEvent({ id: 'evt-new' }),
      serverEvent({
        id: 'evt-old',
        notes: 'remote',
        updatedAt: '2026-10-20T10:00:00+00:00',
        deletedAt: '2026-10-20T10:00:00+00:00',
      }),
    ]);

    expect(await db.events.get('evt-new')).toBeDefined();
    expect(await db.events.get('evt-old')).toMatchObject({
      notes: 'remote',
      updatedAt: '2026-10-20T10:00:00.000Z',
      deletedAt: '2026-10-20T10:00:00.000Z',
    });
  });

  it('keeps the local copy when it is newer than the remote one', async () => {
    await seedLocal({ id: 'evt-1', notes: 'local', updatedAt: '2026-10-20T11:00:00.000Z' });

    await mergeEventDelta(db, BABY_ID, [
      serverEvent({ id: 'evt-1', notes: 'stale', updatedAt: '2026-10-20T10:59:59.999Z' }),
    ]);

    expect((await db.events.get('evt-1'))?.notes).toBe('local');
  });

  it('never overwrites an event with a pending local mutation', async () => {
    const local = await createEvent(db, { babyId: BABY_ID, typeId: TYPE_ID, notes: 'mine' });

    await mergeEventDelta(db, BABY_ID, [
      serverEvent({ id: local.id, notes: 'theirs', updatedAt: '2030-01-01T00:00:00.000Z' }),
    ]);

    expect(await db.events.get(local.id)).toEqual(local);
  });
});

describe('delta cursor', () => {
  it('pulls without `since` first, stores the raw newest updatedAt and sends it back', async () => {
    const raw = '2026-10-20T12:00:00.1234567+00:00';
    const { ctx, calls } = ctxWith(
      deltaHandler(
        [
          serverEvent({ id: 'a', updatedAt: '2026-10-20T11:00:00Z' }),
          serverEvent({ id: 'b', updatedAt: raw }),
        ],
        [],
      ),
    );

    await pullAll(ctx);
    expect(await cursor()).toMatchObject({ lastSyncedAt: raw });

    await pullAll(ctx);
    const eventGets = calls.filter((c) => c.path.includes('/events')).map((c) => c.path);
    expect(eventGets).toEqual([
      `/api/v1/babies/${BABY_ID}/events`,
      `/api/v1/babies/${BABY_ID}/events?since=${encodeURIComponent(raw)}`,
    ]);
    expect((await cursor())?.lastSyncedAt).toBe(raw);
  });

  it('does not advance the cursor when the merge transaction fails', async () => {
    await db.syncState.put({
      babyId: BABY_ID,
      entity: 'events',
      lastSyncedAt: '2026-10-19T00:00:00Z',
    });
    vi.spyOn(db.events, 'bulkPut').mockRejectedValueOnce(new Error('disk full'));

    await expect(mergeEventDelta(db, BABY_ID, [serverEvent()])).rejects.toThrow('disk full');

    expect((await cursor())?.lastSyncedAt).toBe('2026-10-19T00:00:00Z');
    expect(await db.events.count()).toBe(0);
  });

  it('does not advance the cursor when the pull request fails', async () => {
    const { api } = fakeApi((call) => {
      if (call.path.includes('/events')) throw networkError();
    });
    const engine = new SyncEngine({
      db,
      api,
      locks: null,
      eventTarget: null,
      isOnline: () => true,
    });

    await engine.syncNow();

    expect(await cursor()).toBeUndefined();
    expect(engine.status.getSnapshot().state).toBe('offline');
  });
});

describe('reference data', () => {
  it('replaces babies, event types and medications from the server', async () => {
    await db.babies.put({ id: 'gone', name: 'Old', birthDate: '2025-01-01' });
    const { ctx } = ctxWith((call) => {
      if (call.path.endsWith('/event-types')) {
        return [
          {
            id: 't-builtin',
            babyId: null,
            key: 'sleep',
            name: 'Sleep',
            icon: 'bed',
            color: '#000000',
            hasDuration: true,
            fields: [],
          },
          {
            id: 't-custom',
            babyId: BABY_ID,
            key: 'pain',
            name: 'Pain',
            icon: 'mood',
            color: '#ff0000',
            hasDuration: false,
            fields: [{ key: 'intensity', label: 'Intensity', kind: 'Number', min: 1, max: 5 }],
          },
        ];
      }
      if (call.path.endsWith('/medications')) {
        return [
          {
            id: 'm1',
            babyId: BABY_ID,
            name: 'Colidis',
            isUsual: true,
            createdAt: '2026-10-01T00:00:00Z',
          },
        ];
      }
    });

    await pullAll(ctx);

    expect(await db.babies.toArray()).toEqual([
      { id: BABY_ID, name: 'Lia', birthDate: '2026-08-01' },
    ]);
    const custom = await db.eventTypes.get('t-custom');
    expect(custom?.fields[0]).toMatchObject({
      kind: 'number',
      isRequired: false,
      options: [],
      min: 1,
    });
    expect(await db.eventTypes.get('t-builtin')).toMatchObject({ babyId: null });
    expect(await db.medications.get('m1')).toMatchObject({ defaultDosage: null, notes: null });
  });
});
