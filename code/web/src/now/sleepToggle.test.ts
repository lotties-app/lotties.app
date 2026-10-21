import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { createEvent } from '../db/eventCommands';
import { PresetAlreadyRunningError, PresetNotRunnableError, undoPreset } from '../presets/actions';
import { BUILT_IN_TYPES, SLEEP } from '../presets/presetFixtures';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import type { NowState } from './nowState';
import { isEmptyToken, runSleepAction, sleepToggleActions } from './sleepToggle';

let db: BabyRoutineDb;
beforeEach(() => {
  db = testDatabase();
});
afterEach(async () => {
  await db.delete();
});

const at = (h: number, m = 0, day = 21) => new Date(2026, 9, day, h, m, 0);
const ctx = (now: Date) => ({
  babyId: BABY_ID,
  types: BUILT_IN_TYPES,
  options: { now: () => now },
});
const live = async () => (await db.events.toArray()).filter((e) => e.deletedAt === null);

async function running(kind: string, start: Date) {
  return createEvent(
    db,
    { babyId: BABY_ID, typeId: SLEEP, startedAt: start.toISOString(), payload: { kind } },
    { now: () => start },
  );
}

describe('sleepToggleActions', () => {
  const awake: NowState = {
    kind: 'awake',
    since: at(12).toISOString(),
    awakeMinutes: 60,
    after: 'nap',
    sleepKindHint: 'nap',
  };
  const asleep = (sleepKind: 'nap' | 'night', nightWaking = false): NowState => ({
    kind: 'asleep',
    sleepKind,
    since: at(1).toISOString(),
    minutes: 10,
    eventId: 'e',
    fromMarker: false,
    ...(nightWaking
      ? { nightWaking: { eventId: 'w', since: at(3).toISOString(), minutes: 1 } }
      : {}),
  });

  it('awake: fell asleep, plus bedtime', () => {
    expect(sleepToggleActions(awake, at(13))).toEqual([
      { kind: 'fell_asleep', primary: true },
      { kind: 'bedtime', primary: false },
    ]);
  });

  it('unknown: fell asleep or woke up', () => {
    expect(sleepToggleActions({ kind: 'unknown', sleepKindHint: 'nap' }, at(13))).toEqual([
      { kind: 'fell_asleep', primary: true },
      { kind: 'woke_up', primary: false },
    ]);
  });

  it('nap: woke up only', () => {
    expect(sleepToggleActions(asleep('nap'), at(13))).toEqual([{ kind: 'woke_up', primary: true }]);
  });

  it('night: night waking leads at night, up for the day from 05:00 to 19:00', () => {
    expect(sleepToggleActions(asleep('night'), at(3)).map((a) => a.kind)).toEqual([
      'night_waking',
      'up_for_the_day',
    ]);
    expect(sleepToggleActions(asleep('night'), at(4, 59))[0].kind).toBe('night_waking');
    expect(sleepToggleActions(asleep('night'), at(5))[0].kind).toBe('up_for_the_day');
    expect(sleepToggleActions(asleep('night'), at(19))[0].kind).toBe('night_waking');
  });

  it('night waking: back asleep, plus up for the day', () => {
    expect(sleepToggleActions(asleep('night', true), at(3))).toEqual([
      { kind: 'back_asleep', primary: true },
      { kind: 'up_for_the_day', primary: false },
    ]);
  });
});

describe('runSleepAction', () => {
  it('fell asleep: logs the marker and starts a nap timer by day, in one transaction', async () => {
    const token = await runSleepAction(db, 'fell_asleep', ctx(at(13)));
    const events = await live();
    expect(events.map((e) => [e.payload.kind, e.endedAt === null]).sort()).toEqual([
      ['fell_asleep', false],
      ['nap', true],
    ]);
    expect(token).toMatchObject({ at: at(13).toISOString(), shiftMinutes: 0, stopped: [] });
    expect(token.createdIds).toHaveLength(2);
    expect(await db.outbox.count()).toBe(2);
  });

  it('fell asleep in the evening starts a night timer', async () => {
    await runSleepAction(db, 'fell_asleep', ctx(at(20)));
    expect((await live()).find((e) => e.endedAt === null)?.payload).toEqual({ kind: 'night' });
  });

  it('bedtime logs the marker', async () => {
    const token = await runSleepAction(db, 'bedtime', ctx(at(19)));
    expect((await live())[0]).toMatchObject({ payload: { kind: 'bed_time' } });
    expect(token.createdIds).toHaveLength(1);
  });

  it('woke up stops the nap and logs the marker; undo restores the nap', async () => {
    const nap = await running('nap', at(12));
    const token = await runSleepAction(db, 'woke_up', ctx(at(13)));
    expect(token.stopped).toEqual([{ id: nap.id, endedAt: at(13).toISOString() }]);
    expect((await db.events.get(nap.id))?.endedAt).toBe(at(13).toISOString());

    await undoPreset(db, token);
    const events = await live();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ id: nap.id, endedAt: null });
  });

  it('night waking starts a timer while the night keeps running', async () => {
    const night = await running('night', at(20, 0, 20));
    const token = await runSleepAction(db, 'night_waking', ctx(at(3)));
    const events = await live();
    expect(events.find((e) => e.id === night.id)?.endedAt).toBeNull();
    expect(events.find((e) => e.id === token.createdIds[0])).toMatchObject({
      payload: { kind: 'night_waking' },
      endedAt: null,
    });
  });

  it('refuses a second night waking', async () => {
    await running('night_waking', at(3));
    await expect(runSleepAction(db, 'night_waking', ctx(at(3, 5)))).rejects.toBeInstanceOf(
      PresetAlreadyRunningError,
    );
  });

  it('back asleep stops the night waking only', async () => {
    const night = await running('night', at(20, 0, 20));
    const waking = await running('night_waking', at(3));
    const token = await runSleepAction(db, 'back_asleep', ctx(at(3, 20)));
    expect(token).toMatchObject({ createdIds: [], stopped: [{ id: waking.id }] });
    expect((await db.events.get(night.id))?.endedAt).toBeNull();
    expect((await db.events.get(waking.id))?.endedAt).toBe(at(3, 20).toISOString());
  });

  it('back asleep with no night waking changes nothing', async () => {
    const token = await runSleepAction(db, 'back_asleep', ctx(at(3)));
    expect(isEmptyToken(token)).toBe(true);
    expect(await db.outbox.count()).toBe(0);
  });

  it('up for the day stops the night and a running night waking, logs the marker', async () => {
    const night = await running('night', at(20, 0, 20));
    const waking = await running('night_waking', at(6));
    const token = await runSleepAction(db, 'up_for_the_day', ctx(at(6, 30)));
    const end = at(6, 30).toISOString();
    expect(token.stopped).toEqual([
      { id: night.id, endedAt: end },
      { id: waking.id, endedAt: end },
    ]);
    expect((await live()).filter((e) => e.payload.kind === 'woke_up')).toHaveLength(1);

    await undoPreset(db, token);
    expect((await live()).map((e) => e.endedAt)).toEqual([null, null]);
  });

  it('throws without the sleep type', async () => {
    const types = BUILT_IN_TYPES.filter((t) => t.key !== 'sleep');
    await expect(
      runSleepAction(db, 'fell_asleep', { babyId: BABY_ID, types }),
    ).rejects.toBeInstanceOf(PresetNotRunnableError);
  });
});
