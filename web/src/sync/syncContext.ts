import type { ApiClient, ApiResponse, RequestOptions } from '../api/apiClient';
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

type SyncRequestOptions = Pick<RequestOptions, 'method' | 'body'>;

/**
 * Options every sync request uses: a per-request timeout, and no login redirect on 401 (the
 * engine pauses with `authRequired` and the route guard / UI handles re-login instead).
 */
function syncOptions(ctx: SyncContext, options: SyncRequestOptions): RequestOptions {
  return { ...options, signal: requestSignal(ctx), skipUnauthorizedHandler: true };
}

export function syncRequest<T>(
  ctx: SyncContext,
  path: string,
  options: SyncRequestOptions = {},
): Promise<T> {
  return ctx.api.request<T>(path, syncOptions(ctx, options));
}

export function syncRequestWithMeta<T>(
  ctx: SyncContext,
  path: string,
  options: SyncRequestOptions = {},
): Promise<ApiResponse<T>> {
  return ctx.api.requestWithMeta<T>(path, syncOptions(ctx, options));
}
