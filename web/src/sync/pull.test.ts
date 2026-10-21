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
  withHeaders,
  type ApiCall,
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

const eventsPath = `/api/v1/babies/${BABY_ID}/events`;
const eventGets = (calls: ApiCall[]) =>
  calls.filter((c) => c.path.startsWith(eventsPath)).map((c) => c.path);

describe('delta cursor', () => {
  it('pulls without `since` first, stores the raw newest updatedAt and re-pulls with a 5 s overlap', async () => {
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
    expect(eventGets(calls)).toEqual([
      eventsPath,
      `${eventsPath}?since=${encodeURIComponent('2026-10-20T11:59:55.123Z')}`,
    ]);
    expect((await cursor())?.lastSyncedAt).toBe(raw);
  });

  it('re-merges overlap rows idempotently without moving the cursor backwards', async () => {
    const stored = '2026-10-20T12:00:00.000Z';
    await db.syncState.put({ babyId: BABY_ID, entity: 'events', lastSyncedAt: stored });
    await seedLocal({ id: 'seen', notes: 'v1', updatedAt: '2026-10-20T11:59:58.000Z' });
    const { ctx, calls } = ctxWith(
      deltaHandler([
        // Already merged before (same version) and a row that committed late, inside the overlap.
        serverEvent({ id: 'seen', notes: 'v1', updatedAt: '2026-10-20T11:59:58.000Z' }),
        serverEvent({ id: 'late', updatedAt: '2026-10-20T11:59:57.000Z' }),
      ]),
    );

    await pullAll(ctx);

    expect(eventGets(calls)).toEqual([
      `${eventsPath}?since=${encodeURIComponent('2026-10-20T11:59:55.000Z')}`,
    ]);
    expect(await db.events.get('late')).toBeDefined();
    expect((await db.events.get('seen'))?.notes).toBe('v1');
    expect((await cursor())?.lastSyncedAt).toBe(stored);
  });

  it('follows X-Next-Cursor pages with `after`, keeping rows that share an updatedAt', async () => {
    const tie = '2026-10-20T12:00:00.000Z';
    const { ctx, calls } = ctxWith((call) => {
      if (!call.path.startsWith(eventsPath)) return undefined;
      if (call.path.includes('after=c%2F1')) {
        return withHeaders(
          [serverEvent({ id: 'c', updatedAt: tie }), serverEvent({ id: 'd', updatedAt: tie })],
          { 'X-Next-Cursor': 'c/2' },
        );
      }
      if (call.path.includes('after=c%2F2')) return [serverEvent({ id: 'e', updatedAt: tie })];
      return withHeaders(
        [serverEvent({ id: 'a', updatedAt: tie }), serverEvent({ id: 'b', updatedAt: tie })],
        { 'X-Next-Cursor': 'c/1' },
      );
    });

    await pullAll(ctx);

    expect(eventGets(calls)).toEqual([
      eventsPath,
      `${eventsPath}?after=${encodeURIComponent('c/1')}`,
      `${eventsPath}?after=${encodeURIComponent('c/2')}`,
    ]);
    expect((await db.events.toArray()).map((e) => e.id).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect((await cursor())?.lastSyncedAt).toBe(tie);
  });

  it('advances the cursor per committed page when a later page fails', async () => {
    const { ctx } = ctxWith((call) => {
      if (!call.path.startsWith(eventsPath)) return undefined;
      if (call.path.includes('after=')) throw networkError();
      return withHeaders([serverEvent({ id: 'a', updatedAt: '2026-10-20T10:00:00.000Z' })], {
        'X-Next-Cursor': 'next',
      });
    });

    await expect(pullAll(ctx)).rejects.toThrow('Failed to fetch');

    expect(await db.events.get('a')).toBeDefined();
    expect((await cursor())?.lastSyncedAt).toBe('2026-10-20T10:00:00.000Z');
  });

  it('stops paging when the server repeats a cursor', async () => {
    const { ctx, calls } = ctxWith((call) =>
      call.path.startsWith(eventsPath)
        ? withHeaders([serverEvent()], { 'X-Next-Cursor': 'same' })
        : undefined,
    );

    const errors = await pullAll(ctx);

    expect(eventGets(calls)).toHaveLength(2);
    expect(errors).toEqual([expect.stringContaining('same cursor twice')]);
    expect(await db.events.count()).toBe(1);
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
