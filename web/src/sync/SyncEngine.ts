import { liveQuery, type Subscription } from 'dexie';
import type { ApiClient } from '../api/apiClient';
import type { BabyRoutineDb } from '../db/database';
import { countDeadLetters, countPendingMutations } from '../db/outbox';
import { DEFAULT_BACKOFF, type BackoffOptions } from './backoff';
import { discardDeadLetter } from './deadLetters';
import { classifyFailure, describeFailure } from './failures';
import { pullAll } from './pull';
import { pushOutbox } from './push';
import type { SyncContext } from './syncContext';
import { SyncStatusStore, type SyncState } from './syncStatus';

export const SYNC_LOCK_NAME = 'baby-routine-sync';

export interface SyncEngineOptions {
  db: BabyRoutineDb;
  api: ApiClient;
  /** Used to detect re-authentication after a 401 (a new token resumes sync). */
  getAccessToken?: () => Promise<string | null>;
  /** Periodic pull/retry interval. Default 30 s. */
  intervalMs?: number;
  backoff?: Partial<BackoffOptions>;
  /** Epoch milliseconds. */
  now?: () => number;
  requestTimeoutMs?: number;
  /** Cross-tab mutual exclusion; defaults to `navigator.locks` when available. */
  locks?: LockManager | null;
  isOnline?: () => boolean;
  /** Receives `online`/`offline` events; defaults to `window`. */
  eventTarget?: EventTarget | null;
}

interface QueueCounts {
  pending: number;
  dead: number;
}

function defaultLocks(): LockManager | null {
  return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null;
}

function defaultIsOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}

/**
 * Offline-first sync: push the outbox in order, then pull deltas. Runs are single-flight
 * (one per engine, and one across tabs via the Web Locks API); a trigger during a run schedules
 * exactly one follow-up run. Triggers: `start()`, new outbox entries, `online`, the interval and
 * backoff timers.
 */
export class SyncEngine {
  readonly status = new SyncStatusStore();

  private readonly ctx: SyncContext;
  private getAccessToken?: () => Promise<string | null>;
  private readonly intervalMs: number;
  private readonly locks: LockManager | null;
  private readonly isOnline: () => boolean;
  private readonly eventTarget: EventTarget | null;

  private inFlight: Promise<void> | null = null;
  private rerunRequested = false;
  private paused = false;
  private rejectedToken: string | null = null;
  private started = false;
  private lastPending: number | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private countsSubscription: Subscription | null = null;

