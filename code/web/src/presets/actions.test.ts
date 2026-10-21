import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { createEvent, editEvent, stopEvent, deleteEvent } from '../db/eventCommands';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import {
  PresetAlreadyRunningError,
  PresetNotRunnableError,
  runPreset,
  sheetPrefill,
  undoPreset,
} from './actions';
import { DIAPER_T, SLEEP, presetById } from './presetFixtures';

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await db.delete();
});

// Local noon-ish moments so the 19:00-05:00 rule is predictable.
const NOON = new Date(2026, 9, 21, 12, 0, 0);
const EVENING = new Date(2026, 9, 21, 20, 30, 0);
const ctx = (now: Date) => ({ babyId: BABY_ID, options: { now: () => now } });

const live = async () => (await db.events.toArray()).filter((e) => e.deletedAt === null);
const outbox = () => db.outbox.toArray();

describe('runPreset: timer', () => {
  it('starts a running timer with the payload defaults and queues one outbox entry', async () => {
    const token = await runPreset(db, presetById('nap'), ctx(NOON));

    const [event] = await live();
    expect(event).toMatchObject({
      typeId: SLEEP,
      babyId: BABY_ID,
      startedAt: NOON.toISOString(),
      endedAt: null,
      payload: { kind: 'nap' },
    });
    expect(token).toEqual({ babyId: BABY_ID, createdIds: [event.id], stopped: [] });
    const entries = await outbox();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: 'upsert', entityId: event.id, status: 'pending' });
  });

  it('copies the defaults (the catalogue is never mutated through events)', async () => {
    const nursing = presetById('nursing');
    await runPreset(db, nursing, ctx(NOON));
    const [event] = await live();
    expect(event.payload).toEqual({ method: 'breast' });
    expect(event.payload).not.toBe(nursing.payloadDefaults);
  });

  it('refuses a second timer of the same preset, but allows a different kind', async () => {
    await runPreset(db, presetById('nap'), ctx(NOON));
    const error = await runPreset(db, presetById('nap'), ctx(NOON)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PresetAlreadyRunningError);
    expect(await live()).toHaveLength(1);
    expect(await outbox()).toHaveLength(1);

    await runPreset(db, presetById('night_waking'), ctx(NOON));
    expect(await live()).toHaveLength(2);
  });

  it('works for custom duration types', async () => {
    const custom = {
      ...presetById('nap'),
      id: 'type:c1',
      builtIn: false,
      typeId: 'c1',
      payloadDefaults: {},
    };
    await runPreset(db, custom, ctx(NOON));
    expect((await live())[0]).toMatchObject({ typeId: 'c1', endedAt: null, payload: {} });
  });
});

describe('runPreset: instant', () => {
  it('logs a zero-length marker (bedtime)', async () => {
    await runPreset(db, presetById('bedtime'), ctx(EVENING));
    const [event] = await live();
    expect(event).toMatchObject({
      payload: { kind: 'bed_time' },
      startedAt: EVENING.toISOString(),
      endedAt: EVENING.toISOString(),
    });
    expect(await outbox()).toHaveLength(1);
  });

  it('wake-up with no running timer only logs the marker', async () => {
    const token = await runPreset(db, presetById('wake_up'), ctx(NOON));
    expect(token.stopped).toEqual([]);
    expect(token.createdIds).toHaveLength(1);
    expect(await outbox()).toHaveLength(1);
  });

  it('wake-up stops a running nap at the same moment: one transaction, two outbox entries', async () => {
    const nap = await createEvent(
      db,
      {
        babyId: BABY_ID,
        typeId: SLEEP,
        startedAt: new Date(2026, 9, 21, 11, 0).toISOString(),
        payload: { kind: 'nap' },
      },
      { now: () => new Date(2026, 9, 21, 11, 0) },
    );
    await db.outbox.clear();

    const token = await runPreset(db, presetById('wake_up'), ctx(NOON));

    const events = await live();
    const stopped = events.find((e) => e.id === nap.id)!;
    const marker = events.find((e) => e.id !== nap.id)!;
    expect(stopped.endedAt).toBe(NOON.toISOString());
    expect(marker).toMatchObject({
      payload: { kind: 'woke_up' },
      startedAt: NOON.toISOString(),
      endedAt: NOON.toISOString(),
    });
    expect(token.stopped).toEqual([{ id: nap.id, endedAt: NOON.toISOString() }]);
    expect(token.createdIds).toEqual([marker.id]);
    expect(await outbox()).toHaveLength(2);
  });

  it('wake-up stops every running nap/night timer (two running) but not night waking or other types', async () => {
    const start = (kind: string | undefined, typeId = SLEEP) =>
      createEvent(
        db,
        {
          babyId: BABY_ID,
          typeId,
          startedAt: new Date(2026, 9, 21, 10, 0).toISOString(),
          payload: kind ? { kind } : {},
        },
        { now: () => new Date(2026, 9, 21, 10, 0) },
      );
    const a = await start('nap');
    const b = await start('night');
    const legacy = await start(undefined);
    const waking = await start('night_waking');
    const feeding = await start(undefined, 'type-feeding-t');

    const token = await runPreset(db, presetById('wake_up'), ctx(NOON));

    expect(token.stopped.map((s) => s.id).sort()).toEqual([a.id, b.id, legacy.id].sort());
    const byId = new Map((await live()).map((e) => [e.id, e]));
    for (const id of [a.id, b.id, legacy.id])
      expect(byId.get(id)?.endedAt).toBe(NOON.toISOString());
    expect(byId.get(waking.id)?.endedAt).toBeNull();
    expect(byId.get(feeding.id)?.endedAt).toBeNull();
  });

  it('rolls everything back when a timer cannot stop (starts in the future)', async () => {
    await createEvent(
      db,
      {
        babyId: BABY_ID,
        typeId: SLEEP,
        startedAt: new Date(2026, 9, 21, 13, 0).toISOString(),
        payload: { kind: 'nap' },
      },
      { now: () => NOON },
    );
    await db.outbox.clear();

    await expect(runPreset(db, presetById('wake_up'), ctx(NOON))).rejects.toThrow();
    expect(await live()).toHaveLength(1);
    expect(await outbox()).toHaveLength(0);
  });
});

