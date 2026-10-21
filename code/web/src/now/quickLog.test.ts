import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import type { BabyEvent, EventType, Medication } from '../db/models';
import { readLastUsed, readLastUsedMedications, recordLastUsed } from '../events/lastUsedValues';
import { undoPreset } from '../presets/actions';
import { event, eventType } from '../presets/presetFixtures';
import { DIAPER_TYPE, FEEDING_TYPE, SLEEP_TYPE } from '../test/builtInTypes';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import {
  TrayChoiceInvalidError,
  bellyPainTray,
  diaperTray,
  feedTrayOptions,
  lastAndLogTiles,
  medicationPayloadEntries,
  medsTray,
  runTrayChoice,
} from './quickLog';

const MED_TYPE = eventType({ id: 'type-med', key: 'medication', name: 'Medication' });
const BELLY_TYPE = eventType({
  id: 'type-belly',
  key: 'belly_pain',
  name: 'Belly pain',
  fields: [
    {
      key: 'intensity',
      label: 'Intensity',
      kind: 'number',
      isRequired: true,
      options: [],
      min: 1,
      max: 5,
      unit: null,
    },
  ],
});
const BATH_TYPE = eventType({ id: 'type-bath', key: 'bath', name: 'Bath' });
const CUSTOM_TYPE = eventType({ id: 'c1', key: 'vitamin_d', name: 'Vitamin D', babyId: BABY_ID });
const TYPES: EventType[] = [
  FEEDING_TYPE,
  SLEEP_TYPE,
  DIAPER_TYPE,
  MED_TYPE,
  BELLY_TYPE,
  BATH_TYPE,
  CUSTOM_TYPE,
];

const MEDS: Medication[] = [
  {
    id: 'm1',
    babyId: BABY_ID,
    name: 'Colidis',
    defaultDosage: { amount: 5, unit: 'drops' },
    notes: null,
    isUsual: true,
    createdAt: '2026-10-01T00:00:00.000Z',
  },
  {
    id: 'm2',
    babyId: BABY_ID,
    name: 'Paracetamol',
    defaultDosage: null,
    notes: null,
    isUsual: false,
    createdAt: '2026-10-01T00:00:00.000Z',
  },
];

const at = (h: number, m = 0, day = 21) => new Date(2026, 9, day, h, m, 0);
const iso = (h: number, m = 0, day = 21) => at(h, m, day).toISOString();

let n = 0;
function logged(typeId: string, when: string, payload: Record<string, unknown>, end = when) {
  n += 1;
  return event({ id: `e${n}`, typeId, startedAt: when, endedAt: end, payload });
}

describe('lastAndLogTiles', () => {
  it('lists Feed, Diaper, Meds and More with their status and detail', () => {
    const events: BabyEvent[] = [
      logged(FEEDING_TYPE.id, iso(12, 2), {
        method: 'bottle',
        amount_ml: 120,
        bottle_feeding_type: 'formula',
      }),
      logged(FEEDING_TYPE.id, iso(9), { method: 'breast', side: 'left' }),
      logged(DIAPER_TYPE.id, iso(13, 32), { content: 'WET' }),
    ];
    const tiles = lastAndLogTiles(TYPES, events, at(14, 12));
    expect(tiles.map((t) => t.id)).toEqual(['feed', 'diaper', 'meds', 'more']);
    expect(tiles[0]).toMatchObject({
      typeId: FEEDING_TYPE.id,
      status: { lastAt: iso(12, 2) },
      running: null,
      detail: {
        kind: 'feed',
        method: 'bottle',
        amountMl: 120,
        bottleContent: 'formula',
        side: null,
      },
    });
    expect(tiles[1]).toMatchObject({
      status: { lastAt: iso(13, 32) },
      detail: { kind: 'diaper', content: 'WET' },
    });
    expect(tiles[2]).toMatchObject({
      status: 'untracked-today',
      detail: { kind: 'meds', names: [], nextAllowedAt: null },
    });
    expect(tiles[3]).toMatchObject({
      typeId: null,
      status: null,
      moreTypeIds: [BELLY_TYPE.id, BATH_TYPE.id, CUSTOM_TYPE.id],
    });
  });

  it('shows a running nursing session on the Feed tile', () => {
    const running = event({
      id: 'running',
      typeId: FEEDING_TYPE.id,
      startedAt: iso(14),
      endedAt: null,
      payload: { method: 'breast', side: 'left' },
    });
    const [feed] = lastAndLogTiles(TYPES, [running], at(14, 10));
    expect(feed).toMatchObject({ status: 'running', running: { id: running.id } });
  });

  it('names the last medications', () => {
    const med = logged(MED_TYPE.id, iso(11, 40), {
      medications: [
        { medicationId: 'm1', name: 'Colidis' },
        { medicationId: 'm2', name: 'Paracetamol' },
      ],
    });
    const meds = lastAndLogTiles(TYPES, [med], at(14))[2];
    expect(meds.detail).toEqual({
      kind: 'meds',
      names: ['Colidis', 'Paracetamol'],
      nextAllowedAt: null,
    });
  });

  it('leaves out tiles whose type is missing, and ignores deleted and future events', () => {
    const tiles = lastAndLogTiles([DIAPER_TYPE], [], at(14));
    expect(tiles.map((t) => t.id)).toEqual(['diaper', 'more']);
    const deleted = { ...logged(DIAPER_TYPE.id, iso(13), { content: 'WET' }), deletedAt: iso(13) };
    const future = logged(DIAPER_TYPE.id, iso(15), { content: 'WET' });
    expect(lastAndLogTiles(TYPES, [deleted, future], at(14))[1]).toMatchObject({
      status: 'untracked-today',
      last: null,
    });
  });
});

