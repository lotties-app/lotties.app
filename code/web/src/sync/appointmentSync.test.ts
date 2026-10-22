import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cancelAppointment,
  createAppointment,
  InvalidAppointmentError,
  markAppointmentDone,
  restoreAppointment,
  updateAppointment,
  type AppointmentTerms,
} from '../db/appointmentCommands';
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
import { toAppointmentUpsertRequest, type AppointmentDto } from './contract';
import { mergeAppointmentDelta } from './pull';
import { SyncEngine } from './SyncEngine';

/*
 * Appointments sync like formulas (docs/design/15-appointments.md): created, edited and cancelled
 * offline, pushed as full states in order (a later edit absorbs an earlier one), merged by client
 * edit time on pull, never deleted.
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

const TERMS: AppointmentTerms = {
  title: '  Pediatrician  ',
  type: 'consultation',
  startsAt: '2026-10-25T13:30:00.000Z',
  durationMinutes: 30,
  location: 'Clinic',
  doctorName: ' Dr. Ana ',
  notes: '',
  outcome: null,
  status: 'upcoming',
  reminderOffsetsMinutes: [120, 1440],
};

const clock = (iso: string) => ({ now: () => new Date(iso) });

function echoAppointment(call: ApiCall): AppointmentDto {
  const id = /appointments\/([^/?]+)/.exec(call.path)![1]!;
  const body = call.body as ReturnType<typeof toAppointmentUpsertRequest>;
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
  call.method === 'PUT' && call.path.includes('/appointments/') ? echoAppointment(call) : undefined;

describe('appointment commands', () => {
  it('stores trimmed terms, sorted reminders and queues the full state with the edit time', async () => {
    const created = await createAppointment(db, BABY_ID, TERMS, clock('2026-10-20T10:00:00.000Z'));

    expect(created).toMatchObject({
      title: 'Pediatrician',
      doctorName: 'Dr. Ana',
      notes: null,
      reminderOffsetsMinutes: [1440, 120],
    });
    const [queued] = await db.outbox.toArray();
    expect(queued).toMatchObject({ entityType: 'appointment', entityId: created.id });
    expect(queued?.payload).toEqual({
      title: 'Pediatrician',
      type: 'consultation',
      startsAt: '2026-10-25T13:30:00.000Z',
      durationMinutes: 30,
      location: 'Clinic',
      doctorName: 'Dr. Ana',
      notes: null,
      outcome: null,
      status: 'upcoming',
      reminderOffsetsMinutes: [1440, 120],
      updatedAt: '2026-10-20T10:00:00.000Z',
    });
  });

  it('refuses a missing title, a bad duration and "done" before the start', async () => {
    const before = clock('2026-10-20T10:00:00.000Z');
    const codes = await Promise.all([
      createAppointment(db, BABY_ID, { ...TERMS, title: '  ' }, before).catch((e) => e.code),
      createAppointment(db, BABY_ID, { ...TERMS, durationMinutes: 4 }, before).catch((e) => e.code),
      createAppointment(db, BABY_ID, { ...TERMS, status: 'done' }, before).catch((e) => e.code),
    ]);

    expect(codes).toEqual(['title', 'duration', 'notStarted']);
    expect(await db.outbox.count()).toBe(0);
  });

  it('marks a started visit done with its outcome, cancels and restores', async () => {
    const created = await createAppointment(db, BABY_ID, TERMS, clock('2026-10-20T10:00:00.000Z'));
    await expect(
      markAppointmentDone(db, created.id, 'x', clock('2026-10-25T13:00:00.000Z')),
    ).rejects.toBeInstanceOf(InvalidAppointmentError);

    const done = await markAppointmentDone(
      db,
      created.id,
      ' All good ',
      clock('2026-10-25T14:10:00.000Z'),
    );
    const cancelled = await cancelAppointment(db, created.id, clock('2026-10-25T14:20:00.000Z'));
    const restored = await restoreAppointment(db, created.id, clock('2026-10-25T14:30:00.000Z'));

    expect([done.status, done.outcome]).toEqual(['done', 'All good']);
    expect([cancelled.status, restored.status]).toEqual(['cancelled', 'upcoming']);
    expect(restored.clientUpdatedAt).toBe('2026-10-25T14:30:00.000Z');
  });
});

describe('pushing appointments', () => {
  it('pushes an offline create, edit and cancel as one latest full state', async () => {
    const created = await createAppointment(db, BABY_ID, TERMS, clock('2026-10-20T10:00:00.000Z'));
    await updateAppointment(
      db,
      created.id,
      { ...TERMS, title: 'Pediatrician (2 months)' },
      clock('2026-10-20T10:05:00.000Z'),
    );
    await cancelAppointment(db, created.id, clock('2026-10-20T10:10:00.000Z'));
    const { engine, writes } = setup(echo);

    await engine.syncNow();

    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual([
      `PUT /api/v1/babies/${BABY_ID}/appointments/${created.id}`,
    ]);
    expect(writes()[0]?.body).toMatchObject({
      title: 'Pediatrician (2 months)',
      status: 'cancelled',
      updatedAt: '2026-10-20T10:10:00.000Z',
    });
    expect(await db.outbox.count()).toBe(0);
    expect(await db.appointments.get(created.id)).toMatchObject({
      status: 'cancelled',
      updatedAt: SERVER_TIME,
      createdBy: 'user-1',
    });
  });

  it('replays the same state after a lost connection without losing or doubling it', async () => {
    const created = await createAppointment(db, BABY_ID, TERMS, clock('2026-10-20T10:00:00.000Z'));
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
    expect(await db.appointments.count()).toBe(1);
    expect((await db.appointments.get(created.id))?.title).toBe('Pediatrician');
  });

  it('dead-letters a "done" the server refuses as not started', async () => {
    await createAppointment(db, BABY_ID, TERMS, clock('2026-10-20T10:00:00.000Z'));
    const { engine } = setup((call) => {
      if (call.method === 'PUT') throw httpError(422, 'appointment_not_started');
      return undefined;
    });

    await engine.syncNow();

    expect(await db.outbox.where('status').equals('dead').count()).toBe(1);
  });
});

describe('pulling appointments', () => {
  const dto = (id: string, overrides: Partial<AppointmentDto> = {}): AppointmentDto => ({
    id,
    babyId: BABY_ID,
    title: id,
    type: 'vaccine',
    startsAt: '2026-11-01T12:00:00Z',
    status: 'upcoming',
    reminderOffsetsMinutes: [1440, 120],
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
    clientUpdatedAt: SERVER_TIME,
    ...overrides,
  });

  it('merges the delta, keeps unknown codes safe and moves the cursor', async () => {
    await mergeAppointmentDelta(db, BABY_ID, [
      dto('a', { status: 'cancelled', updatedAt: '2026-10-20T12:00:05.000Z' }),
      dto('b', { type: 'surgery', status: 'archived', reminderOffsetsMinutes: [30, 45] }),
    ]);

    expect(await db.appointments.get('a')).toMatchObject({ status: 'cancelled' });
    expect(await db.appointments.get('b')).toMatchObject({
      type: 'other',
      status: 'upcoming',
      reminderOffsetsMinutes: [30],
      durationMinutes: null,
    });
    expect(await db.syncState.get([BABY_ID, 'appointments'])).toMatchObject({
      lastSyncedAt: '2026-10-20T12:00:05.000Z',
    });
  });

  it('keeps a local change that is still queued and an older server copy loses', async () => {
    const local = await createAppointment(db, BABY_ID, TERMS, clock('2026-10-20T13:00:00.000Z'));

    await mergeAppointmentDelta(db, BABY_ID, [dto(local.id, { title: 'Server title' })]);
    expect((await db.appointments.get(local.id))?.title).toBe('Pediatrician');

    await db.outbox.clear();
    await mergeAppointmentDelta(db, BABY_ID, [
      dto(local.id, { title: 'Older', clientUpdatedAt: '2026-10-20T12:00:00.000Z' }),
    ]);
    expect((await db.appointments.get(local.id))?.title).toBe('Pediatrician');
  });

  it('pulls the appointments of every baby with the cursor and purges them with the baby', async () => {
    const { engine, calls } = setup((call) =>
      call.method === 'GET' && call.path.includes('/appointments') ? [dto('remote')] : undefined,
    );

    await engine.syncNow();

    expect(calls.some((c) => c.path === `/api/v1/babies/${BABY_ID}/appointments`)).toBe(true);
    expect(await db.appointments.get('remote')).toMatchObject({ title: 'remote' });
    await purgeBabyData(db, BABY_ID);
    expect(await db.appointments.count()).toBe(0);
  });
});

describe('a Doctor and the appointments', () => {
  const babiesAs = (role: string) => [{ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role }];
  const remote: AppointmentDto = {
    id: 'remote',
    babyId: BABY_ID,
    title: 'Second opinion',
    type: 'consultation',
    startsAt: '2026-11-01T12:00:00Z',
    status: 'upcoming',
    reminderOffsetsMinutes: [1440, 120],
    createdAt: SERVER_TIME,
    updatedAt: SERVER_TIME,
    clientUpdatedAt: SERVER_TIME,
  };

  function server(role: { current: string }) {
    return setup((call) => {
      if (call.path === '/api/v1/babies') return babiesAs(role.current);
      if (call.method === 'GET' && call.path.includes('/appointments')) return [remote];
      return undefined;
    });
  }

  it('never asks for them and purges the copies kept from a family role, cursor included', async () => {
    const role = { current: 'Parent' };
    const { engine, calls } = server(role);
    await engine.syncNow();
    expect(await db.appointments.get('remote')).toMatchObject({ title: 'Second opinion' });
    expect(await db.syncState.get([BABY_ID, 'appointments'])).toBeTruthy();

    role.current = 'Doctor';
    calls.length = 0;
    await engine.syncNow();

    expect(calls.some((c) => c.path.includes('/appointments'))).toBe(false);
    expect(await db.appointments.count()).toBe(0);
    expect(await db.syncState.get([BABY_ID, 'appointments'])).toBeUndefined();
    expect((await db.babies.get(BABY_ID))?.role).toBe('Doctor');
  });

  it('pulls them all again from scratch when the role goes back to a family role', async () => {
    const role = { current: 'Doctor' };
    const { engine, calls } = server(role);
    await engine.syncNow();
    expect(calls.some((c) => c.path.includes('/appointments'))).toBe(false);

    role.current = 'Viewer';
    await engine.syncNow();

    expect(calls.some((c) => c.path === `/api/v1/babies/${BABY_ID}/appointments`)).toBe(true);
    expect(await db.appointments.get('remote')).toMatchObject({ title: 'Second opinion' });
  });
});
