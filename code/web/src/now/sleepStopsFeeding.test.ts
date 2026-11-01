import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isRunningControlChange } from '../baby/permissions';
import type { BabyRoutineDb } from '../db/database';
import { createEvent } from '../db/eventCommands';
import type { BabyEvent, BabyRole } from '../db/models';
import { PresetAlreadyRunningError, runPreset, undoPreset } from '../presets/actions';
import { BUILT_IN_TYPES, SLEEP, presetById } from '../presets/presetFixtures';
import { FEEDING_TYPE } from '../test/builtInTypes';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { startNursing } from './nursing';
import { runSleepAction } from './sleepToggle';
import { createEventStoppingFeeding, startsSleep } from './sleepStopsFeeding';

const TYPES = [...BUILT_IN_TYPES.filter((type) => type.key !== 'feeding'), FEEDING_TYPE];

let db: BabyRoutineDb;
beforeEach(async () => {
  db = testDatabase();
  await db.eventTypes.bulkPut(TYPES);
  await db.babies.put({ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role: 'Owner' });
});
afterEach(async () => {
  await db.delete();
});

const at = (h: number, m = 0, s = 0) => new Date(2026, 9, 21, h, m, s);
const ctx = (now: Date) => ({ babyId: BABY_ID, options: { now: () => now } });
const load = async (id: string) => (await db.events.get(id))!;
const asRole = (role: BabyRole, userId = 'u-me') =>
  db.babies.put({ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role, userId });

async function startBottle(now: Date, extra: Record<string, unknown> = {}, createdBy?: string) {
  const created = await createEvent(
    db,
    {
      babyId: BABY_ID,
      typeId: FEEDING_TYPE.id,
      startedAt: now.toISOString(),
      payload: { method: 'bottle', ...extra },
    },
    { now: () => now },
  );
  if (createdBy) await db.events.put({ ...created, createdBy });
  return created;
}

async function nursing(now: Date) {
  const token = await startNursing(db, {
    babyId: BABY_ID,
    types: TYPES,
    options: { now: () => now },
  });
  return load(token.createdIds[0]);
}

