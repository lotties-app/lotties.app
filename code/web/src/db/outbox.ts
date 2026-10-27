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
    failureCount: 0,
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

/** Pending plus dead-lettered mutations (changes the server does not have), optionally of one baby. */
export async function countUnsyncedMutations(db: BabyRoutineDb, babyId?: string): Promise<number> {
  return babyId === undefined
    ? db.outbox.count()
    : db.outbox.where('babyId').equals(babyId).count();
}

/** Entity ids with at least one pending mutation for `babyId` (they must not be overwritten by pulls). */
export async function pendingEntityIds(db: BabyRoutineDb, babyId: string): Promise<Set<string>> {
  const mutations = await db.outbox.where('babyId').equals(babyId).toArray();
  return new Set(mutations.filter((m) => m.status === 'pending').map((m) => m.entityId));
}

/**
 * Events of `babyId` whose stop the server rejected (a dead-lettered upsert with an end time): a
 * pull must not replace them with a running server copy, which would silently restart the timer.
 */
export async function rejectedStopIds(db: BabyRoutineDb, babyId: string): Promise<Set<string>> {
  const mutations = await db.outbox.where('babyId').equals(babyId).toArray();
  return new Set(
    mutations
      .filter(
        (m) =>
          m.status === 'dead' &&
          m.entityType === 'event' &&
          m.kind === 'upsert' &&
          !!(m.payload as { endedAt?: string | null } | null)?.endedAt,
      )
      .map((m) => m.entityId),
  );
}

/** Dead-lettered changes the user has to fix (the server rejected the event's details). */
export function countAttentionNeeded(db: BabyRoutineDb): Promise<number> {
  return db.outbox
    .where('status')
    .equals('dead')
    .filter((m) => m.needsAttention === true)
    .count();
}

/**
 * Drops the dead-lettered upserts of an event, inside the transaction of a local edit that queues
 * its full, fixed state (the new upsert supersedes them).
 */
export async function dropDeadUpserts(db: BabyRoutineDb, entityId: string): Promise<void> {
  await db.outbox
    .where('entityId')
    .equals(entityId)
    .filter((m) => m.status === 'dead' && m.kind === 'upsert' && m.entityType === 'event')
    .delete();
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
    .modify({ status: 'pending', attempts: 0, failureCount: 0, nextAttemptAt: null });
}

/**
 * Puts every dead-lettered change that is not waiting for the user to fix its details back in the queue (after a consent
 * the server refused them for). One the server still refuses is dead-lettered again.
 */
export async function requeueDeadLetters(db: BabyRoutineDb): Promise<void> {
  await db.outbox
    .where('status')
    .equals('dead')
    .filter((m) => m.needsAttention !== true)
    .modify({ status: 'pending', attempts: 0, failureCount: 0, nextAttemptAt: null });
}

/** Prescription ids an event upsert names (`payload.medications[].prescriptionId`). */
function prescriptionIdsOf(mutation: OutboxMutation): string[] {
  if (mutation.entityType !== 'event' || mutation.kind !== 'upsert') return [];
  const payload = (mutation.payload as { payload?: { medications?: unknown } } | null)?.payload;
  const list = payload?.medications;
  if (!Array.isArray(list)) return [];
  return list
    .map((entry: unknown) => (entry as { prescriptionId?: unknown } | null)?.prescriptionId)
    .filter((id): id is string => typeof id === 'string');
}

/** Formula id a bottle upsert names (`payload.formula_id`). */
function formulaIdOfMutation(mutation: OutboxMutation): string | null {
  if (mutation.entityType !== 'event' || mutation.kind !== 'upsert') return null;
  const payload = (mutation.payload as { payload?: { formula_id?: unknown } } | null)?.payload;
  return typeof payload?.formula_id === 'string' ? payload.formula_id : null;
}

/**
 * The queued mutation that must reach the server before `head`, if any: an event naming a
 * prescription needs that prescription first, a bottle naming a formula needs that formula, and a
 * prescription needs its medication. Queue order
 * alone is not enough because a later edit of the same entity absorbs the earlier one
 * (`dropIfSuperseded`), which can move it behind the mutations that depend on it.
 */
export async function dependencyOf(
  db: BabyRoutineDb,
  head: OutboxMutation,
): Promise<OutboxMutation | undefined> {
  const wanted = new Map<string, MutationEntityType>();
  for (const id of prescriptionIdsOf(head)) wanted.set(id, 'prescription');
  const formulaId = formulaIdOfMutation(head);
  if (formulaId) wanted.set(formulaId, 'formula');
  if (head.entityType === 'prescription' && head.kind === 'upsert') {
    const medicationId = (head.payload as { medicationId?: unknown } | null)?.medicationId;
    if (typeof medicationId === 'string') wanted.set(medicationId, 'medication');
  }
  if (wanted.size === 0) return undefined;
  const pending = await db.outbox
    .where('entityId')
    .anyOf([...wanted.keys()])
    .filter(
      (m) =>
        m.id !== head.id &&
        m.status === 'pending' &&
        m.babyId === head.babyId &&
        wanted.get(m.entityId) === m.entityType,
    )
    .sortBy('id');
  return pending[0];
}

function laterOf(a: string | null, b: string | null): string | null {
  if (!a || !b) return a ?? b;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

/**
 * Coalesces the queue head into the next pending mutation of the same entity, if any: every
 * upsert carries the full state, so only the latest one needs to reach the server. The head is
 * dropped (its retry state carries over, so repeated edits cannot dodge the backoff or the give-up
 * count) and the successor is pushed at its own position, keeping the order across entities.
 * Returns `true` when the head was dropped.
 */
export async function dropIfSuperseded(db: BabyRoutineDb, head: OutboxMutation): Promise<boolean> {
  return db.transaction('rw', db.outbox, async () => {
    const successor = await db.outbox
      .where('entityId')
      .equals(head.entityId)
      .filter((m) => m.id > head.id && m.status === 'pending' && m.entityType === head.entityType)
      .first();
    if (!successor) return false;
    await db.outbox.update(successor.id, {
      attempts: Math.max(head.attempts, successor.attempts),
      failureCount: Math.max(head.failureCount ?? 0, successor.failureCount ?? 0),
      nextAttemptAt: laterOf(head.nextAttemptAt, successor.nextAttemptAt),
      lastError: successor.lastError ?? head.lastError,
    });
    await db.outbox.delete(head.id);
    return true;
  });
}
