import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/ApiError';
import type { BabyRoutineDb } from '../db/database';
import { createEvent } from '../db/eventCommands';
import { createMedication, updateMedication } from '../db/medicationCommands';
import { enqueueMutation } from '../db/outbox';
import {
  createPrescription,
  deletePrescription,
  updatePrescription,
  termsOf,
} from '../db/prescriptionCommands';
import { asNeeded } from '../medications/prescriptionFixtures';
import {
  BABY_ID,
  SERVER_TIME,
  TYPE_ID,
  fakeApi,
  httpError,
  testDatabase,
  type ApiCall,
  type ApiHandler,
} from '../test/fakeApi';
import { toPrescriptionUpsertRequest, type PrescriptionDto } from './contract';
import { mergePrescriptionDelta, PULL_OVERLAP_MS } from './pull';
import { SyncEngine } from './SyncEngine';

let db: BabyRoutineDb;
let engines: SyncEngine[];

beforeEach(() => {
  db = testDatabase();
  engines = [];
});

afterEach(async () => {
  engines.forEach((e) => e.stop());
  vi.useRealTimers();
  await db.delete();
});

function setup(handler?: ApiHandler) {
  const fake = fakeApi(handler);
  const engine = new SyncEngine({
    db,
    api: fake.api,
    locks: null,
    eventTarget: new EventTarget(),
    isOnline: () => true,
    backoff: { baseMs: 1_000, maxMs: 60_000, random: () => 0.5 },
  });
  engines.push(engine);
  return { engine, ...fake };
}

const label = (c: ApiCall) => {
  const match = /\/(events|medications|prescriptions)\/[^/?]+$/.exec(c.path);
  return `${c.method} ${match?.[1]}`;
};
const lastId = (c: ApiCall) => c.path.split('/').pop();

const TERMS = termsOf(asNeeded('med-1', 480));

function echoPrescription(call: ApiCall): PrescriptionDto {
  const [, , id] = /babies\/([^/]+)\/prescriptions\/([^/?]+)/.exec(call.path)!.slice(0, 3);
  const body = call.body as ReturnType<typeof toPrescriptionUpsertRequest>;
  return {
    id,
    babyId: BABY_ID,
    ...body,
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
    clientUpdatedAt: body.updatedAt ?? SERVER_TIME,
    deletedAt: null,
  } as PrescriptionDto;
}

const echo: ApiHandler = (call) => {
  if (call.method === 'PUT' && call.path.includes('/prescriptions/')) return echoPrescription(call);
  return undefined;
};

