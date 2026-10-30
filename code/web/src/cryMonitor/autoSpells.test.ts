import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { createEvent } from '../db/eventCommands';
import type { EventType } from '../db/models';
import { cryAnswer, countsAsCrying, isAutoDetected } from '../events/cryDetection';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { FUSSY_TYPE, SLEEP_TYPE } from '../test/builtInTypes';
import { seedBaby } from '../test/seed';
import { endAutoSpell, setCryConfirmed, startAutoSpell } from './autoSpells';

/*
 * The cry monitor's spells through the normal local commands (docs/design/35-cry-engine.md section 8):
 * started at the cry's `at`, never twice, never over a spell started by hand, ended at the cry's end,
 * answered with "Yes, crying" / "Not crying"; every write is queued in the outbox (offline first).
 */

let db: BabyRoutineDb;
const TYPES: EventType[] = [FUSSY_TYPE, SLEEP_TYPE];
const AT = Date.UTC(2026, 9, 24, 21, 40);
const NOW = AT + 30_000; // the trigger decides about 20-30 s after the start
const options = { now: () => new Date(NOW) };
const input = { babyId: BABY_ID, types: TYPES, options };

beforeEach(async () => {
  db = testDatabase();
  await seedBaby(db);
  await db.eventTypes.bulkPut(TYPES);
});

afterEach(async () => {
  await db.delete();
});

describe('cry monitor spells', () => {
  it('starts a running fussy spell at the cry start, marked auto_detected only', async () => {
    const result = await startAutoSpell(db, input, AT);
    expect(result.kind).toBe('created');
    const id = (result as { id: string }).id;
    const event = await db.events.get(id);
    expect(event).toMatchObject({
      babyId: BABY_ID,
      typeId: FUSSY_TYPE.id,
      startedAt: new Date(AT).toISOString(),
      endedAt: null,
      payload: { auto_detected: true },
      createdBy: null,
      deletedAt: null,
    });
    // A client GUID, queued for the server like any entry (works offline).
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    const queued = await db.outbox.where('entityId').equals(id).toArray();
    expect(queued.map((m) => m.kind)).toEqual(['upsert']);
  });

  it('keeps a running monitor spell instead of creating a second one', async () => {
    const first = await startAutoSpell(db, input, AT);
    const second = await startAutoSpell(db, input, AT + 60_000);
    expect(second).toEqual({ kind: 'kept', id: (first as { id: string }).id });
    expect(await db.events.count()).toBe(1);
  });

  it('creates nothing while a spell started by hand runs', async () => {
    const manual = await createEvent(
      db,
      { babyId: BABY_ID, typeId: FUSSY_TYPE.id, startedAt: new Date(AT - 60_000).toISOString() },
      options,
    );
    expect(await startAutoSpell(db, input, AT)).toEqual({ kind: 'manual', id: manual.id });
    expect(await db.events.count()).toBe(1);
  });

  it('creates nothing without a fussy type', async () => {
    expect(await startAutoSpell(db, { ...input, types: [SLEEP_TYPE] }, AT)).toEqual({
      kind: 'noType',
    });
  });

  it('never starts in the future of the device clock', async () => {
    const result = await startAutoSpell(db, input, NOW + 5_000);
    const event = await db.events.get((result as { id: string }).id);
    expect(event?.startedAt).toBe(new Date(NOW).toISOString());
  });

  it("ends the spell at the cry's end (not when the end became known)", async () => {
    const { id } = (await startAutoSpell(db, input, AT)) as { id: string };
    const end = AT + 8 * 60_000;
    const closedAt = end + 3 * 60_000;
    expect(await endAutoSpell(db, id, end, { now: () => new Date(closedAt) })).toBe('ended');
    const event = await db.events.get(id);
    expect(event?.endedAt).toBe(new Date(end).toISOString());
    expect(event?.payload).toEqual({ auto_detected: true });
  });

  it('leaves a spell somebody stopped or deleted as it is', async () => {
    const { id } = (await startAutoSpell(db, input, AT)) as { id: string };
    await endAutoSpell(db, id, AT + 20_000, options);
    expect(await endAutoSpell(db, id, AT + 25_000, options)).toBe('alreadyEnded');
    expect((await db.events.get(id))?.endedAt).toBe(new Date(AT + 20_000).toISOString());
    await db.events.update(id, { deletedAt: new Date(NOW).toISOString() });
    expect(await endAutoSpell(db, id, AT + 120_000, options)).toBe('gone');
    expect(await endAutoSpell(db, 'missing', AT, options)).toBe('gone');
  });

  it('never ends past the device clock', async () => {
    const { id } = (await startAutoSpell(db, input, AT)) as { id: string };
    await endAutoSpell(db, id, NOW + 60_000, options);
    expect((await db.events.get(id))?.endedAt).toBe(new Date(NOW).toISOString());
  });

  it('never ends before the start of a kept spell', async () => {
    const { id } = (await startAutoSpell(db, input, AT)) as { id: string };
    expect(await endAutoSpell(db, id, AT - 60_000, options)).toBe('ended');
    expect((await db.events.get(id))?.endedAt).toBe(new Date(AT).toISOString());
  });

  it('records "Yes, crying" and "Not crying", which keeps the entry', async () => {
    const { id } = (await startAutoSpell(db, input, AT)) as { id: string };
    await endAutoSpell(db, id, AT + 60_000, options);
    let event = await setCryConfirmed(db, id, false, options);
    expect(event.payload).toEqual({ auto_detected: true, cry_confirmed: false });
    expect(event.deletedAt).toBeNull();
    expect(isAutoDetected(event)).toBe(true);
    expect(cryAnswer(event)).toBe(false);
    expect(countsAsCrying(event)).toBe(false);
    // Editable later.
    event = await setCryConfirmed(db, id, true, options);
    expect(cryAnswer(event)).toBe(true);
    expect(countsAsCrying(event)).toBe(true);
    expect(await db.outbox.where('entityId').equals(id).count()).toBeGreaterThan(0);
  });

  it('reads the marks as booleans only', () => {
    const of = (payload: Record<string, unknown>) => ({ payload });
    expect(isAutoDetected(of({ auto_detected: 'true' }))).toBe(false);
    expect(cryAnswer(of({ cry_confirmed: 0 }))).toBeNull();
    expect(countsAsCrying(of({}))).toBe(true);
    expect(countsAsCrying(of({ cry_confirmed: null }))).toBe(true);
  });
});
