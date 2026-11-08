import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, parseRetryAfter } from '../api/ApiError';
import { createApiClient } from '../api/apiClient';
import type { BabyRoutineDb } from '../db/database';
import { createEvent } from '../db/eventCommands';
import {
  BABY_ID,
  TYPE_ID,
  fakeApi,
  serverEvent,
  testDatabase,
  withHeaders,
  type ApiCall,
  type ApiHandler,
} from '../test/fakeApi';
import { DEFAULT_BACKOFF } from './backoff';
import { classifyFailure, countsTowardGiveUp, isStoreFailure, retryDelay } from './failures';
import { pullAll } from './pull';
import { adoptStoreEpoch, readStoreEpoch } from './storeEpoch';
import { SyncEngine } from './SyncEngine';
import type { SyncContext } from './syncContext';

/*
 * Bring your own database, client side of the sync contract (docs/SPEC.md "Store epoch" and
 * "Store failures"): a 503 `store_*` keeps the outbox and waits `Retry-After`; a changed
 * `X-Sync-Epoch` drops the baby's cursors so everything is pulled again.
 */

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

const storeError = (code = 'store_paused_or_unreachable', retryAfterMs: number | null = 30_000) =>
  new ApiError(503, { code, title: 'Service unavailable' }, undefined, retryAfterMs);

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

describe('Retry-After', () => {
  it('reads delta seconds and HTTP dates, and ignores anything else', () => {
    const now = Date.parse('2026-11-07T10:00:00Z');
    expect(parseRetryAfter('30', now)).toBe(30_000);
    expect(parseRetryAfter('Sat, 07 Nov 2026 10:00:05 GMT', now)).toBe(5_000);
    expect(parseRetryAfter(null, now)).toBeNull();
    expect(parseRetryAfter('soon', now)).toBeNull();
  });

  it('is kept on the ApiError the client throws', async () => {
    const api = createApiClient({
      baseUrl: '',
      getAccessToken: async () => 'token',
      fetchImpl: async () =>
        new Response(JSON.stringify({ code: 'store_timeout' }), {
          status: 503,
          headers: { 'Retry-After': '5', 'Content-Type': 'application/problem+json' },
        }),
    });
    const error = await api.request('/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).retryAfterMs).toBe(5_000);
  });
});

describe('store failures are retriable', () => {
  it.each([
    'store_unavailable',
    'store_timeout',
    'store_paused_or_unreachable',
    'store_credentials_rejected',
    'store_rate_limited',
    'store_quota_full',
    'store_tls_failed',
    'store_schema_ahead',
    'store_schema_conflict',
    'store_role_too_powerful',
    'store_migrating',
    'store_migration_failed',
  ])('%s is transient, never counts toward giving up', (code) => {
    const error = storeError(code);
    expect(isStoreFailure(error)).toBe(true);
    expect(classifyFailure(error)).toBe('transient');
    expect(countsTowardGiveUp(error)).toBe(false);
  });

  it('waits the server Retry-After, capped at the backoff ceiling', () => {
    expect(retryDelay(storeError('store_timeout', 5_000), 750, 60_000)).toBe(5_000);
    expect(retryDelay(storeError('store_timeout', 600_000), 750, 60_000)).toBe(60_000);
    expect(retryDelay(storeError('store_timeout', null), 750, 60_000)).toBe(750);
  });

  it('keeps the outbox entry and retries after Retry-After', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date('2026-11-07T10:00:00.000Z'));
    const event = await createEvent(db, { babyId: BABY_ID, typeId: TYPE_ID });
    let down = true;
    const fake = fakeApi((call) => {
      if (call.method === 'PUT' && down) throw storeError('store_paused_or_unreachable', 30_000);
    });
    const engine = new SyncEngine({
      db,
      api: fake.api,
      locks: null,
      eventTarget: new EventTarget(),
      isOnline: () => true,
      backoff: { baseMs: 1_000, maxMs: 300_000, random: () => 0.5 },
    });
    engines.push(engine);
    const puts = () => fake.calls.filter((c: ApiCall) => c.method === 'PUT').length;

    await engine.syncNow();
    const head = await db.outbox.orderBy('id').first();
    expect(head).toMatchObject({ entityId: event.id, status: 'pending', failureCount: 0 });
    expect(head?.nextAttemptAt).toBe('2026-11-07T10:00:30.000Z');
    expect(head?.lastError).toContain('may be paused');

    await vi.advanceTimersByTimeAsync(29_000);
    await engine.whenIdle();
    expect(puts()).toBe(1);

    down = false;
    await vi.advanceTimersByTimeAsync(1_000);
    await engine.whenIdle();
    expect(puts()).toBe(2);
    expect(await db.outbox.count()).toBe(0);
  });

  it("a baby whose own database is down does not stop the other babies' pulls", async () => {
    const { ctx, calls } = ctxWith((call) => {
      if (call.path === '/api/v1/babies') {
        return [
          { id: 'byo-baby', name: 'Lia', birthDate: '2026-08-01', role: 'Owner' },
          { id: BABY_ID, name: 'Noah', birthDate: '2026-08-01', role: 'Owner' },
        ];
      }
      if (call.path.includes('/byo-baby/')) throw storeError('store_unavailable');
    });

    const errors = await pullAll(ctx);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('cannot be reached');
    expect(calls.some((c) => c.path.startsWith(`/api/v1/babies/${BABY_ID}/events`))).toBe(true);
  });
});

