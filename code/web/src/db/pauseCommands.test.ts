import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from './database';
import {
  createEvent,
  editEvent,
  finishEvent,
  pauseTimer,
  resumeTimer,
  stopEvent,
} from './eventCommands';
import { EventAlreadyStoppedError } from './errors';
import { BABY_ID, TYPE_ID, testDatabase } from '../test/fakeApi';

const T0 = new Date('2026-10-20T08:00:00.000Z');
const at = (minutes: number) => ({ now: () => new Date(T0.getTime() + minutes * 60_000) });

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await db.delete();
});

async function running(payload = {}) {
  return createEvent(db, { babyId: BABY_ID, typeId: TYPE_ID, payload }, at(0));
}

describe('pauseTimer and resumeTimer', () => {
  it('pause sets paused_at and queues an upsert carrying it', async () => {
    const event = await running({ kind: 'nap' });
    const paused = await pauseTimer(db, event.id, at(10));
    expect(paused.payload).toEqual({ kind: 'nap', paused_at: '2026-10-20T08:10:00.000Z' });
    expect(paused.endedAt).toBeNull();
    const mutations = await db.outbox.toArray();
    expect(mutations).toHaveLength(2);
    expect(mutations[1]).toMatchObject({
      kind: 'upsert',
      status: 'pending',
      payload: {
        endedAt: null,
        payload: { paused_at: '2026-10-20T08:10:00.000Z' },
        updatedAt: '2026-10-20T08:10:00.000Z',
      },
    });
  });

  it('resume adds the pause, counts it and removes paused_at', async () => {
    const event = await running();
    await pauseTimer(db, event.id, at(10));
    const resumed = await resumeTimer(db, event.id, at(15));
    expect(resumed.payload).toEqual({ paused_seconds: 300, pause_count: 1 });
    await pauseTimer(db, event.id, at(20));
    const again = await resumeTimer(db, event.id, at(22));
    expect(again.payload).toEqual({ paused_seconds: 420, pause_count: 2 });
  });

  it('is idempotent: pausing twice or resuming an unpaused timer changes nothing', async () => {
    const event = await running();
    await pauseTimer(db, event.id, at(10));
    const outbox = await db.outbox.count();
    const again = await pauseTimer(db, event.id, at(12));
    expect(again.payload).toEqual({ paused_at: '2026-10-20T08:10:00.000Z' });
    expect(await db.outbox.count()).toBe(outbox);
    await resumeTimer(db, event.id, at(13));
    const count = await db.outbox.count();
    await resumeTimer(db, event.id, at(14));
    expect(await db.outbox.count()).toBe(count);
  });

  it('refuses a stopped timer', async () => {
    const event = await running();
    await stopEvent(db, event.id, undefined, at(30));
    await expect(pauseTimer(db, event.id, at(31))).rejects.toBeInstanceOf(EventAlreadyStoppedError);
  });

  it('stopping while paused finalizes the pause (API rule: no paused_at once ended)', async () => {
    const event = await running({ kind: 'nap' });
    await pauseTimer(db, event.id, at(20));
    const stopped = await stopEvent(db, event.id, undefined, at(30));
    expect(stopped.payload).toEqual({ kind: 'nap', paused_seconds: 600, pause_count: 1 });
    const last = (await db.outbox.toArray()).at(-1)!;
    expect(last.payload).toMatchObject({
      endedAt: '2026-10-20T08:30:00.000Z',
      payload: { paused_seconds: 600, pause_count: 1 },
    });
    expect(JSON.stringify(last.payload)).not.toContain('paused_at');
  });

  it('finishing while paused finalizes it too, at the given end', async () => {
    const event = await running();
    await pauseTimer(db, event.id, at(5));
    const finished = await finishEvent(
      db,
      event.id,
      { paused_at: '2026-10-20T08:05:00.000Z' },
      undefined,
      at(25),
    );
    expect(finished.payload).toEqual({ paused_seconds: 1200, pause_count: 1 });
  });

  it('editing the end of a paused running timer folds the pause in', async () => {
    const event = await running();
    await pauseTimer(db, event.id, at(5));
    const edited = await editEvent(db, event.id, { endedAt: '2026-10-20T08:15:00.000Z' }, at(40));
    expect(edited.payload).toEqual({ paused_seconds: 600, pause_count: 1 });
  });

  it('caps paused_seconds at the length when the end is edited earlier', async () => {
    const event = await running({ paused_seconds: 1500, pause_count: 1 });
    const edited = await editEvent(db, event.id, { endedAt: '2026-10-20T08:10:00.000Z' }, at(40));
    expect(edited.payload).toMatchObject({ paused_seconds: 600 });
  });

  it('works across midnight', async () => {
    const event = await createEvent(
      db,
      { babyId: BABY_ID, typeId: TYPE_ID, startedAt: '2026-10-20T23:30:00.000Z' },
      { now: () => new Date('2026-10-20T23:30:00.000Z') },
    );
    await pauseTimer(db, event.id, { now: () => new Date('2026-10-20T23:50:00.000Z') });
    const stopped = await stopEvent(db, event.id, '2026-10-21T00:10:00.000Z', {
      now: () => new Date('2026-10-21T00:10:00.000Z'),
    });
    expect(stopped.payload).toEqual({ paused_seconds: 1200, pause_count: 1 });
  });
});