describe('trays', () => {
  it('feed tray: last bottle, amount chips topped up from the defaults, side to start', () => {
    const events = [
      logged(FEEDING_TYPE.id, iso(12), {
        method: 'bottle',
        amount_ml: 110,
        bottle_feeding_type: 'breast_milk',
      }),
      logged(FEEDING_TYPE.id, iso(9), { method: 'bottle', amount_ml: 90 }),
      logged(FEEDING_TYPE.id, iso(6), {
        method: 'breast',
        side: 'both',
        last_side: 'right',
      }),
    ];
    const tray = feedTrayOptions(BABY_ID, TYPES, events, at(14))!;
    expect(tray).toMatchObject({
      typeId: FEEDING_TYPE.id,
      lastMethod: 'bottle',
      bottle: {
        amounts: [60, 90, 110, 120],
        amountMl: 110,
        content: 'breast_milk',
        contents: ['formula', 'breast_milk'],
        same: { amountMl: 110, content: 'breast_milk', at: iso(12) },
      },
      breast: { side: 'left', lastSide: 'right', lastAt: iso(6), runningId: null },
      solid: {
        typeId: FEEDING_TYPE.id,
        startedAt: iso(14),
        endedAt: iso(14),
        payload: { method: 'solid' },
      },
    });
  });

  it('feed tray without history: defaults, then the remembered amount', () => {
    const tray = feedTrayOptions(BABY_ID, TYPES, [], at(14))!;
    expect(tray.bottle).toEqual({
      amounts: [60, 90, 120, 150],
      amountMl: 90,
      content: null,
      contents: ['formula', 'breast_milk'],
      same: null,
    });
    expect(tray.breast.side).toBe('left');

    recordLastUsed(BABY_ID, FEEDING_TYPE, {
      method: 'bottle',
      amount_ml: 130,
      bottle_feeding_type: 'formula',
    });
    expect(feedTrayOptions(BABY_ID, TYPES, [], at(14))!.bottle).toMatchObject({
      amounts: [60, 90, 120, 130],
      amountMl: 130,
      content: 'formula',
    });
  });

  it('diaper, meds and belly pain trays', () => {
    expect(diaperTray(TYPES)).toEqual({
      typeId: DIAPER_TYPE.id,
      options: ['WET', 'DIRTY', 'MIXED'],
    });
    expect(bellyPainTray(TYPES)).toEqual({ typeId: BELLY_TYPE.id, intensities: [1, 2, 3, 4, 5] });
    const med = logged(MED_TYPE.id, iso(11), {
      medications: [
        { medicationId: 'm1', name: 'Colidis', dose: { amount: 5, unit: 'drops' } },
        'junk',
      ],
    });
    expect(medsTray(BABY_ID, TYPES, MEDS, [med], at(14))).toEqual({
      typeId: MED_TYPE.id,
      prescriptions: [],
      usual: [MEDS[0]],
      others: [MEDS[1]],
      lastUsedIds: [],
      same: {
        medications: [{ medicationId: 'm1', name: 'Colidis', dose: { amount: 5, unit: 'drops' } }],
        at: iso(11),
      },
    });
    expect(diaperTray([])).toBeNull();
    expect(medsTray(BABY_ID, [], MEDS, [], at(14))).toBeNull();
  });

  it('medication entries carry the catalog default dose, in catalog order', () => {
    expect(medicationPayloadEntries(['m2', 'm1'], MEDS)).toEqual([
      { medicationId: 'm1', name: 'Colidis', dose: { amount: 5, unit: 'drops' } },
      { medicationId: 'm2', name: 'Paracetamol' },
    ]);
  });
});