describe('store epoch', () => {
  it('reads only a decimal epoch', () => {
    expect(readStoreEpoch(new Headers({ 'X-Sync-Epoch': '3' }))).toBe('3');
    expect(readStoreEpoch(new Headers({ 'X-Sync-Epoch': 'abc' }))).toBeNull();
    expect(readStoreEpoch(new Headers())).toBeNull();
  });

  it('keeps the cursors while the epoch stays, drops them all when it changes', async () => {
    await db.syncState.bulkPut([
      { babyId: BABY_ID, entity: 'events', lastSyncedAt: '2026-11-01T00:00:00.000Z' },
      { babyId: BABY_ID, entity: 'prescriptions', lastSyncedAt: '2026-11-01T00:00:00.000Z' },
      { babyId: 'other', entity: 'events', lastSyncedAt: '2026-11-01T00:00:00.000Z' },
    ]);

    expect(await adoptStoreEpoch(db, BABY_ID, '0')).toBe(false);
    expect(await db.syncState.get([BABY_ID, 'events'])).toBeDefined();
    expect(await adoptStoreEpoch(db, BABY_ID, '0')).toBe(false);
    expect(await adoptStoreEpoch(db, BABY_ID, null)).toBe(false);

    expect(await adoptStoreEpoch(db, BABY_ID, '1')).toBe(true);
    expect(await db.syncState.get([BABY_ID, 'events'])).toBeUndefined();
    expect(await db.syncState.get([BABY_ID, 'prescriptions'])).toBeUndefined();
    expect(await db.syncState.get([BABY_ID, 'storeEpoch'])).toMatchObject({ lastSyncedAt: '1' });
    expect(await db.syncState.get(['other', 'events'])).toBeDefined();
  });

  it('resets on the first sighting of a moved baby (no stored epoch, not 0)', async () => {
    await db.syncState.put({
      babyId: BABY_ID,
      entity: 'events',
      lastSyncedAt: '2026-11-01T00:00:00.000Z',
    });
    expect(await adoptStoreEpoch(db, BABY_ID, '2')).toBe(true);
    expect(await db.syncState.get([BABY_ID, 'events'])).toBeUndefined();
  });

  it('pulls everything again when the epoch changes, and keeps the outbox', async () => {
    let epoch = '0';
    const { ctx, calls } = ctxWith((call) => {
      if (call.path.endsWith('/event-types')) return withHeaders([], { 'X-Sync-Epoch': epoch });
      if (call.path.includes('/events'))
        return [serverEvent({ updatedAt: '2026-11-05T10:00:00.000Z' })];
    });
    await createEvent(db, { babyId: BABY_ID, typeId: TYPE_ID });
    const eventPulls = () =>
      calls.filter((c) => c.method === 'GET' && c.path.includes(`/babies/${BABY_ID}/events`));

    await pullAll(ctx);
    await pullAll(ctx);
    expect(eventPulls()[1].path).toContain('since=');

    epoch = '1';
    await pullAll(ctx);
    expect(eventPulls()[2].path).not.toContain('since=');
    expect(await db.outbox.count()).toBe(1);

    await pullAll(ctx);
    expect(eventPulls()[3].path).toContain('since=');
  });
});