describe('a starting sleep stops the running feeding timers', () => {
  it('a nap timer stops a nursing session at the nap start, closing its seconds, and says so', async () => {
    const feed = await nursing(at(12, 0));

    const token = await runPreset(db, presetById('nap', TYPES), ctx(at(12, 20)));

    const stopped = await load(feed.id);
    expect(stopped.endedAt).toBe(at(12, 20).toISOString());
    expect(stopped.payload).toMatchObject({
      method: 'breast',
      side: 'left',
      breast_left_seconds: 20 * 60,
      ended_by: 'sleep',
    });
    expect(stopped.payload).not.toHaveProperty('side_since');
    const nap = await load(token.createdIds[0]);
    expect(nap).toMatchObject({
      typeId: SLEEP,
      endedAt: null,
      startedAt: at(12, 20).toISOString(),
    });
    expect(token.edited).toHaveLength(1);
    expect(token.edited?.[0]).toMatchObject({ id: feed.id, stops: true });
  });

  it('a bottle timer stops too, without asking for its amounts', async () => {
    const bottle = await startBottle(at(12, 0), { bottle_feeding_type: 'formula' });

    await runPreset(db, presetById('nap', TYPES), ctx(at(12, 10)));

    const stopped = await load(bottle.id);
    expect(stopped.endedAt).toBe(at(12, 10).toISOString());
    expect(stopped.payload).toEqual({
      method: 'bottle',
      bottle_feeding_type: 'formula',
      ended_by: 'sleep',
    });
  });

  it('keeps the amounts already known and a paused bottle settles its pause', async () => {
    const bottle = await startBottle(at(12, 0), { amount_ml: 120, amount_drunk_ml: 60 });
    await db.events.put({
      ...bottle,
      payload: { ...bottle.payload, paused_at: at(12, 5).toISOString() },
    });

    await runPreset(db, presetById('nap', TYPES), ctx(at(12, 15)));

    const stopped = await load(bottle.id);
    expect(stopped.payload).toMatchObject({
      amount_ml: 120,
      amount_drunk_ml: 60,
      ended_by: 'sleep',
    });
    expect(stopped.payload).not.toHaveProperty('paused_at');
    expect(stopped.payload.paused_seconds).toBe(10 * 60);
  });

  it('Fell asleep (the Now toggle) stops the feeding as well', async () => {
    const feed = await nursing(at(13, 0));

    await runSleepAction(db, 'fell_asleep', {
      babyId: BABY_ID,
      types: TYPES,
      options: { now: () => at(13, 12) },
    });

    expect((await load(feed.id)).payload).toMatchObject({ ended_by: 'sleep' });
    expect((await load(feed.id)).endedAt).toBe(at(13, 12).toISOString());
  });

  it('Bedtime, Night waking and Wake-up are not a sleep starting: the feeding keeps running', async () => {
    const feed = await nursing(at(2, 0));

    await runPreset(db, presetById('bedtime', TYPES), ctx(at(2, 5)));
    await runPreset(db, presetById('night_waking', TYPES), ctx(at(2, 6)));
    await runPreset(db, presetById('wake_up', TYPES), ctx(at(2, 7)));

    expect((await load(feed.id)).endedAt).toBeNull();
  });

  it('a nap that cannot start (one already runs) leaves the feeding alone', async () => {
    await runPreset(db, presetById('nap', TYPES), ctx(at(10, 0)));
    const feed = await nursing(at(10, 30));

    await expect(runPreset(db, presetById('nap', TYPES), ctx(at(10, 40)))).rejects.toBeInstanceOf(
      PresetAlreadyRunningError,
    );

    expect((await load(feed.id)).endedAt).toBeNull();
  });

  it('Undo reopens the feeding with its earlier payload and removes the nap', async () => {
    const feed = await nursing(at(12, 0));
    const before = await load(feed.id);

    const token = await runPreset(db, presetById('nap', TYPES), ctx(at(12, 20)));
    await undoPreset(db, token, { now: () => at(12, 21) });

    const reopened = await load(feed.id);
    expect(reopened.endedAt).toBeNull();
    expect(reopened.payload).toEqual(before.payload);
    expect((await load(token.createdIds[0])).deletedAt).not.toBeNull();
  });

  it('queues the stop as one idempotent upsert carrying ended_by', async () => {
    const bottle = await startBottle(at(12, 0));

    await runPreset(db, presetById('nap', TYPES), ctx(at(12, 10)));

    const upserts = (await db.outbox.toArray()).filter((m) => m.entityId === bottle.id);
    expect(upserts.map((m) => m.kind)).toEqual(['upsert', 'upsert']);
    const last = upserts.at(-1)!.payload as { endedAt: string; payload: Record<string, unknown> };
    expect(last.endedAt).toBe(at(12, 10).toISOString());
    expect(last.payload).toMatchObject({ ended_by: 'sleep' });
  });

  it('does not touch a feeding that started after the sleep start', async () => {
    const later = await startBottle(at(15, 0));

    await createEventStoppingFeeding(db, {
      babyId: BABY_ID,
      typeId: SLEEP,
      startedAt: at(14, 0).toISOString(),
      endedAt: at(14, 40).toISOString(),
      payload: { kind: 'nap' },
    });

    expect((await load(later.id)).endedAt).toBeNull();
  });
});

