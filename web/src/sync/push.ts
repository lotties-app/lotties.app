import { ApiError } from '../api/ApiError';
import type { BabyRoutineDb } from '../db/database';
import type { OutboxMutation } from '../db/models';
import { peekPendingMutation } from '../db/outbox';
import { backoffDelay } from './backoff';
import { apiPaths, fromEventDto, type EventDto } from './contract';
import { classifyFailure, describeFailure } from './failures';
import { requestSignal, type SyncContext } from './syncContext';

export type PushOutcome =
  | { kind: 'drained' }
  /** The queue head is waiting for its backoff to elapse. */
  | { kind: 'backoff'; retryAt: number; error: string | null }
  | { kind: 'offline'; error: string }
  | { kind: 'unauthorized' };

/**
 * Pushes pending mutations strictly in queue order. Stops at the first network error, 401 or
 * transient failure (so later mutations never overtake earlier ones); permanently rejected
 * mutations are dead-lettered and skipped.
 */
export async function pushOutbox(ctx: SyncContext): Promise<PushOutcome> {
  for (;;) {
    const head = await peekPendingMutation(ctx.db);
    if (!head) return { kind: 'drained' };
    const retryAt = head.nextAttemptAt ? Date.parse(head.nextAttemptAt) : 0;
    if (retryAt > ctx.now()) return { kind: 'backoff', retryAt, error: head.lastError };
    const outcome = await pushOne(ctx, head);
    if (outcome) return outcome;
  }
}

async function pushOne(ctx: SyncContext, mutation: OutboxMutation): Promise<PushOutcome | null> {
  let response: EventDto | undefined;
  try {
    response = await send(ctx, mutation);
  } catch (error) {
    if (!isAlreadyDeleted(mutation, error)) return recordFailure(ctx, mutation, error);
  }
  await acknowledge(ctx.db, mutation, response);
  return null;
}

async function send(ctx: SyncContext, mutation: OutboxMutation): Promise<EventDto | undefined> {
  const path = apiPaths.event(mutation.babyId, mutation.entityId);
  const signal = requestSignal(ctx);
  if (mutation.kind === 'upsert') {
    return ctx.api.request<EventDto | undefined>(path, {
      method: 'PUT',
      body: mutation.payload,
      signal,
    });
  }
  await ctx.api.request<unknown>(path, { method: 'DELETE', signal });
  return undefined;
}

/** A DELETE answered with 404 means the server has nothing to delete: the goal is met. */
function isAlreadyDeleted(mutation: OutboxMutation, error: unknown) {
  return mutation.kind === 'delete' && error instanceof ApiError && error.status === 404;
}

function isEventDto(value: unknown, id: string): value is EventDto {
  const dto = value as Partial<EventDto> | undefined;
  return typeof dto === 'object' && dto !== null && dto.id === id && !!dto.updatedAt;
}

/** Removes the pushed mutation; adopts the server's copy unless newer local changes are queued. */
async function acknowledge(db: BabyRoutineDb, mutation: OutboxMutation, response: unknown) {
  await db.transaction('rw', db.outbox, db.events, async () => {
    await db.outbox.delete(mutation.id);
    if (!isEventDto(response, mutation.entityId)) return;
    const stillPending = await db.outbox
      .where('entityId')
      .equals(mutation.entityId)
      .filter((m) => m.status === 'pending')
      .count();
    if (stillPending === 0) await db.events.put(fromEventDto(response));
  });
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
    case 'transient': {
      const attempts = mutation.attempts + 1;
      const retryAt = ctx.now() + backoffDelay(attempts, ctx.backoff);
      await ctx.db.outbox.update(mutation.id, {
        attempts,
        lastError,
        nextAttemptAt: new Date(retryAt).toISOString(),
      });
      return { kind: 'backoff', retryAt, error: lastError };
    }
    case 'permanent':
      await ctx.db.outbox.update(mutation.id, {
        attempts: mutation.attempts + 1,
        lastError,
        status: 'dead',
        nextAttemptAt: null,
      });
      return null;
  }
}
