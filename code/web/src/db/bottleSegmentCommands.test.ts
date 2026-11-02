import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { canControlTimer, isRunningControlChange } from '../baby/permissions';
import {
  askBottleLevel,
  dismissBottleLevel,
  useBottleLevelPrompt,
} from '../events/bottleLevelPrompt';
import { runPreset } from '../presets/actions';
import { BUILT_IN_TYPES, presetById } from '../presets/presetFixtures';
import { FEEDING_TYPE } from '../test/builtInTypes';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import type { BabyRoutineDb } from './database';
import {
  createEvent,
  editEvent,
  finishEvent,
  pauseTimer,
  recordBottleLevel,
  resumeTimer,
  stopEvent,
} from './eventCommands';
import { renderHook } from '@testing-library/react';

const TYPES = [...BUILT_IN_TYPES.filter((type) => type.key !== 'feeding'), FEEDING_TYPE];
const T0 = new Date('2026-10-20T08:00:00.000Z');
const at = (minutes: number) => ({ now: () => new Date(T0.getTime() + minutes * 60_000) });
const iso = (minutes: number) => new Date(T0.getTime() + minutes * 60_000).toISOString();

let db: BabyRoutineDb;
beforeEach(async () => {
  db = testDatabase();
  await db.eventTypes.bulkPut(TYPES);
  await db.babies.put({ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role: 'Owner' });
});
afterEach(async () => {
  dismissBottleLevel();
  await db.delete();
});

const bottle = (payload: Record<string, unknown> = { method: 'bottle', amount_ml: 120 }) =>
  createEvent(
    db,
    { babyId: BABY_ID, typeId: FEEDING_TYPE.id, startedAt: T0.toISOString(), payload },
    at(0),
  );
const load = async (id: string) => (await db.events.get(id))!;

describe('a bottle records its drinking stretches', () => {
  it('a pause closes the stretch (level unknown) and the answer fills it', async () => {
    const event = await bottle();
    const paused = await pauseTimer(db, event.id, at(5));
    expect(paused.payload).toMatchObject({ segments: '120>?@300+0', paused_at: iso(5) });
    const answered = await recordBottleLevel(db, event.id, 70, 1, at(5));
    expect(answered.payload.segments).toBe('120>70@300+0');
    const outbox = await db.outbox.toArray();
    expect(outbox[outbox.length - 1].payload).toMatchObject({
      payload: { segments: '120>70@300+0' },
    });
  });

  it('the next stretch starts where the last one ended; the stop closes it from the totals', async () => {
    const event = await bottle();
    await pauseTimer(db, event.id, at(5));
    await recordBottleLevel(db, event.id, 70, 1, at(5));
    await resumeTimer(db, event.id, at(7));
    await pauseTimer(db, event.id, at(10));
    await recordBottleLevel(db, event.id, 30, 2, at(10));
    await resumeTimer(db, event.id, at(11));
    const stopped = await finishEvent(
      db,
      event.id,
      { ...(await load(event.id)).payload, amount_drunk_ml: 110 },
      iso(13),
      at(13),
    );
    // 3 min paused: 10 min of drinking, 5 + 3 + 2.
    expect(stopped.payload).toMatchObject({
      segments: '120>70@300+0;70>30@180+420;30>10@120+660',
      amount_drunk_ml: 110,
      paused_seconds: 180,
      pause_count: 2,
    });
  });

  it('a plain stop of a bottle with stretches ends it empty (no drunk amount = all)', async () => {
    const event = await bottle();
    await pauseTimer(db, event.id, at(4));
    await resumeTimer(db, event.id, at(5));
    const stopped = await stopEvent(db, event.id, undefined, at(9));
    expect(stopped.payload.segments).toBe('120>?@240+0;?>0@240+300');
  });

  it('nursing and bottles never paused get no stretches', async () => {
    const nursing = await bottle({ method: 'breast' });
    expect((await pauseTimer(db, nursing.id, at(3))).payload).not.toHaveProperty('segments');
    const plain = await bottle();
    expect((await stopEvent(db, plain.id, undefined, at(8))).payload).not.toHaveProperty(
      'segments',
    );
  });

  it('an edit that lowers the drunk total moves the last level with it', async () => {
    const event = await bottle();
    await pauseTimer(db, event.id, at(5));
    await resumeTimer(db, event.id, at(6));
    await stopEvent(db, event.id, undefined, at(10));
    const edited = await editEvent(
      db,
      event.id,
      { payload: { ...(await load(event.id)).payload, amount_drunk_ml: 80 } },
      at(20),
    );
    expect(edited.payload.segments).toBe('120>?@300+0;?>40@240+360');
  });

  it('a sleep that stops the bottle leaves its end unknown; the follow-up fills it and the total', async () => {
    const event = await bottle();
    await pauseTimer(db, event.id, at(5));
    await recordBottleLevel(db, event.id, 60, 1, at(5));
    await resumeTimer(db, event.id, at(6));
    await runPreset(db, presetById('nap', TYPES), {
      babyId: BABY_ID,
      options: at(12),
    });
    const stopped = await load(event.id);
    expect(stopped.payload).toMatchObject({ ended_by: 'sleep', segments: '120>60@300+0;60>?@360+360' });
    expect(stopped.payload).not.toHaveProperty('amount_drunk_ml');
    const answered = await recordBottleLevel(db, event.id, 20, 2, at(30));
    expect(answered.payload).toMatchObject({
      segments: '120>60@300+0;60>20@360+360',
      amount_drunk_ml: 100,
    });
  });

  it('the follow-up of a bottle never paused sets the drunk total only', async () => {
    const event = await bottle();
    await stopEvent(db, event.id, undefined, at(10));
    await db.events.update(event.id, {
      payload: { ...(await load(event.id)).payload, ended_by: 'sleep' },
    });
    const answered = await recordBottleLevel(db, event.id, 30, 0, at(30));
    expect(answered.payload).toMatchObject({ amount_drunk_ml: 90 });
    expect(answered.payload).not.toHaveProperty('segments');
    // Empty: all of it, stored as no drunk amount.
    const all = await recordBottleLevel(db, event.id, 0, 0, at(31));
    expect(all.payload).not.toHaveProperty('amount_drunk_ml');
  });
});

