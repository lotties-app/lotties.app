import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '../api/ApiError';
import type { BabyRoutineDb } from '../db/database';
import { createEvent, finishEvent, stopEvent } from '../db/eventCommands';
import type { EventUpsertRequest } from './contract';
import {
  BABY_ID,
  fakeApi,
  fakeEventServer,
  httpError,
  testDatabase,
  type ApiCall,
} from '../test/fakeApi';
import { FEEDING_TYPE } from '../test/builtInTypes';
import { validatePayload } from '../events/payloadRules';
import { SyncEngine } from './SyncEngine';

let db: BabyRoutineDb;
let engines: SyncEngine[];

beforeEach(() => {
  db = testDatabase();
  engines = [];
});

afterEach(async () => {
  engines.forEach((e) => e.stop());
  await db.delete();
});

/**
 * The events API with the server's payload rule for the feeding type: a completed feed without
 * a method is rejected with 400 `validation_failed` (field `method`).
 */
function setup(reject?: (call: ApiCall) => unknown) {
  const server = fakeEventServer({ start: '2026-10-20T12:00:00.000Z' });
  const fake = fakeApi((call) => {
    const custom = reject?.(call);
    if (custom !== undefined) return custom;
    const body = call.body as EventUpsertRequest | undefined;
    if (call.method === 'PUT' && body) {
      const [problem] = validatePayload(FEEDING_TYPE, body.payload ?? {}, body.endedAt != null);
      if (problem) {
        throw new ApiError(400, { code: 'validation_failed', field: problem.field });
      }
    }
    if (call.path === '/api/v1/babies') {
      return [{ id: BABY_ID, name: 'Lia', birthDate: '2026-08-01', role: 'Owner' }];
    }
    return server.handler(call);
  });
  const engine = new SyncEngine({
    db,
    api: fake.api,
    locks: null,
    eventTarget: null,
    isOnline: () => true,
  });
  engines.push(engine);
  return { engine, server, ...fake };
}

async function runningFeedOnServer(engine: SyncEngine) {
  const running = await createEvent(db, { babyId: BABY_ID, typeId: FEEDING_TYPE.id });
  await engine.syncNow();
  expect(await db.outbox.count()).toBe(0);
  return running;
}

describe('a stop the server rejects for missing details', () => {
  it('keeps the local stop, dead-letters it as needing attention, never restarts the timer', async () => {
    const { engine, calls } = setup();
    const running = await runningFeedOnServer(engine);

    await stopEvent(db, running.id);
    await engine.syncNow();

    const [dead] = await db.outbox.toArray();
    expect(dead).toMatchObject({
      status: 'dead',
      needsAttention: true,
      rejectedField: 'method',
      lastError: 'Some details are missing or not valid.',
    });
    expect((await db.events.get(running.id))?.endedAt).not.toBeNull();
    // The server copy (still running) was not even fetched to replace the local row.
    expect(calls.some((c) => c.method === 'GET' && c.path.endsWith(`/events/${running.id}`))).toBe(
      false,
    );
    expect(engine.status.getSnapshot()).toMatchObject({ deadLetterCount: 1, attentionCount: 1 });

    // Later pulls deliver the running server copy: it must not resurrect the timer.
    await engine.syncNow();
    expect((await db.events.get(running.id))?.endedAt).not.toBeNull();
  });

  it('a later pull with a newer running copy does not restart a rejected stop either', async () => {
    const { engine, server } = setup();
    const running = await runningFeedOnServer(engine);
    await stopEvent(db, running.id);
    await engine.syncNow();
    // Another device edits the running event on the server (newer edit time).
    const stored = server.events.get(running.id)!;
    server.events.set(running.id, {
      ...stored,
      notes: 'other device',
      updatedAt: '2030-01-01T00:00:00.000Z',
      clientUpdatedAt: '2030-01-01T00:00:00.000Z',
    });

    await engine.syncNow();

    expect((await db.events.get(running.id))?.endedAt).not.toBeNull();
  });

  it('Fix sends the completed event again and clears the attention entry', async () => {
    const { engine, server } = setup();
    const running = await runningFeedOnServer(engine);
    await stopEvent(db, running.id);
    await engine.syncNow();
    const stoppedAt = (await db.events.get(running.id))?.endedAt;

    await finishEvent(db, running.id, { method: 'breast', side: 'left' });
    await engine.syncNow();

    expect(await db.outbox.count()).toBe(0);
    expect(server.events.get(running.id)).toMatchObject({
      endedAt: stoppedAt,
      payload: { method: 'breast', side: 'left' },
    });
    expect(engine.status.getSnapshot()).toMatchObject({ deadLetterCount: 0, attentionCount: 0 });
  });

  it('another permanent rejection of a stop keeps the local stop too (no silent restart)', async () => {
    let rejectStops = false;
    const { engine } = setup((call) => {
      const body = call.body as EventUpsertRequest | undefined;
      if (rejectStops && call.method === 'PUT' && body?.endedAt) throw httpError(409, 'conflict');
      return undefined;
    });
    const running = await createEvent(db, {
      babyId: BABY_ID,
      typeId: FEEDING_TYPE.id,
      payload: { method: 'breast' },
    });
    await engine.syncNow();
    rejectStops = true;

    await stopEvent(db, running.id);
    await engine.syncNow();

    const [dead] = await db.outbox.toArray();
    expect(dead).toMatchObject({ status: 'dead' });
    expect(dead.needsAttention).toBeUndefined();
    expect((await db.events.get(running.id))?.endedAt).not.toBeNull();
  });

  it('Discard is the explicit way back to the server copy', async () => {
    const { engine } = setup();
    const running = await runningFeedOnServer(engine);
    await stopEvent(db, running.id);
    await engine.syncNow();
    const [dead] = await db.outbox.toArray();

    await engine.discardDeadLetter(dead.id);

    expect(await db.outbox.count()).toBe(0);
    expect((await db.events.get(running.id))?.endedAt).toBeNull();
  });
});
