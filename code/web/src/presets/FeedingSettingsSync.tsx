import { useEffect, useRef } from 'react';
import { useApiClient } from '../api/ApiClientContext';
import { useAuth } from '../auth/useAuth';
import { syncTimeBottles } from './timeBottlesSync';

/** Keeps the cached "Time bottle feedings" value in step with the account's (renders nothing). */
export function TimeBottlesSync() {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? <AccountTimeBottlesSync /> : null;
}

function AccountTimeBottlesSync() {
  const api = useApiClient();
  // `ApiClientProvider` builds a new client every render: keep the latest one without re-running effects.
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);

  useEffect(() => {
    const run = () => void syncTimeBottles(apiRef.current);
    run();
    window.addEventListener('online', run);
    return () => window.removeEventListener('online', run);
  }, []);
  return null;
}
