import { t } from '../i18n/i18n';
import type { SyncStatus } from '../sync/syncStatus';

export type SyncKind = 'auth' | 'waiting' | 'syncing' | 'offline' | 'error' | 'pending' | 'synced';

export function syncKind(status: SyncStatus): SyncKind {
  if (status.authRequired) return 'auth';
  if (status.waitingForToken) return 'waiting';
  if (status.state === 'syncing') return 'syncing';
  if (status.state === 'offline') return 'offline';
  if (status.state === 'error') return 'error';
  return status.pendingCount > 0 ? 'pending' : 'synced';
}

function baseLabel(status: SyncStatus, kind: SyncKind): string {
  switch (kind) {
    case 'auth':
      return t('sync.signInToSync');
    case 'waiting':
      return t('sync.waitingForSignIn');
    case 'syncing':
      return t('sync.syncing');
    case 'offline':
      return t('sync.offline');
    case 'error':
      return t('sync.error');
    case 'pending':
      return t('sync.pending', { count: status.pendingCount });
    case 'synced':
      return t('sync.synced');
  }
}

/** Human label, shared by the Timeline chip and the header icon. */
export function syncLabel(status: SyncStatus): string {
  const kind = syncKind(status);
  const label = baseLabel(status, kind);
  if (status.attentionCount > 0) {
    return t('sync.labelWithFailed', {
      label,
      failed: t('sync.attentionSuffix', { count: status.attentionCount }),
    });
  }
  const keepsFailed = kind !== 'auth' && kind !== 'syncing';
  if (!keepsFailed || status.deadLetterCount === 0) return label;
  return t('sync.labelWithFailed', {
    label,
    failed: t('sync.failedSuffix', { count: status.deadLetterCount }),
  });
}