describe('"Time bottle feedings" off: a bottle is a moment', () => {
  it('has no timer, so no pause, no stretches and no question', async () => {
    const moment = await createEvent(
      db,
      {
        babyId: BABY_ID,
        typeId: FEEDING_TYPE.id,
        startedAt: T0.toISOString(),
        endedAt: T0.toISOString(),
        payload: { method: 'bottle', amount_ml: 120, amount_drunk_ml: 90 },
      },
      at(0),
    );
    expect(moment.payload).toEqual({ method: 'bottle', amount_ml: 120, amount_drunk_ml: 90 });
    askBottleLevel(moment);
    expect(renderHook(() => useBottleLevelPrompt()).result.current).toBeNull();
  });
});

describe('who may record a level', () => {
  it("a Caregiver's pause of someone else's bottle stays within the running-event exception", async () => {
    const event = await bottle();
    const stored = { ...event, createdBy: 'u-other' };
    await db.events.put(stored);
    const paused = await pauseTimer(db, event.id, at(5));
    expect(isRunningControlChange(stored, paused, T0.getTime() + 5 * 60_000)).toBe(true);
    const answered = await recordBottleLevel(db, event.id, 70, 1, at(5));
    expect(isRunningControlChange(paused, answered, T0.getTime() + 5 * 60_000)).toBe(true);
    const baby = { role: 'Caregiver' as const, userId: 'u-me' };
    expect(canControlTimer(baby, stored, T0.getTime() + 5 * 60_000)).toBe(true);
  });
});

describe('the left-in-bottle question after a pause', () => {
  it('is asked for a bottle whose pause closed a stretch, not for nursing or a stopped bottle', async () => {
    const event = await bottle();
    askBottleLevel(await pauseTimer(db, event.id, at(5)));
    expect(renderHook(() => useBottleLevelPrompt()).result.current).toMatchObject({
      eventId: event.id,
      preparedMl: 120,
      ceilingMl: 120,
      count: 1,
    });
    dismissBottleLevel();
    const nursing = await bottle({ method: 'breast' });
    askBottleLevel(await pauseTimer(db, nursing.id, at(6)));
    expect(renderHook(() => useBottleLevelPrompt()).result.current).toBeNull();
    askBottleLevel(await stopEvent(db, event.id, undefined, at(9)));
    expect(renderHook(() => useBottleLevelPrompt()).result.current).toBeNull();
  });
});
