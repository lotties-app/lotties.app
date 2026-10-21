import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { createEvent, editEvent } from '../db/eventCommands';
import { createMedication, updateMedication } from '../db/medicationCommands';
import { fromEventDto } from './contract';
import {
  BABY_ID,
  TYPE_ID,
  fakeApi,
  httpError,
  networkError,
  serverEvent,
  testDatabase,
  type ApiCall,
  type ApiHandler,
} from '../test/fakeApi';
import { MAX_SERVER_FAILURES } from './push';
import { SyncEngine } from './SyncEngine';

let db: BabyRoutineDb;
let engines: SyncEngine[];

beforeEach(() => {
  db = testDatabase();
  engines = [];
});

afterEach(async () => {
  engines.forEach((e) => e.stop());
  vi.useRealTimers();
  await db.delete();
});

function setup(handler?: ApiHandler) {
  const fake = fakeApi(handler);
  const engine = new SyncEngine({
    db,
    api: fake.api,
    locks: null,
    eventTarget: null,
    isOnline: () => true,
    backoff: { baseMs: 1_000, maxMs: 60_000, random: () => 0.5 },
  });
  engines.push(engine);
  return { engine, ...fake };
}

const isPut = (c: ApiCall) => c.method === 'PUT';
const eventIdOf = (c: ApiCall) => c.path.split('/').pop();
const newEvent = () => createEvent(db, { babyId: BABY_ID, typeId: TYPE_ID });

/** Runs syncs, letting each backoff elapse, until `done` or `max` runs. */
async function syncThroughBackoff(engine: SyncEngine, runs: number) {
  for (let i = 0; i < runs; i++) {
    await engine.syncNow();
    await vi.advanceTimersByTimeAsync(60_000);
    await engine.whenIdle();
  }
}

describe('giving up on server failures (review #4)', () => {
  it(`dead-letters after ${MAX_SERVER_FAILURES} consecutive 500s and unblocks the queue`, async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-10-20T10:00:00.000Z'));
    const a = await newEvent();
    const b = await newEvent();
    const { engine, calls } = setup((call) => {
      if (isPut(call) && eventIdOf(call) === a.id) throw httpError(500);
    });

    await syncThroughBackoff(engine, MAX_SERVER_FAILURES);

    const putsOfA = calls.filter((c) => isPut(c) && eventIdOf(c) === a.id);
    expect(putsOfA).toHaveLength(MAX_SERVER_FAILURES);
    const [dead] = await db.outbox.toArray();
    expect(dead).toMatchObject({ entityId: a.id, status: 'dead', failureCount: 8 });
    expect(dead.lastError).toBe(
      `The server kept failing after ${MAX_SERVER_FAILURES} attempts (The server could not ` +
        'complete the request. Try again later.). Retry later or discard the change.',
    );
    expect(calls.some((c) => isPut(c) && eventIdOf(c) === b.id)).toBe(true);
    expect(engine.status.getSnapshot()).toMatchObject({ pendingCount: 0, deadLetterCount: 1 });
  });

  it('does not count offline errors or 502-504 toward giving up', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-10-20T10:00:00.000Z'));
    await newEvent();
    let n = 0;
    const { engine } = setup((call) => {
      if (!isPut(call)) return undefined;
      n++;
      throw n % 2 ? networkError() : httpError(503);
    });

    await syncThroughBackoff(engine, MAX_SERVER_FAILURES * 2);

    const [head] = await db.outbox.toArray();
    expect(head).toMatchObject({ status: 'pending', failureCount: 0 });
  });

  it('keeps counting across a coalesced edit, so repeated edits cannot dodge the limit', async () => {
    const a = await newEvent();
    await db.outbox.toCollection().modify({ attempts: 7, failureCount: MAX_SERVER_FAILURES - 1 });
    await editEvent(db, a.id, { notes: 'again' });
    const { engine } = setup((call) => {
      if (isPut(call)) throw httpError(500);
    });

    await engine.syncNow();

    const rows = await db.outbox.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'dead',
      failureCount: MAX_SERVER_FAILURES,
      payload: { notes: 'again' },
    });
  });
});