describe('runPreset: fell asleep', () => {
  it('logs the marker and starts a nap timer at midday, in one transaction', async () => {
    const token = await runPreset(db, presetById('fell_asleep'), ctx(NOON));

    const events = await live();
    expect(events).toHaveLength(2);
    const marker = events.find((e) => e.payload.kind === 'fell_asleep')!;
    const timer = events.find((e) => e.payload.kind === 'nap')!;
    expect(marker).toMatchObject({ startedAt: NOON.toISOString(), endedAt: NOON.toISOString() });
    expect(timer).toMatchObject({ startedAt: NOON.toISOString(), endedAt: null, typeId: SLEEP });
    expect(token.createdIds).toEqual([marker.id, timer.id]);
    expect(await outbox()).toHaveLength(2);
  });

  it('starts a night timer in the evening', async () => {
    await runPreset(db, presetById('fell_asleep'), ctx(EVENING));
    expect((await live()).some((e) => e.payload.kind === 'night' && e.endedAt === null)).toBe(true);
  });

  it('starts a night timer at midday when a bedtime marker was logged in the last 3 hours', async () => {
    await runPreset(db, presetById('bedtime'), ctx(new Date(2026, 9, 21, 10, 30)));
    await runPreset(db, presetById('fell_asleep'), ctx(NOON));
    expect((await live()).some((e) => e.payload.kind === 'night')).toBe(true);
  });

  it('only logs the marker when a nap/night timer already runs', async () => {
    await runPreset(db, presetById('nap'), ctx(new Date(2026, 9, 21, 11, 0)));
    const token = await runPreset(db, presetById('fell_asleep'), ctx(NOON));
    expect(token.createdIds).toHaveLength(1);
    const timers = (await live()).filter((e) => e.endedAt === null);
    expect(timers).toHaveLength(1);
    expect(timers[0].payload.kind).toBe('nap');
  });
});

describe('runPreset: offline queueing and errors', () => {
  it('queues pending outbox upserts for the created events (nothing is sent)', async () => {
    const token = await runPreset(db, presetById('fell_asleep'), ctx(NOON));
    const entries = await outbox();
    expect(entries.map((e) => e.entityId)).toEqual(token.createdIds);
    expect(entries.every((e) => e.status === 'pending' && e.kind === 'upsert')).toBe(true);
    expect(entries.every((e) => e.babyId === BABY_ID && e.entityType === 'event')).toBe(true);
  });

  it('rejects sheet and link presets', async () => {
    for (const id of ['diaper', 'bottle', 'custom']) {
      await expect(runPreset(db, presetById(id), ctx(NOON))).rejects.toBeInstanceOf(
        PresetNotRunnableError,
      );
    }
    expect(await db.events.count()).toBe(0);
  });
});