describe('pushing prescriptions', () => {
  it('pushes the medication, then the prescription, then the event that names it', async () => {
    const med = await createMedication(db, { babyId: BABY_ID, name: 'Colidis' });
    const rx = await createPrescription(db, BABY_ID, { ...TERMS, medicationId: med.id });
    await createEvent(db, {
      babyId: BABY_ID,
      typeId: TYPE_ID,
      payload: { medications: [{ medicationId: med.id, name: 'Colidis', prescriptionId: rx.id }] },
    });
    const { engine, writes } = setup(echo);

    await engine.syncNow();

    expect(writes().map(label)).toEqual(['PUT medications', 'PUT prescriptions', 'PUT events']);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.prescriptions.get(rx.id)).toMatchObject({
      createdBy: null,
      updatedAt: SERVER_TIME,
    });
  });

  it('still pushes the prescription before the event when a later edit of it absorbed its create', async () => {
    const med = await createMedication(db, { babyId: BABY_ID, name: 'Colidis' });
    const rx = await createPrescription(db, BABY_ID, { ...TERMS, medicationId: med.id });
    await createEvent(db, {
      babyId: BABY_ID,
      typeId: TYPE_ID,
      payload: { medications: [{ medicationId: med.id, name: 'Colidis', prescriptionId: rx.id }] },
    });
    // The edit is queued after the event: the create of the prescription is coalesced into it.
    await updatePrescription(db, rx.id, {
      ...TERMS,
      medicationId: med.id,
      minIntervalMinutes: 360,
    });
    const { engine, writes } = setup(echo);

    await engine.syncNow();

    const sent = writes();
    expect(sent.map(label)).toEqual(['PUT medications', 'PUT prescriptions', 'PUT events']);
    expect((sent[1].body as { minIntervalMinutes: number }).minIntervalMinutes).toBe(360);
  });

  it('pushes the medication before its prescription even when the medication was edited later', async () => {
    const med = await createMedication(db, { babyId: BABY_ID, name: 'Colidis' });
    await createPrescription(db, BABY_ID, { ...TERMS, medicationId: med.id });
    await updateMedication(db, med.id, {
      name: 'Colidis Plus',
      defaultDosage: null,
      notes: null,
      isUsual: true,
    });
    const { engine, writes } = setup(echo);

    await engine.syncNow();

    expect(writes().map(label)).toEqual(['PUT medications', 'PUT prescriptions']);
    expect((writes()[0].body as { name: string }).name).toBe('Colidis Plus');
  });

  it('retries an event the server rejected for a missing prescription once that is pushed', async () => {
    const med = await createMedication(db, { babyId: BABY_ID, name: 'Colidis' });
    const event = await createEvent(db, {
      babyId: BABY_ID,
      typeId: TYPE_ID,
      payload: {
        medications: [{ medicationId: med.id, name: 'Colidis', prescriptionId: 'rx-late' }],
      },
    });
    let rejected = false;
    const { engine, writes } = setup((call) => {
      if (call.method === 'PUT' && call.path.includes('/events/') && !rejected) {
        rejected = true;
        // The prescription is queued while the event is on its way (another tab, a late save).
        void enqueueMutation(db, {
          babyId: BABY_ID,
          kind: 'upsert',
          entityType: 'prescription',
          entityId: 'rx-late',
          payload: toPrescriptionUpsertRequest({
            ...asNeeded(med.id, 480),
            id: 'rx-late',
          }),
          createdAt: SERVER_TIME,
        });
        throw new ApiError(400, {
          title: 'status 400',
          code: 'validation_failed',
          field: 'medications[0].prescriptionId',
        });
      }
      return echo(call);
    });

    await engine.syncNow();

    expect(writes().map((c) => `${label(c)} ${lastId(c)}`)).toEqual([
      'PUT medications ' + med.id,
      `PUT events ${event.id}`,
      'PUT prescriptions rx-late',
      `PUT events ${event.id}`,
    ]);
    expect(await db.outbox.count()).toBe(0);
  });

  it('dead-letters a prescription the server rejects without blocking the queue', async () => {
    const med = await createMedication(db, { babyId: BABY_ID, name: 'Colidis' });
    await createPrescription(db, BABY_ID, { ...TERMS, medicationId: med.id });
    await createEvent(db, { babyId: BABY_ID, typeId: TYPE_ID });
    const { engine, writes } = setup((call) => {
      if (call.path.includes('/prescriptions/'))
        throw httpError(422, 'prescription_medication_not_found');
      return undefined;
    });

    await engine.syncNow();

    expect(writes().map(label)).toEqual(['PUT medications', 'PUT prescriptions', 'PUT events']);
    const dead = await db.outbox.where('status').equals('dead').toArray();
    expect(dead.map((m) => m.entityType)).toEqual(['prescription']);
  });

  it('pushes a delete of a prescription', async () => {
    const med = await createMedication(db, { babyId: BABY_ID, name: 'Colidis' });
    const rx = await createPrescription(db, BABY_ID, { ...TERMS, medicationId: med.id });
    const { engine, writes } = setup(echo);
    await engine.syncNow();
    await deletePrescription(db, rx.id);
    await engine.syncNow();

    expect(writes().at(-1)).toMatchObject({
      method: 'DELETE',
      path: `/api/v1/babies/${BABY_ID}/prescriptions/${rx.id}`,
    });
    expect((await db.prescriptions.get(rx.id))?.deletedAt).not.toBeNull();
  });
});

function serverPrescription(over: Partial<PrescriptionDto> = {}): PrescriptionDto {
  return {
    id: 'rx-remote',
    babyId: BABY_ID,
    medicationId: 'med-1',
    status: 'active',
    kind: 'asNeeded',
    dose: { amount: 1, unit: 'drops', perKg: true, roundingStep: 1 },
    minIntervalMinutes: 480,
    startDate: '2026-10-01',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-20T10:00:00.000Z',
    clientUpdatedAt: '2026-10-20T09:59:00.000Z',
    deletedAt: null,
    ...over,
  };
}

