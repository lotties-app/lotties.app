import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import {
  createEvent,
  editEvent,
  finishEvent,
  pauseTimer,
  resumeTimer,
  stopEvent,
} from '../db/eventCommands';
import type { BabyEvent, BabyRole } from '../db/models';
import { dayBounds, eventsOfDay } from '../day/dayModel';
import { ribbonModel } from '../day/ribbonModel';
import { runPreset, undoPreset } from '../presets/actions';
import { BUILT_IN_TYPES, SLEEP, presetById } from '../presets/presetFixtures';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import {
  autoWakeUpId,
  deleteEventWithWakeUp,
  editFollowingWakeUp,
  restoreDeletedEvent,
  logWakeUpForStoppedNight,
  stopLoggingWakeUp,
} from './nightEndsWakeUp';
import { deriveNowState } from './nowState';
import { runSleepAction } from './sleepToggle';

const TYPES = BUILT_IN_TYPES;

let db: BabyRoutineDb;
beforeEach(async () => {
  db = testDatabase();
  await db.eventTypes.bulkPut(TYPES);
  await db.babies.put({ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role: 'Owner' });
});
afterEach(async () => {
  await db.delete();
});

const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m);
const opts = (now: Date) => ({ now: () => now });
const load = async (id: string) => (await db.events.get(id))!;
const asRole = (role: BabyRole, userId = 'u-me') =>
  db.babies.put({ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role, userId });

async function startSleep(kind: string, start: Date, createdBy?: string): Promise<BabyEvent> {
  const created = await createEvent(
    db,
    { babyId: BABY_ID, typeId: SLEEP, startedAt: start.toISOString(), payload: { kind } },
    opts(start),
  );
  if (createdBy) await db.events.put({ ...created, createdBy });
  return load(created.id);
}

const wakeUps = async () =>
  (await db.events.toArray()).filter(
    (e) => e.deletedAt === null && e.typeId === SLEEP && e.payload.kind === 'woke_up',
  );

const stop = (event: BabyEvent, end: Date) =>
  stopLoggingWakeUp(db, () => stopEvent(db, event.id, end.toISOString(), opts(end)), opts(end));

