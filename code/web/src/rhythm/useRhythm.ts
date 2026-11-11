import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../api/ApiClientContext';
import { ApiError } from '../api/ApiError';
import { deviceTimeZone, utcOffsetMinutes } from '../predictions/usePredictions';
import { useOnline } from '../sync/useOnline';
import { getRhythm } from './rhythmApi';

/*
 * In-memory react-query cache only: the rhythm is recomputed by the server on every request and is
 * never written to Dexie, localStorage or the outbox. Offline, the last answer of this session stays
 * in the cache and is shown as such; with none, a muted line.
 */

export const rhythmKey = (babyId: string) => ['rhythm', babyId] as const;

export const RHYTHM_STALE_MS = 5 * 60_000;

/** A client error (4xx) is an answer, not a hiccup: retrying it changes nothing. */
const retry = (failures: number, error: unknown) =>
  !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 2;

/** The baby's rhythm; `data` is `null` when the section must stay hidden (404/403, old server). */
export function useRhythm(babyId: string) {
  const api = useApiClient();
  const online = useOnline();
  const query = useQuery({
    queryKey: rhythmKey(babyId),
    queryFn: ({ signal }) => getRhythm(api, babyId, utcOffsetMinutes(), deviceTimeZone(), signal),
    enabled: online,
    staleTime: RHYTHM_STALE_MS,
    retry,
  });
  return { query, online };
}
