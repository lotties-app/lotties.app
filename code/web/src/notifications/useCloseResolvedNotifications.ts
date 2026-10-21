import { useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useDatabase } from '../db/DatabaseContext';
import { usePushDevice } from './PushDeviceContext';
import { closeResolvedNotifications, loadResolutionFacts } from './resolvedNotifications';

/**
 * Closes this browser's notifications for doses logged and naps started (here or synced from
 * another device). The live query re-runs after every local write and every sync pull. Nothing
 * runs where notifications cannot be shown.
 */
export function useCloseResolvedNotifications(): void {
  const db = useDatabase();
  const device = usePushDevice();
  const active = device.support() === 'supported' && device.permission() === 'granted';
  const facts = useLiveQuery(
    () => (active ? loadResolutionFacts(db, Date.now()) : null),
    [db, active],
  );
  useEffect(() => {
    if (facts) void closeResolvedNotifications(device, facts);
  }, [facts, device]);
}