describe('undoPreset', () => {
  it('soft-deletes a created marker and queues a delete', async () => {
    const token = await runPreset(db, presetById('bedtime'), ctx(NOON));
    await db.outbox.clear();
    await undoPreset(db, token, { now: () => EVENING });

    expect(await live()).toHaveLength(0);
    const [removed] = await db.events.toArray();
    expect(removed.deletedAt).toBe(EVENING.toISOString());
    expect((await outbox()).map((e) => e.kind)).toEqual(['delete']);
  });

  it('re-opens the timer a wake-up stopped and deletes the marker', async () => {
    const nap = await createEvent(
      db,
      {
        babyId: BABY_ID,
        typeId: SLEEP,
        startedAt: new Date(2026, 9, 21, 11, 0).toISOString(),
        payload: { kind: 'nap' },
      },
      { now: () => new Date(2026, 9, 21, 11, 0) },
    );
    const token = await runPreset(db, presetById('wake_up'), ctx(NOON));

    await undoPreset(db, token);

    expect((await db.events.get(nap.id))?.endedAt).toBeNull();
    expect(await live()).toHaveLength(1);
  });

  it('undoes fell asleep completely (marker and timer)', async () => {
    const token = await runPreset(db, presetById('fell_asleep'), ctx(NOON));
    await undoPreset(db, token);
    expect(await live()).toHaveLength(0);
  });

  it('is safe to repeat and tolerates events that are already gone', async () => {
    const token = await runPreset(db, presetById('bedtime'), ctx(NOON));
    await undoPreset(db, token);
    await undoPreset(db, token);
    await undoPreset(db, {
      babyId: BABY_ID,
      createdIds: ['missing'],
      stopped: [{ id: 'missing', endedAt: 'x' }],
    });
    expect(await live()).toHaveLength(0);
  });

  it('leaves a stopped timer alone when it was edited, deleted or restarted since', async () => {
    const start = async () =>
      createEvent(
        db,
        {
          babyId: BABY_ID,
          typeId: SLEEP,
          startedAt: new Date(2026, 9, 21, 11, 0).toISOString(),
          payload: { kind: 'nap' },
        },
        { now: () => new Date(2026, 9, 21, 11, 0) },
      );
    const edited = await start();
    const token = await runPreset(db, presetById('wake_up'), ctx(NOON));
    await editEvent(db, edited.id, { endedAt: new Date(2026, 9, 21, 11, 40).toISOString() });
    await undoPreset(db, token);
    expect((await db.events.get(edited.id))?.endedAt).toBe(
      new Date(2026, 9, 21, 11, 40).toISOString(),
    );

    const removed = await start();
    await stopEvent(db, removed.id, NOON.toISOString());
    await deleteEvent(db, removed.id);
    await undoPreset(db, {
      babyId: BABY_ID,
      createdIds: [],
      stopped: [{ id: removed.id, endedAt: NOON.toISOString() }],
    });
    expect((await db.events.get(removed.id))?.deletedAt).not.toBeNull();
  });
});

describe('sheetPrefill', () => {
  const NOW = new Date('2026-10-21T15:00:00.000Z');

  it('prefills type, payload defaults and start = now', () => {
    expect(sheetPrefill(presetById('diaper'), NOW)).toEqual({
      typeId: DIAPER_T,
      startedAt: NOW.toISOString(),
      endedAt: null,
      payload: {},
    });
  });

  it('makes a bottle zero-length with method bottle', () => {
    const prefill = sheetPrefill(presetById('bottle'), NOW);
    expect(prefill).toMatchObject({
      endedAt: NOW.toISOString(),
      payload: { method: 'bottle' },
    });
  });

  it('refuses timer, instant and link presets', () => {
    for (const id of ['nap', 'wake_up', 'custom']) {
      expect(() => sheetPrefill(presetById(id), NOW)).toThrow(PresetNotRunnableError);
    }
  });
});

describe('runPreset: payloads and stops that need details (wave 1)', () => {
  it('uses the given payload (defaults plus remembered values) for the new event', async () => {
    await runPreset(db, presetById('nursing'), {
      ...ctx(NOON),
      payload: { method: 'breast', side: 'left' },
    });
    const [event] = await live();
    expect(event.payload).toEqual({ method: 'breast', side: 'left' });
  });

  it('Wake-up leaves a sleep timer running when its stop would miss a required field', async () => {
    await db.eventTypes.put({
      id: SLEEP,
      babyId: null,
      key: 'sleep',
      name: 'Sleep',
      icon: 'bedtime',
      color: '#7e57c2',
      hasDuration: true,
      fields: [
        {
          key: 'kind',
          label: 'Kind',
          kind: 'select',
          isRequired: false,
          options: ['nap', 'night', 'woke_up'],
          min: null,
          max: null,
          unit: null,
          visibleWhen: null,
        },
        {
          key: 'mood',
          label: 'Mood',
          kind: 'text',
          isRequired: true,
          options: [],
          min: null,
          max: null,
          unit: null,
          visibleWhen: null,
        },
      ],
    });
    const nap = await createEvent(db, {
      babyId: BABY_ID,
      typeId: SLEEP,
      startedAt: new Date(NOON.getTime() - 3_600_000).toISOString(),
      payload: { kind: 'nap' },
    });

    const token = await runPreset(db, presetById('wake_up'), ctx(NOON));

    expect(token.stopped).toEqual([]);
    expect(token.needsFinish).toEqual([nap.id]);
    expect((await db.events.get(nap.id))?.endedAt).toBeNull();
  });
});
