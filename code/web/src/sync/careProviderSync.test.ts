import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppointment, updateAppointment } from '../db/appointmentCommands';
import {
  createCareProvider,
  deleteCareProvider,
  InvalidCareProviderError,
  restoreCareProvider,
  setCareProviderFavorite,
  updateCareProvider,
  type CareProviderTerms,
} from '../db/careProviderCommands';
import type { BabyRoutineDb } from '../db/database';
import { purgeBabyData } from '../db/purge';
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
import { mergeCareProviderDelta } from './careProviderSync';
import { toCareProviderUpsertRequest, type CareProviderDto } from './contract';
import { SyncEngine } from './SyncEngine';

/*
 * The care provider directory syncs like formulas (docs/design/22-care-providers.md): created,
 * edited and deleted offline, pushed as full states in order (a later edit absorbs an earlier one),
 * merged by client edit time on pull, soft deleted, never fetched by a Doctor.
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

const TERMS: CareProviderTerms = {
  name: '  Dr. Ana Lima  ',
  specialty: 'pediatrician',
  registrationCouncil: ' CRM ',
  registrationNumber: '123456',
  registrationRegion: 'SP',
  clinicName: 'Clinic Central',
  address: 'Rua das Flores, 10\nSao Paulo',
  phone: '+55 11 5555-0000',
  whatsapp: '',
  email: null,
  website: 'clinic.example',
  notes: '   ',
  favorite: false,
  deleted: false,
};

const clock = (iso: string) => ({ now: () => new Date(iso) });

function echoProvider(call: ApiCall): CareProviderDto {
  const id = /care-providers\/([^/?]+)/.exec(call.path)![1]!;
  const body = call.body as ReturnType<typeof toCareProviderUpsertRequest>;
  return {
    id,
    babyId: BABY_ID,
    ...body,
    createdBy: 'user-1',
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
    clientUpdatedAt: body.updatedAt ?? SERVER_TIME,
  };
}

const echo: ApiHandler = (call) =>
  call.method === 'PUT' && call.path.includes('/care-providers/') ? echoProvider(call) : undefined;

describe('care provider commands', () => {
  it('stores trimmed terms and queues the full state with the edit time', async () => {
    const created = await createCareProvider(db, BABY_ID, TERMS, clock('2026-10-20T10:00:00.000Z'));

    expect(created).toMatchObject({
      name: 'Dr. Ana Lima',
      registrationCouncil: 'CRM',
      whatsapp: null,
      notes: null,
      favorite: false,
      deleted: false,
    });
    const [queued] = await db.outbox.toArray();
    expect(queued).toMatchObject({ entityType: 'careProvider', entityId: created.id });
    expect(queued?.payload).toEqual({
      name: 'Dr. Ana Lima',
      specialty: 'pediatrician',
      registrationCouncil: 'CRM',
      registrationNumber: '123456',
      registrationRegion: 'SP',
      clinicName: 'Clinic Central',
      address: 'Rua das Flores, 10\nSao Paulo',
      phone: '+55 11 5555-0000',
      whatsapp: null,
      email: null,
      website: 'clinic.example',
      notes: null,
      isFavorite: false,
      isDeleted: false,
      updatedAt: '2026-10-20T10:00:00.000Z',
    });
  });

  it('refuses a missing name and drops a website with another scheme instead of sending it', async () => {
    await expect(
      createCareProvider(db, BABY_ID, { ...TERMS, name: '  ' }).catch((e) => e),
    ).resolves.toBeInstanceOf(InvalidCareProviderError);
    expect(await db.outbox.count()).toBe(0);

    const created = await createCareProvider(db, BABY_ID, { ...TERMS, website: 'javascript:x' });

    expect(created.website).toBeNull();
  });

  it('favorites, deletes and restores, each a full state; a deleted one is no favorite', async () => {
    const created = await createCareProvider(db, BABY_ID, TERMS, clock('2026-10-20T10:00:00.000Z'));
    const starred = await setCareProviderFavorite(
      db,
      created.id,
      true,
      clock('2026-10-20T10:01:00.000Z'),
    );
    const deleted = await deleteCareProvider(db, created.id, clock('2026-10-20T10:02:00.000Z'));
    const restored = await restoreCareProvider(db, created.id, clock('2026-10-20T10:03:00.000Z'));

    expect([starred.favorite, deleted.deleted, deleted.favorite]).toEqual([true, true, false]);
    expect([restored.deleted, restored.favorite]).toEqual([false, false]);
    expect(restored.clientUpdatedAt).toBe('2026-10-20T10:03:00.000Z');
  });

  it('says so when the provider is not on the device', async () => {
    await expect(updateCareProvider(db, 'nope', TERMS)).rejects.toMatchObject({ code: 'gone' });
  });
});

describe('pushing care providers', () => {
  it('pushes an offline create, edit and delete as one latest full state', async () => {
    const created = await createCareProvider(db, BABY_ID, TERMS, clock('2026-10-20T10:00:00.000Z'));
    await updateCareProvider(
      db,
      created.id,
      { ...TERMS, name: 'Dr. Ana Lima Souza' },
      clock('2026-10-20T10:05:00.000Z'),
    );
    await deleteCareProvider(db, created.id, clock('2026-10-20T10:10:00.000Z'));
    const { engine, writes } = setup(echo);

    await engine.syncNow();

    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual([
      `PUT /api/v1/babies/${BABY_ID}/care-providers/${created.id}`,
    ]);
    expect(writes()[0]?.body).toMatchObject({
      name: 'Dr. Ana Lima Souza',
      isDeleted: true,
      updatedAt: '2026-10-20T10:10:00.000Z',
    });
    expect(await db.outbox.count()).toBe(0);
    expect(await db.careProviders.get(created.id)).toMatchObject({
      deleted: true,
      updatedAt: SERVER_TIME,
      createdBy: 'user-1',
    });
  });

  it('replays the same state after a lost connection without doubling it', async () => {
    await createCareProvider(db, BABY_ID, TERMS, clock('2026-10-20T10:00:00.000Z'));
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
    expect(await db.careProviders.count()).toBe(1);
  });

  it('pushes an appointment that links a provider created in the same offline session', async () => {
    const provider = await createCareProvider(
      db,
      BABY_ID,
      TERMS,
      clock('2026-10-20T10:00:00.000Z'),
    );
    const appointment = await createAppointment(
      db,
      BABY_ID,
      {
        title: 'Checkup',
        type: 'consultation',
        startsAt: '2026-10-25T13:30:00.000Z',
        durationMinutes: null,
        location: 'Clinic Central',
        doctorName: 'Dr. Ana Lima',
        notes: null,
        outcome: null,
        status: 'upcoming',
        reminderOffsetsMinutes: [1440],
        providerId: provider.id,
      },
      clock('2026-10-20T10:01:00.000Z'),
    );
    const { engine, writes } = setup((call) =>
      call.path.includes('/appointments/') ? call.body : echo(call),
    );

    await engine.syncNow();

    expect(writes().map((c) => c.path)).toEqual([
      `/api/v1/babies/${BABY_ID}/care-providers/${provider.id}`,
      `/api/v1/babies/${BABY_ID}/appointments/${appointment.id}`,
    ]);
    expect(writes()[1]?.body).toMatchObject({ providerId: provider.id });
  });

  it('keeps editing the appointment without touching the provider it links', async () => {
    const provider = await createCareProvider(
      db,
      BABY_ID,
      TERMS,
      clock('2026-10-20T10:00:00.000Z'),
    );
    const appointment = await createAppointment(
      db,
      BABY_ID,
      {
        title: 'Checkup',
        type: 'consultation',
        startsAt: '2026-10-25T13:30:00.000Z',
        durationMinutes: null,
        location: 'Clinic Central',
        doctorName: 'Dr. Ana Lima',
        notes: null,
        outcome: null,
        status: 'upcoming',
        reminderOffsetsMinutes: [1440],
        providerId: provider.id,
      },
      clock('2026-10-20T10:01:00.000Z'),
    );

    await updateAppointment(
      db,
      appointment.id,
      { ...appointment, doctorName: 'Dr. Ana (substituting)', location: 'Annex' },
      clock('2026-10-20T10:02:00.000Z'),
    );

    expect(await db.careProviders.get(provider.id)).toMatchObject({ name: 'Dr. Ana Lima' });
    expect(await db.appointments.get(appointment.id)).toMatchObject({
      providerId: provider.id,
      doctorName: 'Dr. Ana (substituting)',
    });
  });

  it('dead-letters a provider the server refuses as invalid', async () => {
    await createCareProvider(db, BABY_ID, TERMS, clock('2026-10-20T10:00:00.000Z'));
    const { engine } = setup((call) => {
      if (call.method === 'PUT') throw httpError(400, 'validation_failed');
      return undefined;
    });

    await engine.syncNow();

    expect((await db.outbox.toArray())[0]).toMatchObject({ status: 'dead' });
  });
});

describe('pulling care providers', () => {
  const dto = (id: string, overrides: Partial<CareProviderDto> = {}): CareProviderDto => ({
    id,
    babyId: BABY_ID,
    name: id,
    isFavorite: true,
    isDeleted: false,
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
    clientUpdatedAt: SERVER_TIME,
    ...overrides,
  });

  it('merges the delta, maps the flags and moves the cursor', async () => {
    await mergeCareProviderDelta(db, BABY_ID, [
      dto('a', { isDeleted: true, updatedAt: '2026-10-20T12:00:05.000Z' }),
      dto('b', { specialty: 'ent', address: 'x\ny' }),
    ]);

    expect(await db.careProviders.get('a')).toMatchObject({ deleted: true, favorite: true });
    expect(await db.careProviders.get('b')).toMatchObject({
      specialty: 'ent',
      address: 'x\ny',
      phone: null,
    });
    expect(await db.syncState.get([BABY_ID, 'careProviders'])).toMatchObject({
      lastSyncedAt: '2026-10-20T12:00:05.000Z',
    });
  });

  it('keeps a local change that is still queued and an older server copy loses', async () => {
    const local = await createCareProvider(db, BABY_ID, TERMS, clock('2026-10-20T13:00:00.000Z'));

    await mergeCareProviderDelta(db, BABY_ID, [dto(local.id, { name: 'Server name' })]);
    expect((await db.careProviders.get(local.id))?.name).toBe('Dr. Ana Lima');

    await db.outbox.clear();
    await mergeCareProviderDelta(db, BABY_ID, [
      dto(local.id, { name: 'Older', clientUpdatedAt: '2026-10-20T12:00:00.000Z' }),
    ]);
    expect((await db.careProviders.get(local.id))?.name).toBe('Dr. Ana Lima');
  });

  it('pulls the directory of every baby with the cursor and purges it with the baby', async () => {
    const { engine, calls } = setup((call) =>
      call.method === 'GET' && call.path.includes('/care-providers') ? [dto('remote')] : undefined,
    );

    await engine.syncNow();

    expect(calls.some((c) => c.path === `/api/v1/babies/${BABY_ID}/care-providers`)).toBe(true);
    expect(await db.careProviders.get('remote')).toMatchObject({ name: 'remote' });
    await purgeBabyData(db, BABY_ID);
    expect(await db.careProviders.count()).toBe(0);
  });
});

describe('a Doctor and the directory', () => {
  const babiesAs = (role: string) => [{ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role }];
  const remote: CareProviderDto = {
    id: 'remote',
    babyId: BABY_ID,
    name: 'Second opinion',
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
    clientUpdatedAt: SERVER_TIME,
  };

  function server(role: { current: string }) {
    return setup((call) => {
      if (call.path === '/api/v1/babies') return babiesAs(role.current);
      if (call.method === 'GET' && call.path.includes('/care-providers')) return [remote];
      return undefined;
    });
  }

  it('never asks for it and purges the copies kept from a family role, cursor included', async () => {
    const role = { current: 'Parent' };
    const { engine, calls } = server(role);
    await engine.syncNow();
    expect(await db.careProviders.get('remote')).toMatchObject({ name: 'Second opinion' });

    role.current = 'Doctor';
    calls.length = 0;
    await engine.syncNow();

    expect(calls.some((c) => c.path.includes('/care-providers'))).toBe(false);
    expect(await db.careProviders.count()).toBe(0);
    expect(await db.syncState.get([BABY_ID, 'careProviders'])).toBeUndefined();
  });

  it('pulls it all again when the role goes back to a family role', async () => {
    const role = { current: 'Doctor' };
    const { engine, calls } = server(role);
    await engine.syncNow();
    expect(calls.some((c) => c.path.includes('/care-providers'))).toBe(false);

    role.current = 'Caregiver';
    await engine.syncNow();

    expect(await db.careProviders.get('remote')).toMatchObject({ name: 'Second opinion' });
  });
});
