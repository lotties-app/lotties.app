import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { createEvent, deleteEvent, editEvent } from '../db/eventCommands';
import {
  BABY_ID,
  TYPE_ID,
  fakeApi,
  httpError,
  serverEvent,
  testDatabase,
  type ApiCall,
  type ApiHandler,
} from '../test/fakeApi';
import { fromEventDto } from './contract';
import { currentRejectionNotice, dismissRejectionNotice } from './rejectionNotice';
import { SyncEngine } from './SyncEngine';

/*
 * A Caregiver's queued changes the server refuses because of the role (docs/SPEC.md "Roles and
 * permissions"): 403 `event_not_owned` drops the change and restores the entry; 403 without a code
 * (the role changed while offline) dead-letters it. Either way the rest of the queue syncs, the
 * caregiver's own entries stay, and one notice is raised.
 */

const ME = 'user-me';
const ANA = 'user-ana';

let db: BabyRoutineDb;
let engines: SyncEngine[];

beforeEach(async () => {
  db = testDatabase();
  engines = [];
  dismissRejectionNotice();
  await db.babies.put({
    id: BABY_ID,
    name: 'Lia',
    birthDate: '2026-08-01',
    role: 'Caregiver',
    userId: ME,
  });
});

afterEach(async () => {
  engines.forEach((e) => e.stop());
  await db.delete();
});

const isPut = (c: ApiCall) => c.method === 'PUT';
const idOf = (c: ApiCall) => decodeURIComponent(c.path.split('/').pop() ?? '');
const babies = [
  { id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role: 'Caregiver', userId: ME },
];

function setup(handler: ApiHandler) {
  const fake = fakeApi((call) => {
    if (call.method === 'GET' && call.path === '/api/v1/babies') return babies;
    return handler(call);
  });
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

/** Ana's running timer, as the server stores it. */
const anasTimer = serverEvent({ id: 'anas-timer', createdBy: ANA, notes: 'from Ana' });

describe('403 event_not_owned', () => {
  it('drops the change, restores the entry and syncs the rest, own entries included', async () => {
    await db.events.put(fromEventDto(anasTimer));
    const before = await createEvent(db, { babyId: BABY_ID, typeId: TYPE_ID });
    await editEvent(db, 'anas-timer', { notes: 'changed by the caregiver', endedAt: null });
    const after = await createEvent(db, { babyId: BABY_ID, typeId: TYPE_ID });
    const { engine, calls } = setup((call) => {
      if (isPut(call) && idOf(call) === 'anas-timer') throw httpError(403, 'event_not_owned');
      if (call.method === 'GET' && idOf(call) === 'anas-timer') return anasTimer;
      return undefined;
    });

    await engine.syncNow();

    expect(await db.outbox.count()).toBe(0);
    expect((await db.events.get('anas-timer'))?.notes).toBe('from Ana');
    expect(await db.events.get(before.id)).toBeDefined();
    expect(await db.events.get(after.id)).toBeDefined();
    expect(calls.filter(isPut).map(idOf)).toEqual([before.id, 'anas-timer', after.id]);
    expect(currentRejectionNotice()).toMatchObject({ kind: 'notOwned' });
    expect(engine.status.getSnapshot()).toMatchObject({ pendingCount: 0, deadLetterCount: 0 });
  });

  it('puts a deleted entry back', async () => {
    await db.events.put(fromEventDto(anasTimer));
    await deleteEvent(db, 'anas-timer');
    const { engine } = setup((call) => {
      if (call.method === 'DELETE') throw httpError(403, 'event_not_owned');
      if (call.method === 'GET' && idOf(call) === 'anas-timer') return anasTimer;
      return undefined;
    });

    await engine.syncNow();

    expect((await db.events.get('anas-timer'))?.deletedAt).toBeNull();
    expect(await db.outbox.count()).toBe(0);
  });

  it('dead-letters the change when the entry cannot be loaded, so nothing stays out of sync', async () => {
    await db.events.put(fromEventDto(anasTimer));
    await editEvent(db, 'anas-timer', { notes: 'changed', endedAt: null });
    const { engine } = setup((call) => {
      if (isPut(call)) throw httpError(403, 'event_not_owned');
      if (call.method === 'GET' && idOf(call) === 'anas-timer') throw httpError(500);
      return undefined;
    });

    await engine.syncNow();

    const [dead] = await db.outbox.toArray();
    expect(dead).toMatchObject({ entityId: 'anas-timer', status: 'dead' });
    expect(dead.lastError).toBe('You can change only the entries you added.');
    expect(currentRejectionNotice()).toMatchObject({ kind: 'notOwned' });
  });
});

describe('403 without a code (the role changed)', () => {
  it('keeps the caregiver’s own unsynced entry on screen as a dead letter', async () => {
    const own = await createEvent(db, { babyId: BABY_ID, typeId: TYPE_ID, notes: 'mine' });
    const later = await createEvent(db, { babyId: BABY_ID, typeId: TYPE_ID });
    const { engine, calls } = setup((call) => {
      if (isPut(call)) throw httpError(403);
      return undefined;
    });

    await engine.syncNow();

    expect((await db.events.get(own.id))?.notes).toBe('mine');
    expect(await db.events.get(later.id)).toBeDefined();
    expect((await db.outbox.toArray()).map((m) => m.status)).toEqual(['dead', 'dead']);
    expect(calls.filter(isPut).map(idOf)).toEqual([own.id, later.id]);
    expect(calls.some((c) => c.method === 'GET' && idOf(c) === own.id)).toBe(false);
    expect(currentRejectionNotice()).toMatchObject({ kind: 'role' });
  });

  it('puts someone else’s entry back to the server copy', async () => {
    await db.events.put(fromEventDto(anasTimer));
    await editEvent(db, 'anas-timer', { notes: 'changed', endedAt: null });
    const { engine } = setup((call) => {
      if (isPut(call)) throw httpError(403);
      if (call.method === 'GET' && idOf(call) === 'anas-timer') return anasTimer;
      return undefined;
    });

    await engine.syncNow();

    expect((await db.events.get('anas-timer'))?.notes).toBe('from Ana');
    expect(await db.outbox.where('status').equals('dead').count()).toBe(1);
  });
});