  constructor(options: SyncEngineOptions) {
    this.ctx = {
      db: options.db,
      api: options.api,
      now: options.now ?? (() => Date.now()),
      backoff: { ...DEFAULT_BACKOFF, ...options.backoff },
      requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
    };
    this.getAccessToken = options.getAccessToken;
    this.intervalMs = options.intervalMs ?? 30_000;
    this.locks = options.locks === undefined ? defaultLocks() : options.locks;
    this.isOnline = options.isOnline ?? defaultIsOnline;
    this.eventTarget =
      options.eventTarget === undefined
        ? typeof window === 'undefined'
          ? null
          : window
        : options.eventTarget;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Swaps the api client / token getter used by subsequent requests. */
  setTransport(api: ApiClient, getAccessToken?: () => Promise<string | null>): void {
    this.ctx.api = api;
    this.getAccessToken = getAccessToken;
  }

  /** Starts listening for triggers and runs a first sync. Safe to call again after `stop()`. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.paused = false;
    this.status.update({ authRequired: false });
    this.eventTarget?.addEventListener('online', this.handleOnline);
    this.eventTarget?.addEventListener('offline', this.handleOffline);
    this.intervalTimer = setInterval(this.handleTick, this.intervalMs);
    this.lastPending = null;
    this.countsSubscription = liveQuery(() => this.readCounts()).subscribe({
      next: this.handleCounts,
      error: () => {},
    });
    void this.syncNow();
  }

  /** Stops triggers and timers. An in-flight run finishes on its own. */
  stop(): void {
    this.started = false;
    this.eventTarget?.removeEventListener('online', this.handleOnline);
    this.eventTarget?.removeEventListener('offline', this.handleOffline);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.intervalTimer = null;
    this.clearRetryTimer();
    this.countsSubscription?.unsubscribe();
    this.countsSubscription = null;
  }

  /** Runs a sync now, or joins the running one (and queues one follow-up run). */
  syncNow(): Promise<void> {
    if (this.paused) return Promise.resolve();
    if (this.inFlight) {
      this.rerunRequested = true;
      return this.inFlight;
    }
    this.inFlight = this.runLoop().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /** Resolves when no run is in flight (including queued follow-up runs). */
  whenIdle(): Promise<void> {
    return this.inFlight ?? Promise.resolve();
  }

  /**
   * Drops a dead-lettered mutation and restores the server's copy of its entity locally. Needs the
   * server; throws (and keeps the mutation) when the copy cannot be loaded.
   */
  discardDeadLetter(id: number): Promise<void> {
    return discardDeadLetter(this.ctx, id);
  }

  /** Clears a 401 pause (call after the user signed in again) and syncs. */
  resumeAfterAuth(): Promise<void> {
    if (this.paused) {
      this.paused = false;
      this.rejectedToken = null;
      this.status.update({ authRequired: false, lastError: null });
    }
    return this.syncNow();
  }

  private async runLoop(): Promise<void> {
    do {
      this.rerunRequested = false;
      await this.withLock(() => this.runOnceSafely());
    } while (this.rerunRequested && !this.paused);
  }

  private async withLock(run: () => Promise<void>): Promise<void> {
    if (!this.locks) return run();
    // Another tab holding the lock is already syncing the shared store: skip this run.
    await this.locks.request(SYNC_LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (lock) await run();
    });
  }

  private async runOnceSafely(): Promise<void> {
    try {
      await this.runOnce();
    } catch (error) {
      await this.finish('error', describeFailure(error));
    }
  }

  private async runOnce(): Promise<void> {
    if (this.paused) return;
    if (!this.isOnline()) return this.finish('offline', null);
    this.status.update({ state: 'syncing' });

    const push = await pushOutbox(this.ctx);
    if (push.kind === 'unauthorized') return this.pauseForAuth();
    if (push.kind === 'offline') return this.finish('offline', push.error);
    if (push.kind === 'backoff') this.scheduleRetry(push.retryAt);

    let pullErrors: string[];
    try {
      pullErrors = await pullAll(this.ctx);
    } catch (error) {
      return this.handlePullFailure(error);
    }
    const pushError = push.kind === 'backoff' ? push.error : null;
    const error = [pushError, ...pullErrors].filter(Boolean).join('; ') || null;
    await this.finish(error ? 'error' : 'idle', error);
  }

  private async handlePullFailure(error: unknown): Promise<void> {
    const kind = classifyFailure(error);
    if (kind === 'unauthorized') return this.pauseForAuth();
    await this.finish(kind === 'network' ? 'offline' : 'error', describeFailure(error));
  }

  private async finish(state: SyncState, lastError: string | null): Promise<void> {
    const counts = await this.readCounts();
    this.status.update({
      state,
      lastError,
      pendingCount: counts.pending,
      deadLetterCount: counts.dead,
      ...(state === 'idle' ? { lastSyncedAt: new Date(this.ctx.now()).toISOString() } : {}),
    });
  }

  private async pauseForAuth(): Promise<void> {
    this.paused = true;
    this.clearRetryTimer();
    this.rejectedToken = (await this.getAccessToken?.().catch(() => null)) ?? null;
    const counts = await this.readCounts();
    this.status.update({
      state: 'error',
      authRequired: true,
      lastError: 'Unauthorized: sign in again to resume sync.',
      pendingCount: counts.pending,
      deadLetterCount: counts.dead,
    });
  }

  private async readCounts(): Promise<QueueCounts> {
    const [pending, dead] = await Promise.all([
      countPendingMutations(this.ctx.db),
      countDeadLetters(this.ctx.db),
    ]);
    return { pending, dead };
  }

  private scheduleRetry(retryAt: number): void {
    this.clearRetryTimer();
    const delay = Math.max(0, retryAt - this.ctx.now());
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.syncNow();
    }, delay);
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /** A new access token after a 401 means the user re-authenticated. */
  private async resumeIfTokenChanged(): Promise<void> {
    const token = await this.getAccessToken?.().catch(() => null);
    if (token && token !== this.rejectedToken) await this.resumeAfterAuth();
  }

  private readonly handleOnline = () => {
    void this.syncNow();
  };

  private readonly handleOffline = () => {
    if (!this.inFlight) this.status.update({ state: 'offline' });
  };

  private readonly handleTick = () => {
    void (this.paused ? this.resumeIfTokenChanged() : this.syncNow());
  };

  private readonly handleCounts = (counts: QueueCounts) => {
    this.status.update({ pendingCount: counts.pending, deadLetterCount: counts.dead });
    const grew = this.lastPending !== null && counts.pending > this.lastPending;
    this.lastPending = counts.pending;
    if (grew) void this.syncNow();
  };
}
