import { describe, expect, it } from 'vitest';
import { createDatabase } from '../db/database';
import type { BabyEvent, EventType } from '../db/models';
import { prescription } from '../medications/prescriptionFixtures';
import {
  BABY_ID,
  bellyPayload,
  dirtyPayload,
  dosePayload,
  fussyPayload,
  napPayload,
  overtiredPayload,
  RX_ID,
  testPayload,
  wetPayload,
} from '../pwa/sw/pushTestKit';
import { fakePushDevice } from './fakePush';
import {
  closeResolvedNotifications,
  isResolved,
  loadResolutionFacts,
  type ResolutionFacts,
} from './resolvedNotifications';

const MED = 'med-1';
const SLOT = Date.parse('2026-10-21T21:00:00Z');
const NAP_AT = Date.parse('2026-10-21T17:20:00Z');
const BELLY_WINDOW = Date.parse('2026-10-21T20:30:00Z');
const OVERTIRED_LIMIT = Date.parse('2026-10-21T18:30:00Z');
const WET_AT = Date.parse('2026-10-21T18:40:00Z');
const DIRTY_AT = Date.parse('2026-10-21T19:05:00Z');
const MIN = 60_000;

type Dose = ResolutionFacts['doses'][number];

const facts = (over: Partial<ResolutionFacts> = {}): ResolutionFacts => ({
  doses: [],
  prescriptions: new Map([[RX_ID, MED]]),
  sleepStarts: [],
  bellyStarts: [],
  ...over,
});

const doseAt = (givenAt: number, over: Partial<Dose> = {}): Dose => ({
  babyId: BABY_ID,
  givenAt,
  medicationId: MED,
  prescriptionId: RX_ID,
  ...over,
});

