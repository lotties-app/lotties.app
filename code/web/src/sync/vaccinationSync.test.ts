import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { purgeBabyData } from '../db/purge';
import {
  InvalidVaccinationError,
  createVaccination,
  deleteVaccination,
  updateVaccination,
  type VaccinationTerms,
} from '../db/vaccinationCommands';
import {
  BABY_ID,
  SERVER_TIME,
  fakeApi,
  httpError,
  networkError,
  testDatabase,
  type ApiCall,
  type ApiHandler,
} from '../test/fakeApi';
import { fromBabyDto, toVaccinationUpsertRequest, type VaccinationDto } from './contract';
import { mergeVaccinationDelta } from './pull';
import { SyncEngine } from './SyncEngine';

/*
 * Vaccinations sync like prescriptions (docs/design/18-vaccines.md): recorded, edited and deleted
 * offline, pushed as full states in order (a later edit absorbs an earlier one), merged by client
 * edit time on pull, a server delete is final.
 */

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

const TERMS: VaccinationTerms = {
  vaccineKey: 'penta',
  doseId: 'penta-1',
  customName: null,
  doseLabel: '  1st dose  ',
  givenOn: '2026-10-20',
  network: 'public',
  clinic: ' UBS Centro ',
  lot: '',
  administeredBy: null,
  notes: null,
};

const clock = (iso: string) => ({ now: () => new Date(iso) });
const NOW = '2026-10-21T10:00:00.000Z';

function echoVaccination(call: ApiCall): VaccinationDto {
  const id = /vaccinations\/([^/?]+)/.exec(call.path)![1]!;
  const body = call.body as ReturnType<typeof toVaccinationUpsertRequest>;
  return {
    id,
    babyId: BABY_ID,
    ...body,
    createdBy: 'user-1',
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
    clientUpdatedAt: body.updatedAt ?? SERVER_TIME,
    deletedAt: null,
  };
}

const echo: ApiHandler = (call) =>
  call.method === 'PUT' && call.path.includes('/vaccinations/') ? echoVaccination(call) : undefined;

