export type SyncState = 'idle' | 'syncing' | 'offline' | 'error';

export interface SyncStatus {
  state: SyncState;
  /** Mutations waiting to be pushed. */
  pendingCount: number;
  /** Mutations the server permanently rejected (kept, not blocking). */
  deadLetterCount: number;
  /** Dead-lettered changes the user has to fix (rejected event details). */
  attentionCount: number;
  /** A 401 paused sync; it resumes after re-authentication. */
  authRequired: boolean;
  /**
   * The access token expired and is being renewed (or cannot be yet, e.g. offline): sync waits
   * and retries with backoff. Not an auth failure: the user stays signed in.
   */
  waitingForToken: boolean;
  lastError: string | null;
  /** End of the last fully successful run (local clock, UTC ISO). */
  lastSyncedAt: string | null;
}

export const INITIAL_SYNC_STATUS: SyncStatus = {
  state: 'idle',
  pendingCount: 0,
  deadLetterCount: 0,
  attentionCount: 0,
  authRequired: false,
  waitingForToken: false,
  lastError: null,
  lastSyncedAt: null,
};

/** Minimal observable compatible with `useSyncExternalStore`. Snapshots are immutable. */
export class SyncStatusStore {
  private status: SyncStatus = INITIAL_SYNC_STATUS;
  private readonly listeners = new Set<() => void>();

  getSnapshot = (): SyncStatus => this.status;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  update(patch: Partial<SyncStatus>): void {
    const next = { ...this.status, ...patch };
    const keys = Object.keys(next) as (keyof SyncStatus)[];
    if (keys.every((key) => next[key] === this.status[key])) return;
    this.status = next;
    for (const listener of this.listeners) listener();
  }
}