describe('isResolved', () => {
  it('resolves a dose reminder once a dose of that prescription is logged near the slot', () => {
    expect(isResolved(dosePayload(), facts())).toBe(false);
    expect(isResolved(dosePayload(), facts({ doses: [doseAt(SLOT + 10 * MIN)] }))).toBe(true);
    expect(isResolved(dosePayload(), facts({ doses: [doseAt(SLOT - 80 * MIN)] }))).toBe(true);
    // Too far from the slot: the dose of another slot.
    expect(isResolved(dosePayload(), facts({ doses: [doseAt(SLOT - 180 * MIN)] }))).toBe(false);
  });

  it('counts a dose naming only the medication, never another prescription or baby', () => {
    const only = (over: Partial<Dose>) => facts({ doses: [doseAt(SLOT, over)] });
    expect(isResolved(dosePayload(), only({ prescriptionId: null }))).toBe(true);
    expect(isResolved(dosePayload(), only({ prescriptionId: 'other-rx' }))).toBe(false);
    expect(isResolved(dosePayload(), only({ babyId: 'other-baby' }))).toBe(false);
  });

  it('resolves a nap reminder once a sleep of that baby started', () => {
    const sleep = (startedAt: number, babyId = BABY_ID) =>
      facts({ sleepStarts: [{ babyId, startedAt }] });
    expect(isResolved(napPayload(), facts())).toBe(false);
    expect(isResolved(napPayload(), sleep(NAP_AT))).toBe(true);
    expect(isResolved(napPayload(), sleep(NAP_AT, 'other-baby'))).toBe(false);
    // A sleep long before the reminder belongs to the previous awake window.
    expect(isResolved(napPayload(), sleep(NAP_AT - 180 * MIN))).toBe(false);
  });

  it('resolves a belly pain heads-up once a belly pain or massage is logged from 45 min before the window', () => {
    const belly = (startedAt: number, babyId = BABY_ID) =>
      facts({ bellyStarts: [{ babyId, startedAt }] });
    expect(isResolved(bellyPayload(), facts())).toBe(false);
    expect(isResolved(bellyPayload(), belly(BELLY_WINDOW - 45 * MIN))).toBe(true);
    expect(isResolved(bellyPayload(), belly(BELLY_WINDOW + 10 * MIN))).toBe(true);
    expect(isResolved(bellyPayload(), belly(BELLY_WINDOW - 46 * MIN))).toBe(false);
    expect(isResolved(bellyPayload(), belly(BELLY_WINDOW, 'other-baby'))).toBe(false);
  });

  it('resolves an overtired heads-up once a sleep starts from 30 min before the limit', () => {
    const sleep = (startedAt: number, babyId = BABY_ID) =>
      facts({ sleepStarts: [{ babyId, startedAt }] });
    expect(isResolved(overtiredPayload(), facts())).toBe(false);
    expect(isResolved(overtiredPayload(), sleep(OVERTIRED_LIMIT - 30 * MIN))).toBe(true);
    expect(isResolved(overtiredPayload(), sleep(OVERTIRED_LIMIT + 5 * MIN))).toBe(true);
    expect(isResolved(overtiredPayload(), sleep(OVERTIRED_LIMIT - 31 * MIN))).toBe(false);
    expect(isResolved(overtiredPayload(), sleep(OVERTIRED_LIMIT, 'other-baby'))).toBe(false);
  });

  it('resolves a fussy heads-up once a fussy spell is logged from 45 min before the window', () => {
    const fussy = (startedAt: number, babyId = BABY_ID) =>
      facts({ fussyStarts: [{ babyId, startedAt }] });
    expect(isResolved(fussyPayload(), facts())).toBe(false);
    expect(isResolved(fussyPayload(), fussy(BELLY_WINDOW - 45 * MIN))).toBe(true);
    expect(isResolved(fussyPayload(), fussy(BELLY_WINDOW - 46 * MIN))).toBe(false);
    expect(isResolved(fussyPayload(), fussy(BELLY_WINDOW, 'other-baby'))).toBe(false);
    // A belly pain or massage does not handle the fussy window.
    expect(
      isResolved(
        fussyPayload(),
        facts({ bellyStarts: [{ babyId: BABY_ID, startedAt: BELLY_WINDOW }] }),
      ),
    ).toBe(false);
  });

  it('resolves a wet diaper heads-up once a wet or mixed diaper is logged from its send time', () => {
    const wet = (startedAt: number, babyId = BABY_ID) =>
      facts({ wetStarts: [{ babyId, startedAt }] });
    expect(isResolved(wetPayload(), facts())).toBe(false);
    expect(isResolved(wetPayload(), wet(WET_AT - 10 * MIN))).toBe(true);
    expect(isResolved(wetPayload(), wet(WET_AT + 20 * MIN))).toBe(true);
    expect(isResolved(wetPayload(), wet(WET_AT - 11 * MIN))).toBe(false);
    expect(isResolved(wetPayload(), wet(WET_AT, 'other-baby'))).toBe(false);
    // A dirty diaper does not resolve the wet heads-up.
    expect(
      isResolved(wetPayload(), facts({ dirtyStarts: [{ babyId: BABY_ID, startedAt: WET_AT }] })),
    ).toBe(false);
  });

  it('resolves a dirty diaper heads-up once a dirty or mixed diaper is logged from an hour before', () => {
    const dirty = (startedAt: number, babyId = BABY_ID) =>
      facts({ dirtyStarts: [{ babyId, startedAt }] });
    expect(isResolved(dirtyPayload(), facts())).toBe(false);
    expect(isResolved(dirtyPayload(), dirty(DIRTY_AT - 60 * MIN))).toBe(true);
    expect(isResolved(dirtyPayload(), dirty(DIRTY_AT - 61 * MIN))).toBe(false);
    expect(isResolved(dirtyPayload(), dirty(DIRTY_AT, 'other-baby'))).toBe(false);
  });

  it('never resolves tests or anything malformed', () => {
    expect(isResolved(testPayload(), facts())).toBe(false);
    expect(isResolved({ kind: 'dose_due' }, facts({ doses: [doseAt(SLOT)] }))).toBe(false);
    expect(isResolved(null, facts())).toBe(false);
  });
});

