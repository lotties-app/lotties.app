import { useContext, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { ApiClientContext } from '../api/ApiClientContext';
import { useDatabase } from '../db/DatabaseContext';
import { useOnline } from '../sync/useOnline';
import { readCachedSchedule, refreshVaccineSchedule } from './scheduleCache';
import type { VaccineSchedule } from './vaccineSchedule';

export interface VaccineScheduleState {
  /** `undefined` while the device copy loads; `null` when there is none yet (first run offline). */
  schedule: VaccineSchedule | null | undefined;
}

/**
 * The vaccine schedule: the copy kept on the device first (it works offline), then, whenever the
 * device is online, a check with the server (`If-None-Match`, at most once an hour) that replaces
 * the copy when the schedule changed. Components re-render from the copy, never from the network.
 */
export function useVaccineSchedule(): VaccineScheduleState {
  const db = useDatabase();
  const api = useContext(ApiClientContext);
  const online = useOnline();
  const cached = useLiveQuery(async () => (await readCachedSchedule(db)) ?? null, [db]);

  useEffect(() => {
    if (!api || !online) return;
    // Fire and forget: the store may close under it (unmount, sign-out); the next mount refreshes again.
    refreshVaccineSchedule(db, api).catch(() => undefined);
  }, [db, api, online]);

  return { schedule: cached === undefined ? undefined : (cached?.schedule ?? null) };
}