describe('stopping a night logs the wake-up', () => {
  it('creates exactly one wake-up at the end time, under the derived id, queued for sync', async () => {
    const night = await startSleep('night', at(20, 20));

    const result = await stop(night, at(21, 6, 40));

    expect(result.stopped.endedAt).toBe(at(21, 6, 40).toISOString());
    expect(result.wakeUpId).toBe(autoWakeUpId(night.id, 0));
    const markers = await wakeUps();
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      id: autoWakeUpId(night.id, 0),
      typeId: SLEEP,
      startedAt: at(21, 6, 40).toISOString(),
      endedAt: at(21, 6, 40).toISOString(),
      payload: { kind: 'woke_up' },
      createdBy: null,
    });
    // Offline: both writes are local, each with its outbox upsert.
    const outbox = await db.outbox.toArray();
    expect(outbox.map((m) => [m.entityId, m.kind])).toEqual(
      expect.arrayContaining([
        [night.id, 'upsert'],
        [markers[0].id, 'upsert'],
      ]),
    );
  });

  it('a strip stop (finish with the payload) logs it too', async () => {
    const night = await startSleep('night', at(20, 20));
    const end = at(21, 6).toISOString();
    const result = await stopLoggingWakeUp(db, () =>
      finishEvent(db, night.id, { kind: 'night' }, end, opts(at(21, 6))),
    );
    expect(result.wakeUpId).not.toBeNull();
    expect(await wakeUps()).toHaveLength(1);
  });

  it('a nap stop logs none', async () => {
    const nap = await startSleep('nap', at(21, 13));
    const result = await stop(nap, at(21, 14));
    expect(result.wakeUpId).toBeNull();
    expect(await wakeUps()).toEqual([]);
  });

  it('pause and resume log none; the stop afterwards does', async () => {
    const night = await startSleep('night', at(20, 20));
    await pauseTimer(db, night.id, opts(at(21, 1)));
    await resumeTimer(db, night.id, opts(at(21, 1, 10)));
    expect(await wakeUps()).toEqual([]);
    await stop(await load(night.id), at(21, 6));
    expect(await wakeUps()).toHaveLength(1);
  });

  it('is idempotent: running the rule again on the stopped night logs nothing more', async () => {
    const night = await startSleep('night', at(20, 20));
    const { stopped } = await stop(night, at(21, 6));
    const outboxBefore = await db.outbox.count();

    expect(await logWakeUpForStoppedNight(db, stopped, opts(at(21, 6, 1)))).toBeNull();
    expect(await logWakeUpForStoppedNight(db, stopped, opts(at(21, 6, 2)))).toBeNull();

    expect(await wakeUps()).toHaveLength(1);
    expect(await db.outbox.count()).toBe(outboxBefore);
  });

  it('a wake-up already logged for the night (e.g. by an assistant, synced) is not doubled', async () => {
    const night = await startSleep('night', at(20, 20));
    await createEvent(db, {
      babyId: BABY_ID,
      typeId: SLEEP,
      startedAt: at(21, 6).toISOString(),
      endedAt: at(21, 6).toISOString(),
      payload: { kind: 'woke_up' },
    });
    const result = await stop(night, at(21, 6, 5));
    expect(result.wakeUpId).toBeNull();
    expect(await wakeUps()).toHaveLength(1);
  });

  it('a night waking inside the night is not a wake-up and does not block it', async () => {
    const night = await startSleep('night', at(20, 20));
    const waking = await startSleep('night_waking', at(21, 2));
    await stopEvent(db, waking.id, at(21, 2, 20).toISOString());
    expect(await wakeUps()).toEqual([]);
    await stop(night, at(21, 6));
    expect(await wakeUps()).toHaveLength(1);
  });

  it('undo removes both; a later stop logs a new one under the next derived id', async () => {
    const night = await startSleep('night', at(20, 20));
    const result = await stop(night, at(21, 6));
    await undoPreset(db, {
      babyId: BABY_ID,
      createdIds: [result.wakeUpId!],
      stopped: [{ id: night.id, endedAt: result.stopped.endedAt! }],
    });
    expect((await load(night.id)).endedAt).toBeNull();
    expect(await wakeUps()).toEqual([]);
    expect((await load(autoWakeUpId(night.id, 0))).deletedAt).not.toBeNull();

    const again = await stop(await load(night.id), at(21, 6, 30));
    expect(again.wakeUpId).toBe(autoWakeUpId(night.id, 1));
    expect(await wakeUps()).toHaveLength(1);
  });

  it('a Caregiver stopping someone else night logs the wake-up as herself', async () => {
    await asRole('Caregiver');
    const night = await startSleep('night', at(20, 20), 'u-other');
    const result = await stop(night, at(21, 6));
    expect(result.wakeUpId).not.toBeNull();
    expect((await load(result.wakeUpId!)).createdBy).toBeNull();
  });
});

describe('the Woke up / Up for the day buttons', () => {
  it('log one wake-up (the night derived id) and the rule adds no second one', async () => {
    const night = await startSleep('night', at(20, 20));
    const token = await runSleepAction(db, 'up_for_the_day', {
      babyId: BABY_ID,
      types: TYPES,
      options: opts(at(21, 6, 30)),
    });
    expect(token.createdIds).toEqual([autoWakeUpId(night.id, 0)]);
    expect(await logWakeUpForStoppedNight(db, await load(night.id))).toBeNull();
    expect(await wakeUps()).toHaveLength(1);

    await undoPreset(db, token);
    expect(await wakeUps()).toEqual([]);
    expect((await load(night.id)).endedAt).toBeNull();
  });

  it('the Wake-up preset stopping a nap keeps a random marker id', async () => {
    const nap = await startSleep('nap', at(21, 13));
    const token = await runPreset(db, presetById('wake_up', TYPES), {
      babyId: BABY_ID,
      options: opts(at(21, 14)),
    });
    expect(token.createdIds).toHaveLength(1);
    expect(token.createdIds[0]).not.toBe(autoWakeUpId(nap.id, 0));
  });
});

