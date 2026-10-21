import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../api/ApiClientContext';
import { useAuth } from '../auth/useAuth';
import { apiPaths, type PredictionsDto } from '../sync/contract';
import { useOnline } from '../sync/useOnline';
import { readCachedPredictions, writeCachedPredictions } from './predictionsCache';

export const PREDICTIONS_STALE_MS = 60_000;

/** Minutes east of UTC for `date` (e.g. `-180` for UTC-03:00), as the API expects. */
export function utcOffsetMinutes(date: Date = new Date()): number {
  return -date.getTimezoneOffset() || 0;
}

/** Tolerates missing lists so the cards never crash on an unexpected body. */
function normalize(body: Partial<PredictionsDto> | undefined, babyId: string): PredictionsDto {
  return {
    babyId: body?.babyId ?? babyId,
    generatedAt: body?.generatedAt ?? new Date().toISOString(),
    predictions: Array.isArray(body?.predictions) ? body.predictions : [],
    insufficientData: Array.isArray(body?.insufficientData) ? body.insufficientData : [],
  };
}

/**
 * Server-computed predictions for a baby. Fetched only while online and signed in; the last
 * response is persisted per baby and seeds the query, so offline viewers see it (with its
 * fetch time as `dataUpdatedAt`).
 */
export function usePredictions(babyId: string) {
  const api = useApiClient();
  const { isAuthenticated } = useAuth();
  const online = useOnline();
  const query = useQuery({
    queryKey: ['predictions', babyId],
    queryFn: async ({ signal }) => {
      const path = apiPaths.predictions(babyId, utcOffsetMinutes());
      const data = normalize(await api.request<Partial<PredictionsDto>>(path, { signal }), babyId);
      writeCachedPredictions(babyId, { data, fetchedAt: Date.now() });
      return data;
    },
    enabled: isAuthenticated && online,
    staleTime: PREDICTIONS_STALE_MS,
    initialData: () => readCachedPredictions(babyId)?.data,
    initialDataUpdatedAt: () => readCachedPredictions(babyId)?.fetchedAt,
  });
  return { query, online };
}