describe('vaccination commands', () => {
  it('stores trimmed terms and queues the full state with the edit time', async () => {
    const created = await createVaccination(db, BABY_ID, TERMS, clock(NOW));

    expect(created).toMatchObject({
      vaccineKey: 'penta',
      doseId: 'penta-1',
      doseLabel: '1st dose',
      clinic: 'UBS Centro',
      lot: null,
      deletedAt: null,
      createdBy: null,
    });
    const [queued] = await db.outbox.toArray();
    expect(queued).toMatchObject({
      entityType: 'vaccination',
      entityId: created.id,
      kind: 'upsert',
    });
    expect(queued?.payload).toEqual({
      vaccineKey: 'penta',
      doseId: 'penta-1',
      customName: null,
      doseLabel: '1st dose',
      givenOn: '2026-10-20',
      network: 'public',
      clinic: 'UBS Centro',
      lot: null,
      administeredBy: null,
      notes: null,
      updatedAt: NOW,
    });
  });

  it('records a vaccine that is not in the schedule by its name', async () => {
    const created = await createVaccination(
      db,
      BABY_ID,
      { ...TERMS, vaccineKey: null, doseId: null, customName: '  Travel vaccine ' },
      clock(NOW),
    );

    expect(created).toMatchObject({ vaccineKey: null, doseId: null, customName: 'Travel vaccine' });
  });

  it('refuses what the server would: names, keys, dates and where it was given', async () => {
    const before = clock(NOW);
    const code = (terms: Partial<VaccinationTerms>) =>
      createVaccination(db, BABY_ID, { ...TERMS, ...terms }, before).then(
        () => 'saved',
        (e: InvalidVaccinationError) => e.code,
      );

    expect(await code({ vaccineKey: null, doseId: null, customName: '  ' })).toBe('customName');
    expect(await code({ customName: 'Both' })).toBe('customName');
    expect(await code({ vaccineKey: 'Penta' })).toBe('vaccineKey');
    expect(await code({ vaccineKey: 'a'.repeat(41), doseId: null })).toBe('vaccineKey');
    expect(await code({ doseId: 'Penta 1' })).toBe('doseId');
    expect(await code({ vaccineKey: null, customName: 'X', doseId: 'penta-1' })).toBe('doseId');
    expect(await code({ givenOn: '2026-10-22' })).toBe('givenOn');
    expect(await code({ givenOn: '1999-12-31' })).toBe('givenOn');
    expect(await code({ givenOn: '2026-02-30' })).toBe('givenOn');
    expect(await code({ network: 'other' as 'public' })).toBe('network');
    expect(await code({ givenOn: '2026-10-21' })).toBe('saved');
    expect(await db.outbox.count()).toBe(1);
  });

  it('cuts text at its limits and drops NUL characters', async () => {
    const created = await createVaccination(
      db,
      BABY_ID,
      {
        ...TERMS,
        doseLabel: 'd'.repeat(120),
        clinic: 'c'.repeat(200),
        lot: 'l\u0000ot',
        administeredBy: 'a'.repeat(100),
        notes: 'n'.repeat(1200),
      },
      clock(NOW),
    );

    expect(created.doseLabel).toHaveLength(80);
    expect(created.clinic).toHaveLength(120);
    expect(created.lot).toBe('lot');
    expect(created.administeredBy).toHaveLength(80);
    expect(created.notes).toHaveLength(1000);
  });

  it('edits a record and refuses to edit one that is gone', async () => {
    const created = await createVaccination(db, BABY_ID, TERMS, clock(NOW));
    const edited = await updateVaccination(
      db,
      created.id,
      { ...TERMS, lot: 'AB123' },
      clock('2026-10-21T11:00:00.000Z'),
    );

    expect(edited).toMatchObject({ lot: 'AB123', clientUpdatedAt: '2026-10-21T11:00:00.000Z' });
    await deleteVaccination(db, created.id, clock('2026-10-21T12:00:00.000Z'));
    await expect(updateVaccination(db, created.id, TERMS, clock(NOW))).rejects.toMatchObject({
      code: 'gone',
    });
    await expect(updateVaccination(db, 'unknown', TERMS, clock(NOW))).rejects.toMatchObject({
      code: 'gone',
    });
  });

  it('soft deletes, queues the delete and hands back the terms for an Undo', async () => {
    const created = await createVaccination(db, BABY_ID, TERMS, clock(NOW));

    const terms = await deleteVaccination(db, created.id, clock('2026-10-21T12:00:00.000Z'));
    const again = await deleteVaccination(db, created.id);

    expect(terms).toMatchObject({ vaccineKey: 'penta', doseId: 'penta-1', givenOn: '2026-10-20' });
    expect(again).toBeUndefined();
    expect(await db.vaccinations.get(created.id)).toMatchObject({
      deletedAt: '2026-10-21T12:00:00.000Z',
    });
    expect((await db.outbox.toArray()).map((m) => m.kind)).toEqual(['upsert', 'delete']);
  });
});