describe('pulling prescriptions', () => {
  it('merges the delta (deleted ones too) and continues from the cursor', async () => {
    const first = [
      serverPrescription(),
      serverPrescription({
        id: 'rx-gone',
        deletedAt: '2026-10-20T10:30:00.000Z',
        updatedAt: '2026-10-20T10:30:00.000Z',
      }),
    ];
    const { engine, calls } = setup((call) =>
      /\/prescriptions(\?|$)/.test(call.path) && call.method === 'GET' ? first : undefined,
    );

    await engine.syncNow();

    expect(await db.prescriptions.get('rx-remote')).toMatchObject({
      kind: 'asNeeded',
      dose: { amount: 1, unit: 'drops', perKg: true, roundingStep: 1 },
      minIntervalMinutes: 480,
    });
    expect((await db.prescriptions.get('rx-gone'))?.deletedAt).not.toBeNull();
    expect(await db.syncState.get([BABY_ID, 'prescriptions'])).toMatchObject({
      lastSyncedAt: '2026-10-20T10:30:00.000Z',
    });

    await engine.syncNow();
    const since = new Date(Date.parse('2026-10-20T10:30:00.000Z') - PULL_OVERLAP_MS).toISOString();
    const gets = calls.filter((c) => c.method === 'GET' && c.path.includes('/prescriptions'));
    expect(gets[0].path).toBe(`/api/v1/babies/${BABY_ID}/prescriptions`);
    expect(gets[1].path).toBe(
      `/api/v1/babies/${BABY_ID}/prescriptions?since=${encodeURIComponent(since)}`,
    );
  });

  it('keeps a local prescription that has a queued change, and lets a server delete win', async () => {
    const local = await createPrescription(db, BABY_ID, { ...TERMS, medicationId: 'med-1' });
    await db.prescriptions.put({
      ...asNeeded('med-1', 60),
      id: 'rx-keep',
      babyId: BABY_ID,
      updatedAt: '2026-10-20T11:00:00.000Z',
    });
    await db.prescriptions.put({ ...asNeeded('med-1', 60), id: 'rx-del', babyId: BABY_ID });

    await mergePrescriptionDelta(db, BABY_ID, [
      { ...serverPrescription({ id: local.id }), minIntervalMinutes: 15 },
      serverPrescription({
        id: 'rx-keep',
        clientUpdatedAt: '2026-10-19T00:00:00.000Z',
        updatedAt: '2026-10-19T00:00:00.000Z',
      }),
      serverPrescription({ id: 'rx-del', deletedAt: '2026-10-20T10:30:00.000Z' }),
    ]);

    // Queued local change: untouched. Older server copy: ignored. Server delete: final.
    expect((await db.prescriptions.get(local.id))?.minIntervalMinutes).toBe(480);
    expect((await db.prescriptions.get('rx-keep'))?.minIntervalMinutes).toBe(60);
    expect((await db.prescriptions.get('rx-del'))?.deletedAt).not.toBeNull();
  });

  it('stores the latest weight from the growth measurements for per-kg suggestions', async () => {
    const measurement = (id: string, date: string, weightKg: number | null) => ({
      id,
      babyId: BABY_ID,
      date,
      weightKg,
      heightCm: null,
      headCircumferenceCm: null,
      notes: null,
      createdBy: null,
      createdAt: `${date}T10:00:00.000Z`,
      updatedAt: `${date}T10:00:00.000Z`,
    });
    const { engine } = setup((call) =>
      call.method === 'GET' && call.path.endsWith('/measurements')
        ? [
            measurement('a', '2026-09-01', 4.1),
            measurement('b', '2026-10-10', 4.6),
            measurement('c', '2026-10-15', null),
          ]
        : undefined,
    );

    await engine.syncNow();

    expect(await db.bodyWeights.get(BABY_ID)).toEqual({
      babyId: BABY_ID,
      kg: 4.6,
      date: '2026-10-10',
    });
  });
});

describe('part-of-the-day prescriptions in the sync contract', () => {
  it('stores server parts in day order, drops unknown codes and reads older rows as none', async () => {
    await mergePrescriptionDelta(db, BABY_ID, [
      serverPrescription({
        id: 'rx-parts',
        kind: 'scheduled',
        minIntervalMinutes: null,
        dayParts: ['night', 'dawn', 'morning'],
        dayPartReminders: [
          { part: 'night', time: '22:30' },
          { part: 'dawn', time: '04:00' },
        ],
      }),
      serverPrescription({ id: 'rx-old' }),
    ]);

    expect(await db.prescriptions.get('rx-parts')).toMatchObject({
      dayParts: ['morning', 'night'],
      dayPartReminders: [{ part: 'night', time: '22:30' }],
    });
    expect(await db.prescriptions.get('rx-old')).toMatchObject({
      dayParts: null,
      dayPartReminders: null,
    });
  });

  it('sends the parts and reminders on upsert (null for the other schedules)', () => {
    const request = toPrescriptionUpsertRequest({
      ...asNeeded('med-1', 480),
      kind: 'scheduled',
      minIntervalMinutes: null,
      dayParts: ['morning'],
      dayPartReminders: [{ part: 'morning', time: '08:00' }],
    });
    expect(request).toMatchObject({
      dayParts: ['morning'],
      dayPartReminders: [{ part: 'morning', time: '08:00' }],
    });
    const legacy = toPrescriptionUpsertRequest(asNeeded('med-1', 480));
    expect([legacy.dayParts, legacy.dayPartReminders]).toEqual([null, null]);
  });
});
