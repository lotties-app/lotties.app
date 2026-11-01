import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { EventAlreadyStoppedError } from '../db/errors';
import { PresetAlreadyRunningError, PresetNotRunnableError, undoPreset } from '../presets/actions';
import { BUILT_IN_TYPES, FEEDING_T, event } from '../presets/presetFixtures';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { pauseTimer, resumeTimer } from '../db/eventCommands';
import { effectiveDurationSeconds } from '../timers/pauseMath';
import {
  nursingElapsed,
  startNursing,
  stopNursing,
  suggestedStartSide,
  switchSide,
} from './nursing';

let db: BabyRoutineDb;
beforeEach(() => {
  db = testDatabase();
});
afterEach(async () => {
  await db.delete();
});

const at = (h: number, m = 0, s = 0, day = 21) => new Date(2026, 9, day, h, m, s);
const ctx = (now: Date) => ({
  babyId: BABY_ID,
  types: BUILT_IN_TYPES,
  options: { now: () => now },
});
const opts = (now: Date) => ({ now: () => now });
const load = async (id: string) => (await db.events.get(id))!;

async function start(now: Date, side?: 'left' | 'right') {
  const token = await startNursing(db, { ...ctx(now), ...(side ? { side } : {}) });
  return token.createdIds[0];
}

describe('startNursing', () => {
  it('creates a running breast feed on the left with side_since = start', async () => {
    const token = await startNursing(db, ctx(at(3, 11)));
    const created = await load(token.createdIds[0]);
    expect(created).toMatchObject({
      typeId: FEEDING_T,
      startedAt: at(3, 11).toISOString(),
      endedAt: null,
      payload: { method: 'breast', side: 'left', side_since: at(3, 11).toISOString() },
    });
    expect(token).toMatchObject({ at: at(3, 11).toISOString(), stopped: [] });
    expect(await db.outbox.count()).toBe(1);
  });

  it('starts opposite to where the last feed ended', async () => {
    const id = await start(at(1), 'left');
    await switchSide(db, id, opts(at(1, 8)));
    await stopNursing(db, id, opts(at(1, 14)));
    const next = await start(at(4));
    expect((await load(next)).payload.side).toBe('left');
  });

  it('refuses a second session while one runs', async () => {
    await start(at(3));
    await expect(startNursing(db, ctx(at(3, 5)))).rejects.toBeInstanceOf(PresetAlreadyRunningError);
  });

  it('needs the feeding type', async () => {
    const types = BUILT_IN_TYPES.filter((t) => t.key !== 'feeding');
    await expect(startNursing(db, { babyId: BABY_ID, types })).rejects.toBeInstanceOf(
      PresetNotRunnableError,
    );
  });

  it('undo deletes the session', async () => {
    const token = await startNursing(db, ctx(at(3)));
    await undoPreset(db, token);
    expect((await load(token.createdIds[0])).deletedAt).not.toBeNull();
  });
});

describe('switchSide and stopNursing', () => {
  it('accumulates the segment, flips the side and moves side_since', async () => {
    const id = await start(at(3, 0), 'left');
    const token = await switchSide(db, id, opts(at(3, 6, 12)));
    const after = await load(id);
    expect(after.payload).toMatchObject({
      side: 'right',
      side_since: at(3, 6, 12).toISOString(),
      breast_left_seconds: 372,
      breast_right_seconds: 0,
    });
    expect(token.edited).toHaveLength(1);
    expect(nursingElapsed(after, at(3, 10, 15))).toEqual({
      left: 372,
      right: 243,
      total: 615,
      side: 'right',
      paused: false,
      sideSince: at(3, 6, 12).toISOString(),
    });
  });

  it('crosses midnight', async () => {
    const id = await start(at(23, 50, 0, 20), 'left');
    await switchSide(db, id, opts(at(0, 5, 0, 21)));
    await stopNursing(db, id, opts(at(0, 15, 0, 21)));
    expect((await load(id)).payload).toMatchObject({
      breast_left_seconds: 900,
      breast_right_seconds: 600,
      side: 'both',
      last_side: 'right',
    });
  });

  it('double switch adds to the same side again', async () => {
    const id = await start(at(3, 0), 'left');
    await switchSide(db, id, opts(at(3, 5)));
    await switchSide(db, id, opts(at(3, 8)));
    await stopNursing(db, id, opts(at(3, 10)));
    const stopped = await load(id);
    expect(stopped).toMatchObject({
      endedAt: at(3, 10).toISOString(),
      payload: {
        method: 'breast',
        breast_left_seconds: 420,
        breast_right_seconds: 180,
        side: 'both',
        last_side: 'left',
      },
    });
    expect(stopped.payload).not.toHaveProperty('side_since');
  });

  it('stop without a switch records one side', async () => {
    const id = await start(at(3, 0), 'right');
    await stopNursing(db, id, opts(at(3, 9, 30)));
    expect((await load(id)).payload).toEqual({
      method: 'breast',
      side: 'right',
      last_side: 'right',
      breast_left_seconds: 0,
      breast_right_seconds: 570,
    });
  });

  it('tapping the running side changes nothing', async () => {
    const id = await start(at(3, 0), 'left');
    const token = await switchSide(db, id, opts(at(3, 4)), 'left');
    expect(token.edited).toBeUndefined();
    expect((await load(id)).payload.breast_left_seconds).toBeUndefined();
  });

  it('undo of a switch restores the open segment; undo of a stop re-opens the session', async () => {
    const id = await start(at(3, 0), 'left');
    const switched = await switchSide(db, id, opts(at(3, 5)));
    await undoPreset(db, switched, opts(at(3, 6)));
    expect((await load(id)).payload).toEqual({
      method: 'breast',
      side: 'left',
      side_since: at(3, 0).toISOString(),
    });

    const stopped = await stopNursing(db, id, opts(at(3, 7)));
    await undoPreset(db, stopped, opts(at(3, 8)));
    const reopened = await load(id);
    expect(reopened.endedAt).toBeNull();
    expect(reopened.payload).toEqual({
      method: 'breast',
      side: 'left',
      side_since: at(3, 0).toISOString(),
    });
    expect(nursingElapsed(reopened, at(3, 10)).left).toBe(600);
  });

  it('undo leaves a session edited since alone', async () => {
    const id = await start(at(3, 0), 'left');
    const switched = await switchSide(db, id, opts(at(3, 5)));
    await switchSide(db, id, opts(at(3, 6)));
    await undoPreset(db, switched, opts(at(3, 7)));
    expect((await load(id)).payload.side).toBe('left');
    expect((await load(id)).payload.breast_right_seconds).toBe(60);
  });

  it('refuses to switch or stop a stopped session', async () => {
    const id = await start(at(3, 0));
    await stopNursing(db, id, opts(at(3, 5)));
    await expect(switchSide(db, id, opts(at(3, 6)))).rejects.toBeInstanceOf(
      EventAlreadyStoppedError,
    );
    await expect(stopNursing(db, id, opts(at(3, 6)))).rejects.toBeInstanceOf(
      EventAlreadyStoppedError,
    );
  });

  it('the session can be continued on another device: the payload holds everything', async () => {
    const id = await start(at(3, 0), 'left');
    await switchSide(db, id, opts(at(3, 4)));
    const copy = await load(id);
    // Another device reads the synced copy at 03:09.
    expect(nursingElapsed(copy, at(3, 9))).toMatchObject({ left: 240, right: 300 });
  });
});

