import { useState } from 'react';
import { useSyncEngine } from '../sync/SyncEngineContext';

export function unsyncedChangesLabel(count: number): string {
  return count === 1 ? '1 unsynced change' : `${count} unsynced changes`;
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
      setError(
        `${unsyncedChangesLabel(left)} could not be uploaded. Check your connection, or review ` +
          'failed changes in Settings > Sync.',
      );
    } finally {
      setPushing(false);
    }
  };

  return { pushing, error, pushThenProceed, clearError: () => setError(null) };
}