describe('pushing vaccinations', () => {
  it('pushes an offline record and its edits as one latest full state', async () => {
    const created = await createVaccination(db, BABY_ID, TERMS, clock(NOW));
    await updateVaccination(
      db,
      created.id,
      { ...TERMS, lot: 'AB123' },
      clock('2026-10-21T10:05:00.000Z'),
    );
    await updateVaccination(
      db,
      created.id,
      { ...TERMS, lot: 'ZZ9' },
      clock('2026-10-21T10:10:00.000Z'),
    );
    const { engine, writes } = setup(echo);

    await engine.syncNow();

    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual([
      `PUT /api/v1/babies/${BABY_ID}/vaccinations/${created.id}`,
    ]);
    expect(writes()[0]?.body).toMatchObject({ lot: 'ZZ9', updatedAt: '2026-10-21T10:10:00.000Z' });
    expect(await db.outbox.count()).toBe(0);
    expect(await db.vaccinations.get(created.id)).toMatchObject({
      lot: 'ZZ9',
      updatedAt: SERVER_TIME,
      createdBy: 'user-1',
    });
  });

  it('sends only the delete for a record created and deleted before the first sync', async () => {
    const created = await createVaccination(db, BABY_ID, TERMS, clock(NOW));
    await deleteVaccination(db, created.id, clock('2026-10-21T10:30:00.000Z'));
    const { engine, writes } = setup(echo);

    await engine.syncNow();

    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual([
      `DELETE /api/v1/babies/${BABY_ID}/vaccinations/${created.id}`,
    ]);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.vaccinations.get(created.id)).toMatchObject({ deletedAt: expect.any(String) });
  });

  it('deletes on the server a record it already has', async () => {
    const created = await createVaccination(db, BABY_ID, TERMS, clock(NOW));
    const { engine, writes } = setup(echo);
    await engine.syncNow();

    await deleteVaccination(db, created.id, clock('2026-10-21T12:00:00.000Z'));
    await engine.syncNow();

    expect(writes().map((c) => c.method)).toEqual(['PUT', 'DELETE']);
    expect(await db.outbox.count()).toBe(0);
  });

  it('replays the same state after a lost connection without losing or doubling it', async () => {
    const created = await createVaccination(db, BABY_ID, TERMS, clock(NOW));
    let calls = 0;
    const { engine, writes } = setup((call) => {
      calls += 1;
      if (calls === 1) throw networkError();
      return echo(call);
    });

    await engine.syncNow();
    await engine.syncNow();

    const sent = writes();
    expect(sent).toHaveLength(2);
    expect(sent[0]?.body).toEqual(sent[1]?.body);
    expect(await db.outbox.count()).toBe(0);
    expect(await db.vaccinations.count()).toBe(1);
    expect((await db.vaccinations.get(created.id))?.clinic).toBe('UBS Centro');
  });

  it('adopts the stored deleted copy when the server says the record was deleted', async () => {
    const created = await createVaccination(db, BABY_ID, TERMS, clock(NOW));
    const { engine } = setup((call) =>
      call.method === 'PUT'
        ? { ...echoVaccination(call), deletedAt: SERVER_TIME, clientUpdatedAt: SERVER_TIME }
        : undefined,
    );

    await engine.syncNow();

    expect(await db.vaccinations.get(created.id)).toMatchObject({ deletedAt: expect.any(String) });
    expect(await db.outbox.count()).toBe(0);
  });

  it('dead-letters a record of another baby and drops the local copy the server never had', async () => {
    const created = await createVaccination(db, BABY_ID, TERMS, clock(NOW));
    const { engine } = setup((call) => {
      if (call.method === 'PUT') throw httpError(409, 'vaccination_baby_mismatch');
      return undefined;
    });

    await engine.syncNow();

    expect(await db.outbox.where('status').equals('dead').count()).toBe(1);
    expect(await db.vaccinations.get(created.id)).toBeUndefined();
  });
});

describe('pulling vaccinations', () => {
  const dto = (id: string, overrides: Partial<VaccinationDto> = {}): VaccinationDto => ({
    id,
    babyId: BABY_ID,
    vaccineKey: 'bcg',
    doseId: 'bcg-1',
    givenOn: '2026-08-02',
    network: 'public',
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
    clientUpdatedAt: SERVER_TIME,
    ...overrides,
  });

  it('merges the delta, deleted ones included, and moves the cursor', async () => {
    await mergeVaccinationDelta(db, BABY_ID, [
      dto('a', { updatedAt: '2026-10-20T12:00:05.000Z' }),
      dto('b', { deletedAt: '2026-10-20T12:00:01.000Z', network: 'elsewhere' }),
    ]);

    expect(await db.vaccinations.get('a')).toMatchObject({
      vaccineKey: 'bcg',
      customName: null,
      doseLabel: null,
      clinic: null,
      deletedAt: null,
    });
    expect(await db.vaccinations.get('b')).toMatchObject({
      network: 'public',
      deletedAt: '2026-10-20T12:00:01.000Z',
    });
    expect(await db.syncState.get([BABY_ID, 'vaccinations'])).toMatchObject({
      lastSyncedAt: '2026-10-20T12:00:05.000Z',
    });
  });

  it('keeps a local change that is still queued, and an older server copy loses', async () => {
    const local = await createVaccination(db, BABY_ID, TERMS, clock('2026-10-21T13:00:00.000Z'));

    await mergeVaccinationDelta(db, BABY_ID, [dto(local.id, { clinic: 'Server clinic' })]);
    expect((await db.vaccinations.get(local.id))?.clinic).toBe('UBS Centro');

    await db.outbox.clear();
    await mergeVaccinationDelta(db, BABY_ID, [
      dto(local.id, { clinic: 'Older', clientUpdatedAt: '2026-10-21T12:00:00.000Z' }),
    ]);
    expect((await db.vaccinations.get(local.id))?.clinic).toBe('UBS Centro');
  });

  it('lets a newer server copy and a server delete win', async () => {
    const local = await createVaccination(db, BABY_ID, TERMS, clock('2026-10-21T13:00:00.000Z'));
    await db.outbox.clear();

    await mergeVaccinationDelta(db, BABY_ID, [
      dto(local.id, { clinic: 'Newer', clientUpdatedAt: '2026-10-21T14:00:00.000Z' }),
    ]);
    expect((await db.vaccinations.get(local.id))?.clinic).toBe('Newer');

    await mergeVaccinationDelta(db, BABY_ID, [
      dto(local.id, {
        clientUpdatedAt: '2026-10-21T08:00:00.000Z',
        deletedAt: '2026-10-21T15:00:00.000Z',
      }),
    ]);
    expect(await db.vaccinations.get(local.id)).toMatchObject({
      deletedAt: '2026-10-21T15:00:00.000Z',
    });
  });

  it('pulls the vaccinations of every baby with the cursor and purges them with the baby', async () => {
    const { engine, calls } = setup((call) =>
      call.method === 'GET' && call.path.includes('/vaccinations') ? [dto('remote')] : undefined,
    );

    await engine.syncNow();
    await engine.syncNow();

    const paths = calls.filter((c) => c.path.includes('/vaccinations')).map((c) => c.path);
    expect(paths[0]).toBe(`/api/v1/babies/${BABY_ID}/vaccinations`);
    expect(paths.at(-1)).toMatch(new RegExp(`/vaccinations\\?since=2026-10-20T11%3A59%3A55`));
    expect(await db.vaccinations.get('remote')).toMatchObject({ vaccineKey: 'bcg' });

    await purgeBabyData(db, BABY_ID);
    expect(await db.vaccinations.count()).toBe(0);
    expect(await db.syncState.where('babyId').equals(BABY_ID).count()).toBe(0);
  });
});

