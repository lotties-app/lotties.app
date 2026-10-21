import { useState } from 'react';
import { t } from '../i18n/i18n';
import { useSyncEngine } from '../sync/SyncEngineContext';

export function unsyncedChangesLabel(count: number): string {
  return t('session.unsyncedChanges', { count });
}

/**
 * "Push first" for actions that discard the outbox (sign-out, leaving a baby): runs a sync, then
 * proceeds when nothing is left unsynced, else reports what is still waiting.
 */
export function usePushThenProceed(
  countUnsynced: () => Promise<number>,
  proceed: () => Promise<void>,
) {
  const engine = useSyncEngine();
  const [pushing, setPushing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pushThenProceed = async () => {
    setPushing(true);
    setError(null);
    try {
      await engine.syncNow();
      const left = await countUnsynced();
      if (left === 0) return await proceed();
      setError(t('session.uploadFailed', { changes: unsyncedChangesLabel(left) }));
    } finally {
      setPushing(false);
    }
  };

  return { pushing, error, pushThenProceed, clearError: () => setError(null) };
}
