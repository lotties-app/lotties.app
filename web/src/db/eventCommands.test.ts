import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from './database';
import { SCHEMA_VERSIONS } from './database';
import { createEvent, deleteEvent, editEvent, stopEvent } from './eventCommands';
import {
  EventAlreadyStoppedError,
  EventDeletedError,
  EventNotFoundError,
  InvalidEventTimeRangeError,
} from './errors';
import { BABY_ID, TYPE_ID, testDatabase } from '../test/fakeApi';

const T0 = new Date('2026-10-20T08:00:00.000Z');
const T1 = new Date('2026-10-20T08:30:00.000Z');

let db: BabyRoutineDb;

beforeEach(() => {
  db = testDatabase();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await db.delete();
});

function at(date: Date) {
  return { now: () => date };
}

describe('schema', () => {
  it('opens at the latest version with every table', async () => {
    await db.open();
    expect(db.verno).toBe(SCHEMA_VERSIONS.at(-1)!.version);
    expect(db.tables.map((t) => t.name).sort()).toEqual(
      ['babies', 'eventTypes', 'events', 'medications', 'outbox', 'syncState'].sort(),
    );
    const eventIndexes = db.events.schema.indexes.map((i) => i.name);
    expect(eventIndexes).toEqual(
      expect.arrayContaining(['[babyId+startedAt]', '[babyId+updatedAt]', 'deletedAt']),
    );
  });
});

describe('event commands', () => {
  it('creates an event with a client GUID and UTC timestamps and queues an upsert', async () => {
    const event = await createEvent(
      db,
      { babyId: BABY_ID, typeId: TYPE_ID, startedAt: '2026-10-20T05:00:00-03:00' },
      at(T0),
    );

    expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(event.startedAt).toBe('2026-10-20T08:00:00.000Z');
    expect(event).toMatchObject({ endedAt: null, updatedAt: T0.toISOString(), deletedAt: null });
    expect(await db.events.get(event.id)).toEqual(event);

    const [mutation] = await db.outbox.toArray();
    expect(mutation).toMatchObject({
      babyId: BABY_ID,
      kind: 'upsert',
      entityType: 'event',
      entityId: event.id,
      attempts: 0,
      lastError: null,
      status: 'pending',
      payload: {
        typeId: TYPE_ID,
        startedAt: event.startedAt,
        endedAt: null,
        payload: {},
        notes: null,
        updatedAt: T0.toISOString(),
      },
    });
  });

  it('writes nothing when queueing the mutation fails (atomic)', async () => {
    vi.spyOn(db.outbox, 'add').mockRejectedValueOnce(new Error('quota'));

    await expect(createEvent(db, { babyId: BABY_ID, typeId: TYPE_ID })).rejects.toThrow('quota');

    expect(await db.events.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

  it('rolls back an edit when queueing fails', async () => {
    const event = await createEvent(db, { babyId: BABY_ID, typeId: TYPE_ID }, at(T0));
    vi.spyOn(db.outbox, 'add').mockRejectedValueOnce(new Error('boom'));

    await expect(editEvent(db, event.id, { notes: 'x' })).rejects.toThrow('boom');

    expect((await db.events.get(event.id))?.notes).toBeNull();
    expect(await db.outbox.count()).toBe(1);
  });

  it('stops a running event and queues a second upsert in order', async () => {
    const event = await createEvent(db, { babyId: BABY_ID, typeId: TYPE_ID }, at(T0));
    const stopped = await stopEvent(db, event.id, undefined, at(T1));

    expect(stopped.endedAt).toBe(T1.toISOString());
    expect(stopped.updatedAt).toBe(T1.toISOString());
    const mutations = await db.outbox.orderBy('id').toArray();
    expect(mutations.map((m) => m.kind)).toEqual(['upsert', 'upsert']);
    expect((mutations[1].payload as { endedAt: string }).endedAt).toBe(T1.toISOString());

    await expect(stopEvent(db, event.id)).rejects.toBeInstanceOf(EventAlreadyStoppedError);
  });

  it('edits fields and validates the time range', async () => {
    const event = await createEvent(
      db,
      { babyId: BABY_ID, typeId: TYPE_ID, startedAt: T0.toISOString() },
      at(T0),
    );
    const edited = await editEvent(db, event.id, { notes: 'left side', payload: { side: 'L' } });
    expect(edited).toMatchObject({ notes: 'left side', payload: { side: 'L' } });

    await expect(
      editEvent(db, event.id, { endedAt: '2026-10-20T07:00:00.000Z' }),
    ).rejects.toBeInstanceOf(InvalidEventTimeRangeError);
    await expect(editEvent(db, 'missing', {})).rejects.toBeInstanceOf(EventNotFoundError);
  });

  it('soft-deletes, queues a delete and refuses further edits', async () => {
    const event = await createEvent(db, { babyId: BABY_ID, typeId: TYPE_ID }, at(T0));
    const deleted = await deleteEvent(db, event.id, at(T1));

    expect(deleted.deletedAt).toBe(T1.toISOString());
    expect(await db.events.get(event.id)).toMatchObject({ deletedAt: T1.toISOString() });
    const mutations = await db.outbox.orderBy('id').toArray();
    expect(mutations.map((m) => [m.kind, m.payload])).toEqual([
      ['upsert', expect.anything()],
      ['delete', null],
    ]);

    await expect(editEvent(db, event.id, { notes: 'x' })).rejects.toBeInstanceOf(EventDeletedError);
    await deleteEvent(db, event.id);
    expect(await db.outbox.count()).toBe(2);
  });
});