describe('editing a sleep in the event sheet', () => {
  const edit = (before: BabyEvent, changes: Parameters<typeof editEvent>[2], now: Date) =>
    editFollowingWakeUp(db, before, () => editEvent(db, before.id, changes, opts(now)), opts(now));

  it('ending a running night by setting its end time logs the wake-up', async () => {
    const night = await startSleep('night', at(20, 20));
    await edit(night, { endedAt: at(21, 6, 15).toISOString() }, at(21, 7));
    const markers = await wakeUps();
    expect(markers).toHaveLength(1);
    expect(markers[0].startedAt).toBe(at(21, 6, 15).toISOString());
  });

  it('moving the end of a finished night moves its automatic wake-up', async () => {
    const night = await startSleep('night', at(20, 20));
    const { stopped } = await stop(night, at(21, 6));
    await edit(stopped, { endedAt: at(21, 5, 30).toISOString() }, at(21, 9));
    const markers = await wakeUps();
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      id: autoWakeUpId(night.id, 0),
      startedAt: at(21, 5, 30).toISOString(),
      endedAt: at(21, 5, 30).toISOString(),
    });
  });

  it('leaves a hand-logged wake-up alone and creates none for a past night', async () => {
    const night = await startSleep('night', at(20, 20));
    const ended = await stopEvent(db, night.id, at(21, 6).toISOString());
    const manual = await createEvent(db, {
      babyId: BABY_ID,
      typeId: SLEEP,
      startedAt: at(21, 6).toISOString(),
      endedAt: at(21, 6).toISOString(),
      payload: { kind: 'woke_up' },
    });
    await edit(ended, { endedAt: at(21, 5).toISOString() }, at(21, 9));
    expect((await wakeUps()).map((e) => [e.id, e.startedAt])).toEqual([
      [manual.id, at(21, 6).toISOString()],
    ]);

    const old = await startSleep('night', at(18, 20));
    const oldEnded = await stopEvent(db, old.id, at(19, 6).toISOString());
    await edit(oldEnded, { endedAt: at(19, 6, 30).toISOString() }, at(21, 9));
    expect(await wakeUps()).toHaveLength(1);
  });

  it('turning the night into a nap removes its automatic wake-up', async () => {
    const night = await startSleep('night', at(20, 20));
    const { stopped } = await stop(night, at(21, 6));
    await edit(stopped, { payload: { kind: 'nap' } }, at(21, 9));
    expect(await wakeUps()).toEqual([]);
  });

  it('a Caregiver never moves a wake-up someone else logged', async () => {
    const night = await startSleep('night', at(20, 20));
    const { stopped, wakeUpId } = await stop(night, at(21, 6));
    await db.events.put({ ...(await load(wakeUpId!)), createdBy: 'u-other' });
    await asRole('Caregiver');
    await edit(stopped, { endedAt: at(21, 5).toISOString() }, at(21, 9));
    expect((await load(wakeUpId!)).startedAt).toBe(at(21, 6).toISOString());
  });
});

