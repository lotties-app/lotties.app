import type { SyncStatus } from '../sync/syncStatus';

export type SyncKind = 'auth' | 'syncing' | 'offline' | 'error' | 'pending' | 'synced';

export function syncKind(status: SyncStatus): SyncKind {
  if (status.authRequired) return 'auth';
  if (status.state === 'syncing') return 'syncing';
  if (status.state === 'offline') return 'offline';
  if (status.state === 'error') return 'error';
  return status.pendingCount > 0 ? 'pending' : 'synced';
}

/** Human label, shared by the Timeline chip and the header icon. */
export function syncLabel(status: SyncStatus): string {
  const failed = status.deadLetterCount > 0 ? ` · ${status.deadLetterCount} failed` : '';
  switch (syncKind(status)) {
    case 'auth':
      return 'Sign in to sync';
    case 'syncing':
      return 'Syncing…';
    case 'offline':
      return `Offline${failed}`;
    case 'error':
      return `Sync error${failed}`;
    case 'pending':
      return `${status.pendingCount} pending${failed}`;
    case 'synced':
      return `Synced${failed}`;
  }
}
