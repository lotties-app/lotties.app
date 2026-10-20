import { useEffect, useState, type ReactNode } from 'react';
import { useApiClient } from '../api/ApiClientContext';
import { useAuth } from '../auth/useAuth';
import { useDatabase } from '../db/DatabaseContext';
import { SyncEngine, type SyncEngineOptions } from './SyncEngine';
import { SyncEngineContext } from './SyncEngineContext';

type EngineOverrides = Omit<SyncEngineOptions, 'db' | 'api' | 'getAccessToken'>;

/**
 * Owns the sync engine: started while the user is authenticated, stopped otherwise.
 * The api client and token getter are re-created on every render upstream, so they are handed
 * to the long-lived engine instead of rebuilding it.
 */
export function SyncProvider({
  options,
  children,
}: {
  options?: EngineOverrides;
  children: ReactNode;
}) {
  const db = useDatabase();
  const api = useApiClient();
  const { isAuthenticated, getAccessToken } = useAuth();
  const [engine] = useState(() => new SyncEngine({ ...options, db, api, getAccessToken }));

  useEffect(() => {
    engine.setTransport(api, getAccessToken);
  }, [engine, api, getAccessToken]);

  useEffect(() => {
    if (!isAuthenticated) return;
    engine.start();
    return () => engine.stop();
  }, [engine, isAuthenticated]);

  return <SyncEngineContext value={engine}>{children}</SyncEngineContext>;
}