describe('deleting a night', () => {
  it('soft-deletes its automatic wake-up in the same transaction, both queued for sync', async () => {
    const night = await startSleep('night', at(20, 20));
    const { wakeUpId } = await stop(night, at(21, 6));

    const removed = await deleteEventWithWakeUp(db, night.id, opts(at(21, 9)));

    expect(removed.deleted.id).toBe(night.id);
    expect(removed.wakeUp?.id).toBe(wakeUpId);
    expect((await load(night.id)).deletedAt).not.toBeNull();
    expect((await load(wakeUpId!)).deletedAt).not.toBeNull();
    const deletes = (await db.outbox.toArray()).filter((m) => m.kind === 'delete');
    expect(deletes.map((m) => m.entityId).sort()).toEqual([night.id, wakeUpId].sort());
  });

  it('never touches a hand-logged wake-up', async () => {
    const night = await startSleep('night', at(20, 20));
    await stopEvent(db, night.id, at(21, 6).toISOString());
    const manual = await createEvent(db, {
      babyId: BABY_ID,
      typeId: SLEEP,
      startedAt: at(21, 6).toISOString(),
      endedAt: at(21, 6).toISOString(),
      payload: { kind: 'woke_up' },
    });
    const removed = await deleteEventWithWakeUp(db, night.id);
    expect(removed.wakeUp).toBeNull();
    expect((await load(manual.id)).deletedAt).toBeNull();
  });

  it('a nap or another event deletes alone', async () => {
    const nap = await startSleep('nap', at(21, 13));
    await stop(nap, at(21, 14));
    const removed = await deleteEventWithWakeUp(db, nap.id);
    expect(removed.wakeUp).toBeNull();
  });

  it('is idempotent: deleting again changes nothing more', async () => {
    const night = await startSleep('night', at(20, 20));
    await stop(night, at(21, 6));
    await deleteEventWithWakeUp(db, night.id, opts(at(21, 9)));
    const outbox = await db.outbox.count();
    const again = await deleteEventWithWakeUp(db, night.id, opts(at(21, 10)));
    expect(again.wakeUp).toBeNull();
    expect(await db.outbox.count()).toBe(outbox);
  });

  it('a Caregiver never deletes a wake-up someone else logged', async () => {
    const night = await startSleep('night', at(20, 20));
    const { wakeUpId } = await stop(night, at(21, 6));
    await db.events.put({ ...(await load(wakeUpId!)), createdBy: 'u-other' });
    await asRole('Caregiver');
    const removed = await deleteEventWithWakeUp(db, night.id);
    expect(removed.wakeUp).toBeNull();
    expect((await load(wakeUpId!)).deletedAt).toBeNull();
  });

  it('Undo of the delete restores both: the night under a new id, the wake-up under its automatic id', async () => {
    const night = await startSleep('night', at(20, 20));
    await stop(night, at(21, 6));
    const { deleted, wakeUp } = await deleteEventWithWakeUp(db, night.id);

    const restored = await restoreDeletedEvent(db, deleted, wakeUp);

    expect(restored.id).not.toBe(night.id);
    expect(restored).toMatchObject({
      startedAt: night.startedAt,
      endedAt: at(21, 6).toISOString(),
      payload: { kind: 'night' },
    });
    const markers = await wakeUps();
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({
      id: autoWakeUpId(restored.id, 0),
      startedAt: at(21, 6).toISOString(),
    });
    // Still automatic: deleting the restored night takes it again.
    expect((await deleteEventWithWakeUp(db, restored.id)).wakeUp?.id).toBe(markers[0].id);
  });

  it('undo of a created night (preset token) removes its automatic wake-up too', async () => {
    const token = await runPreset(db, presetById('fell_asleep', TYPES), {
      babyId: BABY_ID,
      options: opts(at(20, 21)),
    });
    const night = (await db.events.toArray()).find((e) => e.endedAt === null)!;
    await db.events.put({ ...night, payload: { kind: 'night' } });
    const { wakeUpId } = await stop(await load(night.id), at(21, 6));
    await undoPreset(db, token);
    expect((await load(wakeUpId!)).deletedAt).not.toBeNull();
  });
});

describe('what reads the wake-up', () => {
  it('Now shows her awake since the end; the day ribbon marks the wake-up', async () => {
    const night = await startSleep('night', at(20, 20));
    await stop(night, at(21, 6, 40));
    const events = await db.events.toArray();

    const state = deriveNowState(events, TYPES, undefined, at(21, 8));
    expect(state).toMatchObject({ kind: 'awake', since: at(21, 6, 40).toISOString() });

    const bounds = dayBounds(at(21, 0));
    const ribbon = ribbonModel(eventsOfDay(events, bounds), TYPES, bounds, at(21, 8));
    expect(ribbon.marks).toEqual([
      expect.objectContaining({ lane: 'sleep', at: (6 * 60 + 40) / 1440 }),
    ]);
  });
});
