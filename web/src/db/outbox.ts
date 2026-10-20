import type { BabyRoutineDb } from './database';
import type { MutationEntityType, MutationKind, OutboxMutation } from './models';

export interface NewMutation {
  babyId: string;
  kind: MutationKind;
  entityType: MutationEntityType;
  entityId: string;
  payload: unknown;
  createdAt: string;
}

/** Appends a mutation. Call inside the same `rw` transaction as the local write it describes. */
export function enqueueMutation(db: BabyRoutineDb, mutation: NewMutation): Promise<number> {
  return db.outbox.add({
    ...mutation,
    attempts: 0,
    lastError: null,
    status: 'pending',
    nextAttemptAt: null,
  });
}

/** The oldest pending mutation (queue head), or `undefined` when the queue is empty. */
export async function peekPendingMutation(db: BabyRoutineDb): Promise<OutboxMutation | undefined> {
  return db.outbox.where('status').equals('pending').first();
}

export function countPendingMutations(db: BabyRoutineDb): Promise<number> {
  return db.outbox.where('status').equals('pending').count();
}

export function countDeadLetters(db: BabyRoutineDb): Promise<number> {
  return db.outbox.where('status').equals('dead').count();
}

/** Entity ids with at least one pending mutation for `babyId` (they must not be overwritten by pulls). */
export async function pendingEntityIds(db: BabyRoutineDb, babyId: string): Promise<Set<string>> {
  const mutations = await db.outbox.where('babyId').equals(babyId).toArray();
  return new Set(mutations.filter((m) => m.status === 'pending').map((m) => m.entityId));
}

export function listDeadLetters(db: BabyRoutineDb): Promise<OutboxMutation[]> {
  return db.outbox.where('status').equals('dead').sortBy('id');
}

/** Puts a dead-lettered mutation back in the queue at its original position. */
export async function retryDeadLetter(db: BabyRoutineDb, id: number): Promise<void> {
  await db.outbox
    .where('id')
    .equals(id)
    .and((m) => m.status === 'dead')
    .modify({ status: 'pending', attempts: 0, nextAttemptAt: null });
}

/** Drops a dead-lettered mutation; the local record keeps its unsynced state. */
export async function discardDeadLetter(db: BabyRoutineDb, id: number): Promise<void> {
  await db.outbox
    .where('id')
    .equals(id)
    .and((m) => m.status === 'dead')
    .delete();
}
