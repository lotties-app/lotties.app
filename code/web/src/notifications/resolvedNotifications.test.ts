import { describe, expect, it } from 'vitest';
import { createDatabase } from '../db/database';
import type { BabyEvent, EventType } from '../db/models';
import { prescription } from '../medications/prescriptionFixtures';
import { BABY_ID, dosePayload, napPayload, RX_ID, testPayload } from '../pwa/sw/pushTestKit';
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
const MIN = 60_000;

type Dose = ResolutionFacts['doses'][number];

const facts = (over: Partial<ResolutionFacts> = {}): ResolutionFacts => ({
  doses: [],
  prescriptions: new Map([[RX_ID, MED]]),
  sleepStarts: [],
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
    await db.eventTypes.bulkAdd([type('t-med', 'medication'), type('t-sleep', 'sleep')]);
    await db.prescriptions.add(prescription({ id: RX_ID, babyId: BABY_ID, medicationId: MED }));
    const medicationPayload = {
      medications: [{ medicationId: MED, name: 'X', prescriptionId: RX_ID }],
    };
    await db.events.bulkAdd([
      event('e1', 't-med', SLOT + 5 * MIN, { payload: medicationPayload }),
      event('e2', 't-sleep', NAP_AT),
      event('e3', 't-sleep', NAP_AT + MIN, { deletedAt: new Date(now).toISOString() }),
      event('e4', 't-med', now - 30 * 60 * MIN, { payload: medicationPayload }),
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
    expect(loaded.prescriptions.get(RX_ID)).toBe(MED);
    expect(isResolved(dosePayload(), loaded)).toBe(true);
    db.close();
    await db.delete();
  });
});
