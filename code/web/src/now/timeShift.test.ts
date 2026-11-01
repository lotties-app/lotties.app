import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { createEvent, editEvent } from '../db/eventCommands';
import { undoPreset, type UndoToken } from '../presets/actions';
import { BUILT_IN_TYPES, SLEEP } from '../presets/presetFixtures';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { startNursing, stopNursing, switchSide } from './nursing';
import { runSleepAction } from './sleepToggle';
import { TokenNotShiftableError, isShiftable, shiftEventStart } from './timeShift';

let db: BabyRoutineDb;
beforeEach(() => {
  db = testDatabase();
});
afterEach(async () => {
  await db.delete();
});

const at = (h: number, m = 0, day = 21) => new Date(2026, 9, day, h, m, 0);
const iso = (h: number, m = 0, day = 21) => at(h, m, day).toISOString();
const ctx = (now: Date) => ({
  babyId: BABY_ID,
  types: BUILT_IN_TYPES,
  options: { now: () => now },
});
const load = async (id: string) => (await db.events.get(id))!;
const clock = (now: Date) => ({ now: () => now });

describe('shiftEventStart', () => {
  it('moves a started timer and its marker back; the offset is absolute', async () => {
    const token = await runSleepAction(db, 'fell_asleep', ctx(at(14, 12)));
    await db.outbox.clear();

    const shifted = await shiftEventStart(db, token, 10, clock(at(14, 13)));
    expect(shifted.shiftMinutes).toBe(10);
    for (const id of token.createdIds) {
      expect((await load(id)).startedAt).toBe(iso(14, 2));
    }
    const marker = (await Promise.all(token.createdIds.map(load))).find((e) => e.endedAt !== null)!;
    expect(marker.endedAt).toBe(iso(14, 2));
    // Edits are queued like any other edit, with a fresh client edit time.
    const queued = await db.outbox.toArray();
    expect(queued).toHaveLength(2);
    expect((await load(token.createdIds[0])).clientUpdatedAt).toBe(iso(14, 13));

    await shiftEventStart(db, shifted, 5, clock(at(14, 13)));
    for (const id of token.createdIds) expect((await load(id)).startedAt).toBe(iso(14, 7));
    await shiftEventStart(db, shifted, 0, clock(at(14, 13)));
    for (const id of token.createdIds) expect((await load(id)).startedAt).toBe(iso(14, 12));
  });

  it('moves the end of a stopped timer, and undo still re-opens it', async () => {
    const nap = await createEvent(
      db,
      { babyId: BABY_ID, typeId: SLEEP, startedAt: iso(12), payload: { kind: 'nap' } },
      clock(at(12)),
    );
    const token = await runSleepAction(db, 'woke_up', ctx(at(13)));
    const shifted = await shiftEventStart(db, token, 5, clock(at(13, 1)));
    expect((await load(nap.id)).endedAt).toBe(iso(12, 55));
    expect(shifted.stopped).toEqual([{ id: nap.id, endedAt: iso(12, 55) }]);

    await undoPreset(db, shifted, clock(at(13, 2)));
    expect((await load(nap.id)).endedAt).toBeNull();
  });

  it('never moves an end before its start', async () => {
    const nap = await createEvent(
      db,
      { babyId: BABY_ID, typeId: SLEEP, startedAt: iso(12, 58), payload: { kind: 'nap' } },
      clock(at(12, 58)),
    );
    const token = await runSleepAction(db, 'woke_up', ctx(at(13)));
    await shiftEventStart(db, token, 15, clock(at(13)));
    expect((await load(nap.id)).endedAt).toBe(iso(12, 58));
  });

  it('clamps to the baby birth (local midnight) and to now', async () => {
    const token = await runSleepAction(db, 'bedtime', ctx(at(0, 5)));
    await shiftEventStart(db, token, 15, { birthDate: '2026-10-21', now: () => at(0, 6) });
    expect((await load(token.createdIds[0])).startedAt).toBe(iso(0, 0));

    const future: UndoToken = { ...token, at: iso(1, 0) };
    await shiftEventStart(db, future, 5, { now: () => at(0, 30) });
    expect((await load(token.createdIds[0])).startedAt).toBe(iso(0, 30));
  });

  it('leaves events deleted or edited since alone', async () => {
    const nap = await createEvent(
      db,
      { babyId: BABY_ID, typeId: SLEEP, startedAt: iso(12), payload: { kind: 'nap' } },
      clock(at(12)),
    );
    const token = await runSleepAction(db, 'woke_up', ctx(at(13)));
    await editEvent(db, nap.id, { endedAt: iso(12, 50) }, clock(at(13, 0)));
    const shifted = await shiftEventStart(db, token, 5, clock(at(13, 1)));
    expect((await load(nap.id)).endedAt).toBe(iso(12, 50));
    expect(shifted.stopped).toEqual(token.stopped);
  });

  it('moves a nursing start together with its open segment', async () => {
    const token = await startNursing(db, ctx(at(3, 10)));
    await shiftEventStart(db, token, 10, clock(at(3, 11)));
    expect((await load(token.createdIds[0])).payload).toMatchObject({
      side_since: iso(3, 0),
    });
    expect((await load(token.createdIds[0])).startedAt).toBe(iso(3, 0));
  });

  it('moves a nursing stop and takes the time off the last side', async () => {
    const started = await startNursing(db, { ...ctx(at(3, 0)), side: 'left' });
    const id = started.createdIds[0];
    await switchSide(db, id, clock(at(3, 8)));
    const stopped = await stopNursing(db, id, clock(at(3, 20)));
    expect(isShiftable(stopped)).toBe(true);

    const shifted = await shiftEventStart(db, stopped, 5, clock(at(3, 21)));
    expect(await load(id)).toMatchObject({
      endedAt: iso(3, 15),
      payload: { breast_left_seconds: 480, breast_right_seconds: 420 },
    });
    // Undo after a shift still re-opens the session.
    await undoPreset(db, shifted, clock(at(3, 22)));
    expect((await load(id)).endedAt).toBeNull();
  });

  it('a side switch is not shiftable; a token without `at` cannot shift', async () => {
    const started = await startNursing(db, ctx(at(3, 0)));
    const switched = await switchSide(db, started.createdIds[0], clock(at(3, 5)));
    expect(isShiftable(switched)).toBe(false);
    expect(isShiftable(started)).toBe(true);
    const { at: _omit, ...withoutAt } = started;
    void _omit;
    await expect(shiftEventStart(db, withoutAt, 5)).rejects.toBeInstanceOf(TokenNotShiftableError);
  });
});