describe('the event sheet path (createEventStoppingFeeding)', () => {
  const sleepInput = (payload: Record<string, unknown>, startedAt = at(16, 0)) => ({
    babyId: BABY_ID,
    typeId: SLEEP,
    startedAt: startedAt.toISOString(),
    endedAt: null,
    payload,
  });

  it('a manual nap or night stops the running feeding at its start', async () => {
    const feed = await nursing(at(15, 40));

    await createEventStoppingFeeding(db, sleepInput({ kind: 'nap' }), { now: () => at(16, 1) });

    const stopped = await load(feed.id);
    expect(stopped.endedAt).toBe(at(16, 0).toISOString());
    expect(stopped.payload).toMatchObject({ ended_by: 'sleep', breast_left_seconds: 20 * 60 });
  });

  it.each(['bed_time', 'woke_up', 'fell_asleep', 'night_waking'])(
    'a %s sleep event leaves the feeding running',
    async (kind) => {
      const feed = await startBottle(at(15, 40));

      await createEventStoppingFeeding(db, sleepInput({ kind }));

      expect((await load(feed.id)).endedAt).toBeNull();
    },
  );

  it('an event of another type leaves the feeding running', async () => {
    const feed = await startBottle(at(15, 40));

    await createEventStoppingFeeding(db, {
      babyId: BABY_ID,
      typeId: 'type-bath',
      startedAt: at(16, 0).toISOString(),
      endedAt: at(16, 10).toISOString(),
    });

    expect((await load(feed.id)).endedAt).toBeNull();
  });
});

describe('startsSleep', () => {
  it('is a built-in sleep nap or night (a missing kind is a nap)', () => {
    const sleep = { key: 'sleep', babyId: null };
    expect(startsSleep(sleep, { kind: 'nap' })).toBe(true);
    expect(startsSleep(sleep, { kind: 'night' })).toBe(true);
    expect(startsSleep(sleep, {})).toBe(true);
    expect(startsSleep(sleep, { kind: 'night_waking' })).toBe(false);
    expect(startsSleep({ key: 'sleep', babyId: BABY_ID }, { kind: 'nap' })).toBe(false);
    expect(startsSleep({ key: 'bath', babyId: null }, {})).toBe(false);
    expect(startsSleep(undefined, {})).toBe(false);
  });
});

describe('roles (rules unchanged)', () => {
  it('a Caregiver stops her own nursing session', async () => {
    await asRole('Caregiver');
    const mine = await nursing(at(12, 0));

    await runPreset(db, presetById('nap', TYPES), ctx(at(12, 10)));

    expect((await load(mine.id)).payload).toMatchObject({ ended_by: 'sleep' });
  });

  it('a Caregiver stops someone else’s bottle (only the end and ended_by change) but not their nursing', async () => {
    await asRole('Caregiver');
    const bottle = await startBottle(at(12, 0), {}, 'u-ana');

    await runPreset(db, presetById('nap', TYPES), ctx(at(12, 10)));

    const stopped = await load(bottle.id);
    expect(stopped.endedAt).toBe(at(12, 10).toISOString());
    expect(isRunningControlChange(bottle as BabyEvent, stopped)).toBe(true);
    expect(stopped.payload).toEqual({ method: 'bottle', ended_by: 'sleep' });
  });

  it('a Caregiver leaves someone else’s nursing session running', async () => {
    await asRole('Caregiver');
    const other = await createEvent(
      db,
      {
        babyId: BABY_ID,
        typeId: FEEDING_TYPE.id,
        startedAt: at(12, 0).toISOString(),
        payload: { method: 'breast', side: 'left', side_since: at(12, 0).toISOString() },
      },
      { now: () => at(12, 0) },
    );
    await db.events.put({ ...other, createdBy: 'u-ana' });

    await runPreset(db, presetById('nap', TYPES), ctx(at(12, 10)));

    expect((await load(other.id)).endedAt).toBeNull();
  });

  it('an Owner stops the feeding someone else started', async () => {
    const other = await startBottle(at(12, 0), {}, 'u-ana');

    await runPreset(db, presetById('nap', TYPES), ctx(at(12, 10)));

    expect((await load(other.id)).payload).toMatchObject({ ended_by: 'sleep' });
  });
});
