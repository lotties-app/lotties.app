import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { createApiClient } from '../api/apiClient';
import { createEvent, deleteEvent, editEvent, stopEvent } from '../db/eventCommands';
import { createMedication } from '../db/medicationCommands';
import {
  BABY_ID,
  SERVER_TIME,
  TYPE_ID,
  echoEvent,
  fakeApi,
  httpError,
  networkError,
  testDatabase,
  type ApiCall,
  type ApiHandler,
} from '../test/fakeApi';
import { SyncEngine, type SyncEngineOptions } from './SyncEngine';

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

function setup(handler?: ApiHandler, options: Partial<SyncEngineOptions> = {}) {
  const fake = fakeApi(handler);
  const engine = new SyncEngine({
    db,
    api: fake.api,
    locks: null,
    eventTarget: new EventTarget(),
    isOnline: () => true,
    backoff: { baseMs: 1_000, maxMs: 60_000, random: () => 0.5 },
    ...options,
  });
  engines.push(engine);
  return { engine, ...fake };
}

const isPut = (c: ApiCall) => c.method === 'PUT';
const eventIdOf = (c: ApiCall) => c.path.split('/').pop();

function newEvent() {
  return createEvent(db, { babyId: BABY_ID, typeId: TYPE_ID });
}

describe('SyncEngine push', () => {
  it('pushes the outbox in queue order, then pulls', async () => {
    const a = await newEvent();
    await stopEvent(db, a.id);
    const b = await newEvent();
    await deleteEvent(db, b.id);
    const { engine, calls, writes } = setup();

    await engine.syncNow();

    expect(writes().map((c) => `${c.method} ${eventIdOf(c)}`)).toEqual([
      `PUT ${a.id}`,
      `PUT ${a.id}`,
      `PUT ${b.id}`,
      `DELETE ${b.id}`,
    ]);
    expect(calls.findIndex((c) => c.method === 'GET')).toBe(4);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.events.get(a.id)).toMatchObject({
      createdBy: 'user-1',
      updatedAt: SERVER_TIME,
    });
    expect((await db.events.get(b.id))?.deletedAt).not.toBeNull();
    expect(engine.status.getSnapshot()).toMatchObject({ state: 'idle', pendingCount: 0 });
  });

  it('pushes medication catalog entries to the medications endpoint', async () => {
    const med = await createMedication(db, { babyId: BABY_ID, name: 'Gripe water' });
    const { engine, writes } = setup((call) => (call.method === 'PUT' ? {} : undefined));

    await engine.syncNow();

    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual([
      `PUT /api/v1/babies/${BABY_ID}/medications/${med.id}`,
    ]);
    expect(writes()[0].body).toEqual({
      name: 'Gripe water',
      defaultDosage: null,
      notes: null,
      isUsual: false,
    });
    expect(await db.outbox.count()).toBe(0);
  });

  it('retries transient failures with exponential backoff and keeps order', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-10-20T10:00:00.000Z'));
    const a = await newEvent();
    const b = await newEvent();
    let failures = 2;
    const { engine, calls } = setup((call) => {
      if (isPut(call) && eventIdOf(call) === a.id && failures-- > 0) throw httpError(503);
    });
    const puts = () => calls.filter(isPut).map(eventIdOf);

    await engine.syncNow();
    expect(puts()).toEqual([a.id]);
    const head = await db.outbox.orderBy('id').first();
    expect(head).toMatchObject({
      attempts: 1,
      status: 'pending',
      lastError: 'HTTP 503: Request failed with status 503',
    });
    // attempt 1: ceiling 1000ms, equal jitter with random 0.5 -> 750ms
    expect(head?.nextAttemptAt).toBe('2026-10-20T10:00:00.750Z');
    expect(engine.status.getSnapshot()).toMatchObject({ state: 'error', pendingCount: 2 });

    await vi.advanceTimersByTimeAsync(749);
    await engine.whenIdle();
    expect(puts()).toEqual([a.id]);

    await vi.advanceTimersByTimeAsync(1);
    await engine.whenIdle();
    expect(puts()).toEqual([a.id, a.id]);
    // attempt 2: ceiling 2000ms -> 1500ms
    expect((await db.outbox.orderBy('id').first())?.attempts).toBe(2);

    await vi.advanceTimersByTimeAsync(1_500);
    await engine.whenIdle();
    expect(puts()).toEqual([a.id, a.id, a.id, b.id]);
    expect(await db.outbox.count()).toBe(0);
    expect(engine.status.getSnapshot()).toMatchObject({ state: 'idle', lastError: null });
  });

  it.each([400, 403, 404, 409, 422])(
    'dead-letters a %i without blocking the queue',
    async (status) => {
      const a = await newEvent();
      const b = await newEvent();
      const { engine, calls } = setup((call) => {
        if (isPut(call) && eventIdOf(call) === a.id) throw httpError(status);
      });

      await engine.syncNow();

      expect(calls.filter(isPut).map(eventIdOf)).toEqual([a.id, b.id]);
      const [dead] = await db.outbox.toArray();
      expect(dead).toMatchObject({ entityId: a.id, status: 'dead', attempts: 1 });
      expect(dead.lastError).toContain(String(status));
      expect(engine.status.getSnapshot()).toMatchObject({ pendingCount: 0, deadLetterCount: 1 });
    },
  );

  it.each([
    [409, 'event_baby_mismatch', 'belongs to another baby'],
    [422, 'event_type_not_available', 'event type is not available'],
  ])('dead-letters a %i %s with a readable message', async (status, code, text) => {
    await newEvent();
    const { engine } = setup((call) => {
      if (isPut(call)) throw httpError(status, code);
    });

    await engine.syncNow();

    const [dead] = await db.outbox.toArray();
    expect(dead.status).toBe('dead');
    expect(dead.lastError).toContain(text);
    expect(dead.lastError).toContain(`HTTP ${status} ${code}`);
  });

  it('sends the local edit time as updatedAt on PUT', async () => {
    const a = await newEvent();
    const { engine, writes } = setup();

    await engine.syncNow();

    expect(writes()[0].body).toMatchObject({ typeId: TYPE_ID, updatedAt: a.updatedAt });
  });

  it('adds updatedAt to upserts queued without it', async () => {
    const a = await newEvent();
    await db.outbox.toCollection().modify((m) => {
      delete (m.payload as { updatedAt?: string }).updatedAt;
    });
    const { engine, writes } = setup();

    await engine.syncNow();

    expect(writes()[0].body).toMatchObject({ updatedAt: a.createdAt });
  });

  it('replaces the local row with the stored copy the server returns', async () => {
    const a = await newEvent();
    const stored = '2026-10-20T13:00:00.000Z';
    const { engine } = setup((call) =>
      isPut(call) ? { ...echoEvent(call, stored), notes: 'edited by the other parent' } : undefined,
    );

    await engine.syncNow();

    expect(await db.events.get(a.id)).toMatchObject({
      notes: 'edited by the other parent',
      updatedAt: stored,
    });
  });

  it('keeps the local row while a newer local edit is still queued', async () => {
    const a = await newEvent();
    await editEvent(db, a.id, { notes: 'newer local' });
    let first = true;
    const { engine } = setup((call) => {
      if (!isPut(call)) return undefined;
      if (first) {
        first = false;
        return { ...echoEvent(call), notes: 'server' };
      }
      throw httpError(503);
    });

    await engine.syncNow();

    expect((await db.events.get(a.id))?.notes).toBe('newer local');
  });

  it('never triggers the login redirect on 401 and pauses with authRequired', async () => {
    await newEvent();
    const onUnauthorized = vi.fn();
    const api = createApiClient({
      baseUrl: 'http://api',
      getAccessToken: async () => 'expired',
      onUnauthorized,
      fetchImpl: async () => new Response('{}', { status: 401 }),
    });
    const engine = new SyncEngine({
      db,
      api,
      locks: null,
      eventTarget: null,
      isOnline: () => true,
    });
    engines.push(engine);

    await engine.syncNow();

    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(engine.isPaused).toBe(true);
    expect(engine.status.getSnapshot()).toMatchObject({ authRequired: true, state: 'error' });
  });

  it('opts every sync request out of the 401 handler', async () => {
    await newEvent();
    const { engine, calls } = setup();

    await engine.syncNow();

    expect(calls.length).toBeGreaterThan(1);
    expect(calls.every((c) => c.skipUnauthorizedHandler)).toBe(true);
  });

  it('treats a 404 on DELETE as already deleted', async () => {
    const a = await newEvent();
    await deleteEvent(db, a.id);
    const { engine } = setup((call) => {
      if (call.method === 'DELETE') throw httpError(404);
    });

    await engine.syncNow();

    expect(await db.outbox.count()).toBe(0);
  });

  it('pauses on 401 until re-authentication', async () => {
    const a = await newEvent();
    let token = 'token-1';
    let authorized = false;
    const { engine, calls } = setup(
      () => {
        if (!authorized) throw httpError(401);
      },
      { getAccessToken: async () => token },
    );

    await engine.syncNow();
    expect(engine.isPaused).toBe(true);
    expect(engine.status.getSnapshot()).toMatchObject({ state: 'error', authRequired: true });
    expect(await db.outbox.get(1)).toMatchObject({ attempts: 0, status: 'pending' });

    await engine.syncNow();
    expect(calls).toHaveLength(1);

    authorized = true;
    token = 'token-2';
    await engine.resumeAfterAuth();
    expect(engine.isPaused).toBe(false);
    expect(calls.filter(isPut).map(eventIdOf)).toEqual([a.id, a.id]);
    expect(engine.status.getSnapshot()).toMatchObject({ state: 'idle', authRequired: false });
  });

  it('resumes from a 401 pause when the interval sees a new token', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    await newEvent();
    let token = 'token-1';
    let authorized = false;
    const { engine, calls } = setup(
      () => {
        if (!authorized) throw httpError(401);
      },
      { getAccessToken: async () => token, intervalMs: 1_000 },
    );

    engine.start();
    await engine.whenIdle();
    expect(engine.isPaused).toBe(true);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(engine.isPaused).toBe(true);

    authorized = true;
    token = 'token-2';
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitUntil(() => !engine.isPaused);
    await engine.whenIdle();
    expect(calls.filter(isPut)).toHaveLength(2);
    expect(await db.outbox.count()).toBe(0);
  });

  it('stops on a network error and resumes when the browser comes back online', async () => {
    await newEvent();
    await newEvent();
    let offline = true;
    const target = new EventTarget();
    const { engine, calls } = setup(
      () => {
        if (offline) throw networkError();
      },
      { eventTarget: target },
    );

    engine.start();
    await engine.whenIdle();
    expect(calls).toHaveLength(1);
    expect(engine.status.getSnapshot()).toMatchObject({ state: 'offline', pendingCount: 2 });
    expect((await db.outbox.orderBy('id').first())?.lastError).toBe('Failed to fetch');

    offline = false;
    target.dispatchEvent(new Event('online'));
    await engine.whenIdle();
    expect(calls.filter(isPut)).toHaveLength(3);
    expect(await db.outbox.count()).toBe(0);
    expect(engine.status.getSnapshot().state).toBe('idle');
  });

  it('does not call the API while the browser reports offline', async () => {
    await newEvent();
    const { engine, calls } = setup(undefined, { isOnline: () => false });

    await engine.syncNow();

    expect(calls).toHaveLength(0);
    expect(engine.status.getSnapshot()).toMatchObject({ state: 'offline', pendingCount: 1 });
  });
});

