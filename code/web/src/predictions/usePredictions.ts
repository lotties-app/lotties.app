import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../api/ApiClientContext';
import { useAuth } from '../auth/useAuth';
import { appLog } from '../logs/appLog';
import { apiPaths, type PredictionsDto } from '../sync/contract';
import { useOnline } from '../sync/useOnline';
import { readCachedPredictions, writeCachedPredictions } from './predictionsCache';

export const PREDICTIONS_STALE_MS = 60_000;

/** Minutes east of UTC for `date` (e.g. `-180` for UTC-03:00), as the API expects. */
export function utcOffsetMinutes(date: Date = new Date()): number {
  return -date.getTimezoneOffset() || 0;
}

/** The device's IANA time zone, when the browser reports one. */
export function deviceTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/** Tolerates missing lists so the cards never crash on an unexpected body. */
function normalize(body: Partial<PredictionsDto> | undefined, babyId: string): PredictionsDto {
  return {
    babyId: body?.babyId ?? babyId,
    generatedAt: body?.generatedAt ?? new Date().toISOString(),
    ...(typeof body?.engineVersion === 'string' ? { engineVersion: body.engineVersion } : {}),
    predictions: Array.isArray(body?.predictions) ? body.predictions : [],
    insufficientData: Array.isArray(body?.insufficientData) ? body.insufficientData : [],
    bedTime: body?.bedTime ?? null,
    patterns: Array.isArray(body?.patterns) ? body.patterns : [],
    wakeWindow: body?.wakeWindow ?? null,
    diaper: body?.diaper ?? null,
  };
}

/**
 * Server-computed predictions for a baby. Fetched when signed in; the last response is persisted
 * per baby and seeds the query so offline viewers see cached data. The `online` flag is no longer
 * used to gate fetching because `navigator.onLine` is unreliable in Capacitor WebViews (especially
 * iOS), causing the query to stay disabled and return `undefined` indefinitely. Network errors are
 * handled gracefully by React Query's retry/error state instead.
 */
export function usePredictions(babyId: string) {
  const api = useApiClient();
  const { isAuthenticated } = useAuth();
  const online = useOnline();
  const query = useQuery({
    queryKey: ['predictions', babyId],
    queryFn: async ({ signal }) => {
      const path = apiPaths.predictions(babyId, utcOffsetMinutes(), deviceTimeZone());
      appLog('prediction', `Fetching predictions for ${babyId}`, { path });
      try {
        const data = normalize(await api.request<Partial<PredictionsDto>>(path, { signal }), babyId);
        writeCachedPredictions(babyId, { data, fetchedAt: Date.now() });
        appLog('prediction', `Predictions fetched successfully`, {
          predictionCount: data.predictions.length,
          insufficientCount: data.insufficientData.length,
          generatedAt: data.generatedAt,
        });
        return data;
      } catch (error) {
        appLog('prediction', `Predictions fetch failed`, { error: error instanceof Error ? error.message : String(error) }, 'error');
        throw error;
      }
    },
    // Always enable when authenticated; let React Query handle network failures via error/retry
    // instead of gating on navigator.onLine which is unreliable in mobile WebViews.
    enabled: isAuthenticated,
    staleTime: PREDICTIONS_STALE_MS,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    initialData: () => readCachedPredictions(babyId)?.data,
    // Cap initialDataUpdatedAt so stale localStorage cache doesn't trick React Query into
    // thinking data is fresh. If cached data is older than staleTime, treat it as stale so
    // React Query triggers a refetch immediately instead of serving days-old predictions.
    initialDataUpdatedAt: () => {
      const cached = readCachedPredictions(babyId);
      if (!cached) return undefined;
      const maxAge = Date.now() - PREDICTIONS_STALE_MS;
      return cached.fetchedAt > maxAge ? cached.fetchedAt : maxAge;
    },
  });
  return { query, online };
}