describe('restoring the server copy (review #10)', () => {
  it('replaces the local row with the server copy when an edit is dead-lettered', async () => {
    const stored = serverEvent({ id: 'evt-1', notes: 'server', createdBy: 'user-2' });
    await db.events.put(fromEventDto(stored));
    await editEvent(db, 'evt-1', { notes: 'rejected local edit' });
    const { engine, calls } = setup((call) => {
      if (isPut(call)) throw httpError(422, 'event_type_not_available');
      if (call.method === 'GET' && call.path.endsWith('/events/evt-1')) return stored;
    });

    await engine.syncNow();

    expect((await db.outbox.toArray())[0].status).toBe('dead');
    expect(calls.some((c) => c.method === 'GET' && c.path.endsWith('/events/evt-1'))).toBe(true);
    expect((await db.events.get('evt-1'))?.notes).toBe('server');
  });

  it('removes a rejected create the server never stored', async () => {
    const a = await newEvent();
    const { engine } = setup((call) => {
      if (isPut(call)) throw httpError(409, 'event_baby_mismatch');
      if (call.method === 'GET' && call.path.endsWith(`/events/${a.id}`)) {
        throw httpError(404, 'event_not_found');
      }
    });

    await engine.syncNow();

    expect(await db.events.get(a.id)).toBeUndefined();
    expect((await db.outbox.toArray())[0]).toMatchObject({ entityId: a.id, status: 'dead' });
  });

  it('leaves the local row alone when the server copy cannot be loaded', async () => {
    const a = await newEvent();
    const { engine } = setup((call) => {
      if (isPut(call)) throw httpError(422);
      if (call.method === 'GET' && call.path.endsWith(`/events/${a.id}`)) throw networkError();
    });

    await engine.syncNow();

    expect(await db.events.get(a.id)).toBeDefined();
    expect((await db.outbox.toArray())[0].status).toBe('dead');
  });

  it('restores the server copy on Discard, in the same step that drops the mutation', async () => {
    const stored = serverEvent({ id: 'evt-1', notes: 'server', createdBy: 'user-2' });
    await db.events.put(fromEventDto(stored));
    await editEvent(db, 'evt-1', { notes: 'rejected local edit' });
    await db.outbox.toCollection().modify({ status: 'dead' });
    const { engine } = setup((call) => {
      if (call.method === 'GET' && call.path.endsWith('/events/evt-1')) return stored;
    });
    const [dead] = await db.outbox.toArray();

    await engine.discardDeadLetter(dead.id);

    expect(await db.outbox.count()).toBe(0);
    expect((await db.events.get('evt-1'))?.notes).toBe('server');
  });

  it('keeps the dead letter when Discard cannot reach the server', async () => {
    await newEvent();
    await db.outbox.toCollection().modify({ status: 'dead' });
    const { engine } = setup(() => {
      throw networkError();
    });
    const [dead] = await db.outbox.toArray();

    await expect(engine.discardDeadLetter(dead.id)).rejects.toThrow('Failed to fetch');

    expect(await db.outbox.count()).toBe(1);
  });

  it('restores or removes medications from the server list on Discard', async () => {
    const kept = await createMedication(db, { babyId: BABY_ID, name: 'Server name' });
    await updateMedication(db, kept.id, {
      name: 'Rejected rename',
      defaultDosage: null,
      notes: null,
      isUsual: false,
    });
    const gone = await createMedication(db, { babyId: BABY_ID, name: 'Never stored' });
    await db.outbox.toCollection().modify({ status: 'dead' });
    const { engine } = setup((call) =>
      call.path.endsWith('/medications')
        ? [{ ...kept, name: 'Server name', createdAt: kept.createdAt }]
        : undefined,
    );

    for (const m of await db.outbox.orderBy('id').toArray()) await engine.discardDeadLetter(m.id);

    expect((await db.medications.get(kept.id))?.name).toBe('Server name');
    expect(await db.medications.get(gone.id)).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
  });
});