describe('runTrayChoice', () => {
  let db: BabyRoutineDb;
  beforeEach(() => {
    db = testDatabase();
  });
  afterEach(async () => {
    await db.delete();
  });
  const ctx = (now: Date, minutesAgo?: number) => ({
    babyId: BABY_ID,
    types: TYPES,
    options: { now: () => now },
    ...(minutesAgo !== undefined ? { minutesAgo } : {}),
  });
  const live = async () => (await db.events.toArray()).filter((e) => e.deletedAt === null);

  it('one tap logs a diaper; undo removes it', async () => {
    const token = await runTrayChoice(db, { kind: 'diaper', content: 'WET' }, ctx(at(14)));
    const [logged] = await live();
    expect(logged).toMatchObject({
      typeId: DIAPER_TYPE.id,
      startedAt: iso(14),
      endedAt: iso(14),
      payload: { content: 'WET' },
    });
    expect(token).toEqual({
      babyId: BABY_ID,
      createdIds: [logged.id],
      stopped: [],
      at: iso(14),
      shiftMinutes: 0,
    });
    expect(await db.outbox.count()).toBe(1);
    await undoPreset(db, token);
    expect(await live()).toHaveLength(0);
  });

  it('logs a bottle as a zero-length feed in the past and remembers the values', async () => {
    const token = await runTrayChoice(
      db,
      { kind: 'bottle', amountMl: 120, content: 'formula' },
      ctx(at(14), 15),
    );
    expect((await live())[0]).toMatchObject({
      startedAt: iso(13, 45),
      endedAt: iso(13, 45),
      payload: { method: 'bottle', amount_ml: 120, bottle_feeding_type: 'formula' },
    });
    expect(token).toMatchObject({ at: iso(14), shiftMinutes: 15 });
    expect(readLastUsed(BABY_ID, FEEDING_TYPE.id)).toMatchObject({
      method: 'bottle',
      amount_ml: 120,
      bottle_feeding_type: 'formula',
    });
  });

  it('logs one medication event with the selected entries', async () => {
    const medications = medicationPayloadEntries(['m1'], MEDS);
    await runTrayChoice(db, { kind: 'medication', medications }, ctx(at(14)));
    expect((await live())[0]).toMatchObject({ typeId: MED_TYPE.id, payload: { medications } });
    expect(readLastUsedMedications(BABY_ID)).toEqual(['m1']);
  });

  it('logs belly pain with its intensity', async () => {
    await runTrayChoice(db, { kind: 'belly_pain', intensity: 3 }, ctx(at(14)));
    expect((await live())[0]).toMatchObject({ payload: { intensity: 3 } });
  });

  it('refuses invalid choices without writing anything', async () => {
    await expect(
      runTrayChoice(db, { kind: 'diaper', content: 'wet' }, ctx(at(14))),
    ).rejects.toMatchObject({ name: 'TrayChoiceInvalidError', fields: ['content'] });
    await expect(
      runTrayChoice(db, { kind: 'belly_pain', intensity: 9 }, ctx(at(14))),
    ).rejects.toBeInstanceOf(TrayChoiceInvalidError);
    await expect(
      runTrayChoice(db, { kind: 'medication', medications: [] }, ctx(at(14))),
    ).rejects.toBeInstanceOf(TrayChoiceInvalidError);
    expect(await db.outbox.count()).toBe(0);
  });

  it('breast starts a nursing session', async () => {
    const token = await runTrayChoice(db, { kind: 'breast', side: 'right' }, ctx(at(3)));
    expect((await live())[0]).toMatchObject({
      endedAt: null,
      payload: { method: 'breast', side: 'right' },
    });
    expect(token.createdIds).toHaveLength(1);
  });
});