describe('a server without vaccinations', () => {
  it('does not hold back the events of the same run', async () => {
    const { engine } = setup((call) => {
      if (call.path.includes('/vaccinations')) throw httpError(404);
      if (call.path.includes('/events')) {
        return [
          {
            id: 'evt-1',
            babyId: BABY_ID,
            typeId: 'type-feeding',
            startedAt: '2026-10-20T08:00:00.000Z',
            endedAt: null,
            payload: {},
            notes: null,
            createdBy: 'u1',
            createdAt: SERVER_TIME,
            updatedAt: SERVER_TIME,
            deletedAt: null,
          },
        ];
      }
      return undefined;
    });

    await engine.syncNow();

    expect(await db.events.get('evt-1')).toBeDefined();
    expect(await db.vaccinations.count()).toBe(0);
  });
});

describe('the baby profile on the wire', () => {
  it('reads the vaccine profile fields the server sends and leaves older servers alone', () => {
    const base = { id: 'b', name: 'Lia', birthDate: '2026-08-01', role: 'Owner' };

    expect(fromBabyDto(base)).toEqual({ ...base });
    expect(
      fromBabyDto({
        ...base,
        vaccineProfile: 'public+private',
        gestationalAgeWeeks: 34,
        rsvMaternalVaccination: 'no',
      }),
    ).toMatchObject({
      vaccineProfile: 'public+private',
      gestationalAgeWeeks: 34,
      rsvMaternalVaccination: 'no',
    });
    expect(
      fromBabyDto({
        ...base,
        vaccineProfile: 'public',
        gestationalAgeWeeks: null,
        rsvMaternalVaccination: null,
      }),
    ).toMatchObject({
      vaccineProfile: 'public',
      gestationalAgeWeeks: null,
      rsvMaternalVaccination: null,
    });
    expect(fromBabyDto({ ...base, vaccineProfile: 'something-new' })).not.toHaveProperty(
      'vaccineProfile',
    );
  });

  it('keeps no vaccine profile for a doctor the vaccines section is not shared with', () => {
    const baby = fromBabyDto({
      id: 'b',
      name: 'Lia',
      birthDate: '2026-08-01',
      role: 'Doctor',
      doctorScopes: ['daily_log'],
      vaccineProfile: null,
      gestationalAgeWeeks: null,
      rsvMaternalVaccination: null,
    });

    expect(baby).not.toHaveProperty('vaccineProfile');
    expect(baby.gestationalAgeWeeks ?? null).toBeNull();
    expect(baby.rsvMaternalVaccination ?? null).toBeNull();
    expect(baby.doctorScopes).toEqual(['daily_log']);
  });
});