describe('nursingElapsed and suggestedStartSide', () => {
  it('falls back to start + closed seconds without side_since', () => {
    const e = event({
      id: 'n',
      typeId: FEEDING_T,
      startedAt: at(3).toISOString(),
      payload: { method: 'breast', side: 'right', breast_left_seconds: 300 },
    });
    expect(nursingElapsed(e, at(3, 8))).toMatchObject({ left: 300, right: 180, side: 'right' });
  });

  it('never counts negative time', () => {
    const e = event({
      id: 'n',
      typeId: FEEDING_T,
      startedAt: at(3).toISOString(),
      payload: { method: 'breast', side: 'left', side_since: at(3, 5).toISOString() },
    });
    expect(nursingElapsed(e, at(3, 1)).left).toBe(0);
  });

  it('reads last_side, else a left/right side, else suggests left', () => {
    const feed = (payload: Record<string, unknown>, startedAt = at(1).toISOString()) =>
      event({ id: `f${startedAt}`, typeId: FEEDING_T, startedAt, endedAt: startedAt, payload });
    expect(suggestedStartSide([], FEEDING_T)).toEqual({
      side: 'left',
      lastSide: null,
      lastAt: null,
    });
    expect(
      suggestedStartSide([feed({ method: 'breast', side: 'both', last_side: 'left' })], FEEDING_T),
    ).toMatchObject({ side: 'right', lastSide: 'left' });
    expect(
      suggestedStartSide([feed({ method: 'breast', side: 'right' })], FEEDING_T),
    ).toMatchObject({ side: 'left', lastSide: 'right' });
    expect(
      suggestedStartSide(
        [
          feed({ method: 'breast', side: 'right' }, at(1).toISOString()),
          feed({ method: 'bottle' }, at(2).toISOString()),
        ],
        FEEDING_T,
      ),
    ).toMatchObject({ lastAt: at(1).toISOString() });
  });
});

describe('pausing a nursing session', () => {
  it('freezes the clocks while paused and excludes the pause after resuming', async () => {
    const id = await start(at(3, 0), 'left');
    await pauseTimer(db, id, opts(at(3, 5)));
    const paused = await load(id);
    expect(nursingElapsed(paused, at(3, 5)).left).toBe(300);
    // Ten minutes later the clocks still say five minutes.
    expect(nursingElapsed(paused, at(3, 15))).toMatchObject({ left: 300, paused: true });

    await resumeTimer(db, id, opts(at(3, 15)));
    const resumed = await load(id);
    expect(resumed.payload).toMatchObject({ paused_seconds: 600, pause_count: 1 });
    expect(nursingElapsed(resumed, at(3, 17)).left).toBe(420);
  });

  it('switching side while paused starts the new side at the pause point', async () => {
    const id = await start(at(3, 0), 'left');
    await pauseTimer(db, id, opts(at(3, 5)));
    await switchSide(db, id, opts(at(3, 9)));
    await resumeTimer(db, id, opts(at(3, 10)));
    const after = await load(id);
    expect(nursingElapsed(after, at(3, 12))).toMatchObject({
      left: 300,
      right: 120,
      side: 'right',
    });
  });

  it('stopping while paused keeps the sides and finalizes the pause', async () => {
    const id = await start(at(3, 0), 'left');
    await pauseTimer(db, id, opts(at(3, 6)));
    await stopNursing(db, id, opts(at(3, 20)));
    const stopped = await load(id);
    expect(stopped.payload).toMatchObject({
      breast_left_seconds: 360,
      breast_right_seconds: 0,
      paused_seconds: 840,
      pause_count: 1,
    });
    expect(stopped.payload).not.toHaveProperty('paused_at');
    expect(effectiveDurationSeconds(stopped)).toBe(360);
  });
});