describe('closeResolvedNotifications', () => {
  it('closes only the resolved notifications', async () => {
    const device = fakePushDevice({ permission: 'granted' });
    device.state.shown = [
      { tag: 'dose', data: dosePayload() },
      { tag: 'nap', data: napPayload() },
      { tag: 'test', data: testPayload() },
    ];
    const closed = await closeResolvedNotifications(device, facts({ doses: [doseAt(SLOT)] }));
    expect(closed).toBe(1);
    expect(device.state.shown.map((n) => n.tag)).toEqual(['nap', 'test']);
  });

  it('never throws when the browser refuses', async () => {
    const device = fakePushDevice();
    device.shownNotifications = async () => {
      throw new Error('no registration');
    };
    expect(await closeResolvedNotifications(device, facts())).toBe(0);
  });
});

describe('loadResolutionFacts', () => {
  const type = (id: string, key: string): EventType => ({
    id,
    babyId: null,
    key,
    name: key,
    icon: 'x',
    color: '#000000',
    hasDuration: key === 'sleep',
    fields: [],
  });
  const event = (id: string, typeId: string, startedAt: number, extra: Partial<BabyEvent> = {}) =>
    ({
      id,
      babyId: BABY_ID,
      typeId,
      startedAt: new Date(startedAt).toISOString(),
      endedAt: null,
      payload: {},
      notes: null,
      createdBy: null,
      createdAt: new Date(startedAt).toISOString(),
      updatedAt: new Date(startedAt).toISOString(),
      deletedAt: null,
      ...extra,
    }) satisfies BabyEvent;

  it('reads recent doses and sleeps of every baby from the local store', async () => {
    const db = createDatabase(`resolve-${crypto.randomUUID()}`);
    const now = SLOT + 30 * MIN;
    await db.babies.add({ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role: 'Owner' });
    await db.eventTypes.bulkAdd([
      type('t-med', 'medication'),
      type('t-sleep', 'sleep'),
      type('t-massage', 'belly_massage'),
      type('t-fussy', 'fussy'),
      type('t-diaper', 'diaper'),
    ]);
    await db.prescriptions.add(prescription({ id: RX_ID, babyId: BABY_ID, medicationId: MED }));
    const medicationPayload = {
      medications: [{ medicationId: MED, name: 'X', prescriptionId: RX_ID }],
    };
    await db.events.bulkAdd([
      event('e1', 't-med', SLOT + 5 * MIN, { payload: medicationPayload }),
      event('e2', 't-sleep', NAP_AT),
      event('e3', 't-sleep', NAP_AT + MIN, { deletedAt: new Date(now).toISOString() }),
      event('e4', 't-med', now - 30 * 60 * MIN, { payload: medicationPayload }),
      event('e5', 't-massage', SLOT - 10 * MIN),
      event('e6', 't-fussy', SLOT - 20 * MIN),
      event('e7', 't-diaper', SLOT - 25 * MIN, { payload: { content: 'MIXED' } }),
      event('e8', 't-diaper', SLOT - 15 * MIN, { payload: { content: 'WET' } }),
    ]);
    const loaded = await loadResolutionFacts(db, now);
    expect(loaded.doses).toEqual([
      {
        babyId: BABY_ID,
        givenAt: SLOT + 5 * MIN,
        medicationId: MED,
        prescriptionId: RX_ID,
        override: false,
      },
    ]);
    expect(loaded.sleepStarts).toEqual([{ babyId: BABY_ID, startedAt: NAP_AT }]);
    expect(loaded.bellyStarts).toEqual([{ babyId: BABY_ID, startedAt: SLOT - 10 * MIN }]);
    expect(loaded.fussyStarts).toEqual([{ babyId: BABY_ID, startedAt: SLOT - 20 * MIN }]);
    expect(loaded.wetStarts?.map((wet) => wet.startedAt).sort()).toEqual([
      SLOT - 25 * MIN,
      SLOT - 15 * MIN,
    ]);
    expect(loaded.dirtyStarts).toEqual([{ babyId: BABY_ID, startedAt: SLOT - 25 * MIN }]);
    expect(loaded.prescriptions.get(RX_ID)).toBe(MED);
    expect(isResolved(dosePayload(), loaded)).toBe(true);
    db.close();
    await db.delete();
  });
});
