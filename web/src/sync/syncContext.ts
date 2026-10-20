import type { ApiClient } from '../api/apiClient';
import type { BabyRoutineDb } from '../db/database';
import type { BackoffOptions } from './backoff';

/** Dependencies shared by the push and pull phases. */
export interface SyncContext {
  db: BabyRoutineDb;
  api: ApiClient;
  /** Epoch milliseconds. */
  now: () => number;
  backoff: BackoffOptions;
  /** Per-request timeout so a hung request cannot block the single-flight run forever. */
  requestTimeoutMs: number;
}

export function requestSignal(ctx: SyncContext): AbortSignal | undefined {
  return typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(ctx.requestTimeoutMs)
    : undefined;
}
