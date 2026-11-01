import { useContext, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ApiClientContext } from '../api/ApiClientContext';
import { useDatabase } from '../db/DatabaseContext';
import { useOnline } from '../sync/useOnline';
import type { AgeNormSet } from './ageNorms';
import { readCachedAgeNorms, refreshAgeNorms } from './ageNormsCache';

/**
 * The published age norms: the copy kept on the device (works offline), refreshed from the server
 * at most once a day while online. `undefined` while the copy loads, `null` without one: callers
 * then keep their built-in defaults.
 */
export function useAgeNorms(): AgeNormSet | null | undefined {
  const db = useDatabase();
  const api = useContext(ApiClientContext);
  const online = useOnline();
  const cached = useLiveQuery(async () => (await readCachedAgeNorms(db)) ?? null, [db]);

  useEffect(() => {
    if (!api || !online) return;
    void refreshAgeNorms(db, api);
  }, [db, api, online]);

  return cached === undefined ? undefined : (cached?.norms ?? null);
}
