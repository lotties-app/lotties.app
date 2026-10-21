import { ApiError } from '../api/ApiError';
import type { BabyRoutineDb } from '../db/database';
import type { OutboxMutation } from '../db/models';
import { dropIfSuperseded, peekPendingMutation } from '../db/outbox';
import { backoffDelay } from './backoff';
import { apiPaths, fromEventDto, isEventDtoFor, type EventUpsertRequest } from './contract';
import { classifyFailure, countsTowardGiveUp, describeFailure } from './failures';
import { deadLetter } from './deadLetters';
import { syncRequest, type SyncContext } from './syncContext';

/**
 * Consecutive server failures (HTTP 500, unknown errors) after which a mutation is dead-lettered,
 * so one request the server can never accept does not block the queue forever.
 */
export const MAX_SERVER_FAILURES = 8;

export type PushOutcome =
  | { kind: 'drained' }
  /** The queue head is waiting for its backoff to elapse. */
  | { kind: 'backoff'; retryAt: number; error: string | null }
  | { kind: 'offline'; error: string }
  | { kind: 'unauthorized' };

/**
 * Pushes pending mutations strictly in queue order. A head superseded by a later mutation of the
 * same entity is coalesced into it first (only the latest full state is sent). Stops at the first
 * network error, 401 or transient failure (so later mutations never overtake earlier ones);
 * permanently rejected mutations, and ones that failed `MAX_SERVER_FAILURES` times in a row, are
 * dead-lettered and skipped.
 */
export async function pushOutbox(ctx: SyncContext): Promise<PushOutcome> {
  for (;;) {
    const head = await peekPendingMutation(ctx.db);
    if (!head) return { kind: 'drained' };
    if (await dropIfSuperseded(ctx.db, head)) continue;
    const retryAt = head.nextAttemptAt ? Date.parse(head.nextAttemptAt) : 0;
    if (retryAt > ctx.now()) return { kind: 'backoff', retryAt, error: head.lastError };
    const outcome = await pushOne(ctx, head);
    if (outcome) return outcome;
  }
}

async function pushOne(ctx: SyncContext, mutation: OutboxMutation): Promise<PushOutcome | null> {
  let response: unknown;
  try {
    response = await send(ctx, mutation);
  } catch (error) {
    if (!isAlreadyDeleted(mutation, error)) return recordFailure(ctx, mutation, error);
  }
  await acknowledge(ctx.db, mutation, response);
  return null;
}

async function send(ctx: SyncContext, mutation: OutboxMutation): Promise<unknown> {
  const path =
    mutation.entityType === 'medication'
      ? apiPaths.medication(mutation.babyId, mutation.entityId)
      : apiPaths.event(mutation.babyId, mutation.entityId);
  if (mutation.kind === 'upsert') {
    return syncRequest<unknown>(ctx, path, { method: 'PUT', body: upsertBody(mutation) });
  }
  await syncRequest<unknown>(ctx, path, { method: 'DELETE' });
  return undefined;
}

/**
 * Event upserts carry the local edit time as `updatedAt` so the server's last-write-wins can drop
 * stale replays. Mutations queued before that field existed fall back to their enqueue time,
 * which is the event's edit time at the moment of the edit.
 */
function upsertBody(mutation: OutboxMutation): unknown {
  if (mutation.entityType !== 'event') return mutation.payload;
  const body = mutation.payload as Partial<EventUpsertRequest>;
  return body.updatedAt ? body : { ...body, updatedAt: mutation.createdAt };
}

/** A DELETE answered with 404 means the server has nothing to delete: the goal is met. */
function isAlreadyDeleted(mutation: OutboxMutation, error: unknown) {
  return mutation.kind === 'delete' && error instanceof ApiError && error.status === 404;
}

/**
 * Removes the pushed mutation and adopts the server's copy unless newer local changes are queued.
 * The server copy wins even when it differs from what was sent (a stale `updatedAt` was ignored
 * and the stored copy returned, or the event was already deleted on the server).
 */
async function acknowledge(db: BabyRoutineDb, mutation: OutboxMutation, response: unknown) {
  await db.transaction('rw', db.outbox, db.events, async () => {
    await db.outbox.delete(mutation.id);
    if (mutation.entityType !== 'event' || !isEventDtoFor(response, mutation.entityId)) return;
    const stillPending = await db.outbox
      .where('entityId')
      .equals(mutation.entityId)
      .filter((m) => m.status === 'pending')
      .count();
    if (stillPending === 0) await db.events.put(fromEventDto(response));
  });
}

function giveUpMessage(lastError: string) {
  return (
    `Gave up after ${MAX_SERVER_FAILURES} failed attempts: the server kept answering with an ` +
    `error (${lastError}). Retry later or discard the change.`
  );
}

async function recordTransient(
  ctx: SyncContext,
  mutation: OutboxMutation,
  error: unknown,
  lastError: string,
): Promise<PushOutcome | null> {
  const attempts = mutation.attempts + 1;
  const failureCount = (mutation.failureCount ?? 0) + (countsTowardGiveUp(error) ? 1 : 0);
  if (failureCount >= MAX_SERVER_FAILURES) {
    await deadLetter(ctx, mutation, {
      attempts,
      failureCount,
      lastError: giveUpMessage(lastError),
    });
    return null;
  }
  const retryAt = ctx.now() + backoffDelay(attempts, ctx.backoff);
  await ctx.db.outbox.update(mutation.id, {
    attempts,
    failureCount,
    lastError,
    nextAttemptAt: new Date(retryAt).toISOString(),
  });
  return { kind: 'backoff', retryAt, error: lastError };
}

async function recordFailure(
  ctx: SyncContext,
  mutation: OutboxMutation,
  error: unknown,
): Promise<PushOutcome | null> {
  const kind = classifyFailure(error);
  const lastError = describeFailure(error);
  switch (kind) {
    case 'unauthorized':
      return { kind: 'unauthorized' };
    case 'network':
      await ctx.db.outbox.update(mutation.id, { lastError });
      return { kind: 'offline', error: lastError };
    case 'transient':
      return recordTransient(ctx, mutation, error, lastError);
    case 'permanent':
      await deadLetter(ctx, mutation, {
        attempts: mutation.attempts + 1,
        failureCount: mutation.failureCount ?? 0,
        lastError,
      });
      return null;
  }
}
