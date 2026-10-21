import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BabyRoutineDb } from '../db/database';
import { createEvent, editEvent, stopEvent } from '../db/eventCommands';
import {
  BABY_ID,
  TYPE_ID,
  fakeApi,
  fakeEventServer,
  serverEvent,
  testDatabase,
} from '../test/fakeApi';
import { fromEventDto } from './contract';
import { mergeEventDelta } from './pull';
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

function engineFor(handler: Parameters<typeof fakeApi>[0], online: { value: boolean }) {
  const fake = fakeApi(handler);
  const engine = new SyncEngine({
    db,
    api: fake.api,
    locks: null,
    eventTarget: null,
    isOnline: () => online.value,
  });
  engines.push(engine);
  return { engine, ...fake };
}

describe('offline edits against a server with its own clock (review #1)', () => {
  it.each(['client', 'server'] as const)(
    'create at 10:00 offline, stop at 10:15, reconnect at 12:00: stays stopped (%s-clock server)',
    async (compare) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      // The server clock runs ahead of the client and moves on every request.
      const server = fakeEventServer({ start: '2026-10-20T12:00:07.000Z', compare });
      const online = { value: false };
      const { engine, writes } = engineFor(server.handler, online);

      vi.setSystemTime(new Date('2026-10-20T10:00:00.000Z'));
      const event = await createEvent(db, { babyId: BABY_ID, typeId: TYPE_ID });
      await engine.syncNow();
      vi.setSystemTime(new Date('2026-10-20T10:15:00.000Z'));
      await stopEvent(db, event.id);

      vi.setSystemTime(new Date('2026-10-20T12:00:00.000Z'));
      online.value = true;
      await engine.syncNow();

      // Coalesced: only the latest full state (stopped, edited at 10:15) is sent.
      expect(writes()).toHaveLength(1);
      expect(writes()[0].body).toMatchObject({
        endedAt: '2026-10-20T10:15:00.000Z',
        updatedAt: '2026-10-20T10:15:00.000Z',
      });
      expect(server.events.get(event.id)?.endedAt).toBe('2026-10-20T10:15:00.000Z');
      const local = await db.events.get(event.id);
      expect(local).toMatchObject({
        endedAt: '2026-10-20T10:15:00.000Z',
        clientUpdatedAt: '2026-10-20T10:15:00.000Z',
      });
      // The row now carries the server's clock as the cursor time.
      expect((local?.updatedAt ?? '') > '2026-10-20T12:00:00.000Z').toBe(true);
      expect(await db.outbox.count()).toBe(0);
    },
  );

  it('keeps every edit of a later run when the server compares client clocks', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const server = fakeEventServer({ start: '2026-10-20T12:00:00.000Z' });
    const online = { value: true };
    const { engine } = engineFor(server.handler, online);

    vi.setSystemTime(new Date('2026-10-20T10:00:00.000Z'));
    const event = await createEvent(db, { babyId: BABY_ID, typeId: TYPE_ID });
    await engine.syncNow();
    // Server stamped ~12:00 on receipt; this edit's client time (10:15) is older than that.
    vi.setSystemTime(new Date('2026-10-20T10:15:00.000Z'));
    await stopEvent(db, event.id);
    await engine.syncNow();

    expect(server.events.get(event.id)?.endedAt).toBe('2026-10-20T10:15:00.000Z');
    expect((await db.events.get(event.id))?.endedAt).toBe('2026-10-20T10:15:00.000Z');
  });

  it('sends the local edit time as updatedAt for creates and every edit', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const server = fakeEventServer({ start: '2026-10-20T12:00:00.000Z' });
    const { engine, writes } = engineFor(server.handler, { value: true });

    vi.setSystemTime(new Date('2026-10-20T09:00:00.000Z'));
    const event = await createEvent(db, { babyId: BABY_ID, typeId: TYPE_ID });
    await engine.syncNow();
    vi.setSystemTime(new Date('2026-10-20T09:05:00.000Z'));
    await editEvent(db, event.id, { notes: 'edited' });
    await engine.syncNow();

    expect(writes().map((c) => (c.body as { updatedAt: string }).updatedAt)).toEqual([
      '2026-10-20T09:00:00.000Z',
      '2026-10-20T09:05:00.000Z',
    ]);
  });
});

describe('delta merge on client clocks', () => {
  const local = (overrides = {}) => ({
    ...fromEventDto(serverEvent({ id: 'e1', notes: 'local' })),
    ...overrides,
  });

  it('uses clientUpdatedAt, not the server updatedAt, for last-write-wins', async () => {
    // Synced local copy: server stamped 12:00, edited at 10:20 on a client.
    await db.events.put(
      local({ updatedAt: '2026-10-20T12:00:00.000Z', clientUpdatedAt: '2026-10-20T10:20:00.000Z' }),
    );

    await mergeEventDelta(db, BABY_ID, [
      // Another parent's later edit (10:30) received by the server at a lower server time.
      serverEvent({
        id: 'e1',
        notes: 'remote',
        updatedAt: '2026-10-20T11:00:00.000Z',
        clientUpdatedAt: '2026-10-20T10:30:00.000Z',
      }),
    ]);

    expect(await db.events.get('e1')).toMatchObject({
      notes: 'remote',
      clientUpdatedAt: '2026-10-20T10:30:00.000Z',
    });
    expect((await db.syncState.get([BABY_ID, 'events']))?.lastSyncedAt).toBe(
      '2026-10-20T11:00:00.000Z',
    );
  });

  it('keeps a local copy edited later on the client clock', async () => {
    await db.events.put(local({ clientUpdatedAt: '2026-10-20T10:40:00.000Z' }));

    await mergeEventDelta(db, BABY_ID, [
      serverEvent({
        id: 'e1',
        notes: 'stale',
        updatedAt: '2026-10-20T13:00:00.000Z',
        clientUpdatedAt: '2026-10-20T10:30:00.000Z',
      }),
    ]);

    expect((await db.events.get('e1'))?.notes).toBe('local');
  });

  it('tolerates servers without clientUpdatedAt (falls back to updatedAt)', async () => {
    await mergeEventDelta(db, BABY_ID, [serverEvent({ id: 'e2' })]);

    expect(await db.events.get('e2')).toMatchObject({
      updatedAt: '2026-10-20T12:00:00.000Z',
      clientUpdatedAt: '2026-10-20T12:00:00.000Z',
    });
  });

  it('always applies a server soft delete', async () => {
    await db.events.put(local({ clientUpdatedAt: '2026-10-20T23:00:00.000Z' }));

    await mergeEventDelta(db, BABY_ID, [
      serverEvent({
        id: 'e1',
        updatedAt: '2026-10-20T12:00:00.000Z',
        deletedAt: '2026-10-20T12:00:00.000Z',
      }),
    ]);

    expect((await db.events.get('e1'))?.deletedAt).toBe('2026-10-20T12:00:00.000Z');
  });
});
