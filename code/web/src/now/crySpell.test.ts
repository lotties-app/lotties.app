import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { BabyEvent, EventType } from '../db/models';
import { undoPreset } from '../presets/actions';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import { FEEDING_TYPE, FUSSY_TYPE } from '../test/builtInTypes';
import { logCrySpell, whatWorkedChips, type CrySpellInput } from './crySpell';

/* The "What worked?" answer of docs/design/27-cry-reasons.md section 9, against the local store. */

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  await db.delete();
});

const NOW = new Date('2026-10-23T18:30:00.000Z');
const OPENED = new Date('2026-10-23T18:22:00.000Z');
const TYPES: EventType[] = [FEEDING_TYPE, FUSSY_TYPE];

function input(overrides: Partial<CrySpellInput> = {}): CrySpellInput {
  return {
    babyId: BABY_ID,
    types: TYPES,
    openedAt: OPENED,
    chip: 'held',
    suggestedCause: 'hunger',
    canChange: () => true,
    canControl: () => true,
    options: { now: () => NOW },
    ...overrides,
  };
}

async function putSpell(overrides: Partial<BabyEvent> = {}): Promise<BabyEvent> {
  const event: BabyEvent = {
    id: 'spell-running',
    babyId: BABY_ID,
    typeId: FUSSY_TYPE.id,
    startedAt: '2026-10-23T18:10:00.000Z',
    endedAt: null,
    payload: { intensity: 'intense' },
    notes: null,
    createdBy: null,
    createdAt: '2026-10-23T18:10:00.000Z',
    updatedAt: '2026-10-23T18:10:00.000Z',
    deletedAt: null,
    ...overrides,
  };
  await db.events.put(event);
  return event;
}

const live = async () => (await db.events.toArray()).filter((e) => e.deletedAt === null);

describe('logCrySpell', () => {
  it('logs one fussy spell from when the sheet opened until now, with the answer and the first cause', async () => {
    const token = await logCrySpell(db, input());

    const events = await live();
    expect(events).toHaveLength(1);
    const [spell] = events;
    expect(spell.typeId).toBe(FUSSY_TYPE.id);
    expect(spell.startedAt).toBe(OPENED.toISOString());
    expect(spell.endedAt).toBe(NOW.toISOString());
    expect(spell.payload).toEqual({ what_helped: 'holding', suggested_cause: 'hunger' });
    expect(token.createdIds).toEqual([spell.id]);
    // No command moment: the toast offers Undo without the time-shift chips.
    expect(token.at).toBeUndefined();
    const outbox = await db.outbox.toArray();
    expect(outbox.map((entry) => entry.entityId)).toContain(spell.id);
  });

  it.each([
    ['fed', 'feeding'],
    ['changedDiaper', 'diaper_change'],
    ['slept', 'sleep'],
    ['burped', 'burping'],
    ['held', 'holding'],
    ['rocked', 'rocking'],
    ['pacifier', 'pacifier'],
    ['massage', 'massage'],
    ['nothingYet', 'nothing'],
  ] as const)('the %s chip saves what_helped %s', async (chip, option) => {
    await logCrySpell(db, input({ chip, suggestedCause: 'gas' }));
    const [spell] = await live();
    expect(spell.payload).toEqual({ what_helped: option, suggested_cause: 'gas' });
  });

  it('stops a running fussy timer and fills it in instead of logging a second spell', async () => {
    const running = await putSpell();
    const token = await logCrySpell(db, input({ chip: 'fed', suggestedCause: 'sleepy' }));

    const events = await live();
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(running.id);
    expect(events[0].startedAt).toBe(running.startedAt);
    expect(events[0].endedAt).toBe(NOW.toISOString());
    expect(events[0].payload).toEqual({
      intensity: 'intense',
      what_helped: 'feeding',
      suggested_cause: 'sleepy',
    });
    expect(token.createdIds).toEqual([]);

    await undoPreset(db, token);
    const [restored] = await live();
    expect(restored.endedAt).toBeNull();
    expect(restored.payload).toEqual({ intensity: 'intense' });
  });

  it("only fills the empty answers of someone else's running spell for a Caregiver", async () => {
    await putSpell({ createdBy: 'u-ana', payload: { what_helped: 'rocking' } });
    await logCrySpell(db, input({ chip: 'fed', canChange: () => false }));

    const [spell] = await live();
    expect(spell.endedAt).toBe(NOW.toISOString());
    expect(spell.payload).toEqual({ what_helped: 'rocking', suggested_cause: 'hunger' });
  });

  it('logs a new spell when the running one may not be stopped', async () => {
    await putSpell({ createdBy: 'u-ana' });
    await logCrySpell(db, input({ canChange: () => false, canControl: () => false }));

    const events = await live();
    expect(events).toHaveLength(2);
    expect(events.find((e) => e.id === 'spell-running')?.endedAt).toBeNull();
  });

  it('undo removes the logged spell', async () => {
    const token = await logCrySpell(db, input());
    await undoPreset(db, token);
    expect(await live()).toEqual([]);
  });

  it('leaves out an option or field the baby type does not declare', async () => {
    const older: EventType = {
      ...FUSSY_TYPE,
      fields: FUSSY_TYPE.fields
        .filter((f) => f.key !== 'suggested_cause')
        .map((f) =>
          f.key === 'what_helped' ? { ...f, options: f.options.filter((o) => o !== 'holding') } : f,
        ),
    };
    await logCrySpell(db, input({ types: [older], chip: 'held' }));
    const [spell] = await live();
    expect(spell.payload).toEqual({});
    expect(whatWorkedChips([older])).not.toContain('held');
    expect(whatWorkedChips([older])).toContain('fed');
  });

  it('offers no chips without the fussy type', () => {
    expect(whatWorkedChips([FEEDING_TYPE])).toEqual([]);
    expect(whatWorkedChips(TYPES)).toEqual([
      'fed',
      'changedDiaper',
      'slept',
      'burped',
      'held',
      'rocked',
      'pacifier',
      'massage',
      'nothingYet',
    ]);
  });
});
