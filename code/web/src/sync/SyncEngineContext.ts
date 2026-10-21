import { createContext, useContext, useSyncExternalStore } from 'react';
import type { SyncEngine } from './SyncEngine';
import type { SyncStatus } from './syncStatus';

export const SyncEngineContext = createContext<SyncEngine | null>(null);

/** The app's sync engine (e.g. to call `syncNow()` from a refresh action). */
export function useSyncEngine(): SyncEngine {
  const engine = useContext(SyncEngineContext);
  if (!engine) throw new Error('useSyncEngine must be used within SyncProvider');
  return engine;
}

/** Live sync status: state, pending/dead-letter counts, auth pause and last error. */
export function useSyncStatus(): SyncStatus {
  const { status } = useSyncEngine();
  return useSyncExternalStore(status.subscribe, status.getSnapshot);
}
