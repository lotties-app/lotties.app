import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BABY_ID, testDatabase } from '../test/fakeApi';
import type { BabyRoutineDb } from './database';
import { enqueueMutation, listDeadLetters, requeueDeadLetters } from './outbox';

let db: BabyRoutineDb;
beforeEach(() => {
  db = testDatabase();
});
afterEach(async () => {
  await db.delete();
});

const queue = (entityId: string) =>
  enqueueMutation(db, {
    babyId: BABY_ID,
    kind: 'upsert',
    entityType: 'event',
    entityId,
    payload: {},
    createdAt: '2026-10-26T22:00:00.000Z',
  });

describe('requeueDeadLetters', () => {
  it('puts refused changes back in the queue but leaves the ones waiting for the user to fix', async () => {
    const refused = await queue('a');
    const needsFix = await queue('b');
    await db.outbox.update(refused, { status: 'dead', failureCount: 3, attempts: 3 });
    await db.outbox.update(needsFix, { status: 'dead', needsAttention: true });

    await requeueDeadLetters(db);

    expect(await db.outbox.get(refused)).toMatchObject({ status: 'pending', attempts: 0, failureCount: 0 });
    expect((await listDeadLetters(db)).map((m) => m.id)).toEqual([needsFix]);
  });
});