describe('SyncEngine single-flight', () => {
  it('joins concurrent calls and runs one follow-up without overlapping requests', async () => {
    const a = await newEvent();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let active = 0;
    let maxActive = 0;
    const { engine, calls } = setup(async (call) => {
      active++;
      maxActive = Math.max(maxActive, active);
      if (isPut(call) && eventIdOf(call) === a.id) await gate;
      active--;
      return undefined;
    });

    const first = engine.syncNow();
    const second = engine.syncNow();
    expect(second).toBe(first);

    await vi.waitUntil(() => calls.length === 1);
    const b = await newEvent();
    engine.syncNow();
    release();
    await first;

    expect(calls.filter(isPut).map(eventIdOf)).toEqual([a.id, b.id]);
    expect(maxActive).toBe(1);
    expect(await db.outbox.count()).toBe(0);
  });

  it('skips the run while another tab holds the sync lock', async () => {
    await newEvent();
    let held = true;
    const locks = {
      request: vi.fn(
        async (_name: string, _options: unknown, callback: (lock: Lock | null) => unknown) =>
          callback(held ? null : ({ name: 'baby-routine-sync', mode: 'exclusive' } as Lock)),
      ),
    } as unknown as LockManager;
    const { engine, calls } = setup(undefined, { locks });

    await engine.syncNow();
    expect(calls).toHaveLength(0);
    expect(locks.request).toHaveBeenCalledWith(
      'baby-routine-sync',
      { ifAvailable: true },
      expect.any(Function),
    );

    held = false;
    await engine.syncNow();
    expect(calls.filter(isPut)).toHaveLength(1);
  });
});
