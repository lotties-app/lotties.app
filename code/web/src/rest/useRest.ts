import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../api/ApiClientContext';
import { useAuth } from '../auth/useAuth';
import { useOnline } from '../sync/useOnline';
import {
  deleteRestSettings,
  getRestEstimate,
  getRestSettings,
  putRestMorning,
  putRestSettings,
  type RestSettings,
} from './restApi';
import { toPayload } from './restModel';

/*
 * In-memory react-query cache only (the app persists no query, and the rest data never goes to
 * Dexie or localStorage). Offline, the last answer stays in the cache and is shown as such.
 */

export const restSettingsKey = ['rest', 'settings'] as const;
export const restEstimateKey = (night: string | null) => ['rest', 'estimate', night] as const;

/** The person's rest settings; `data` is `null` when the server does not know the route. */
export function useRestSettings() {
  const api = useApiClient();
  const { isAuthenticated } = useAuth();
  const online = useOnline();
  const query = useQuery({
    queryKey: restSettingsKey,
    queryFn: () => getRestSettings(api),
    enabled: isAuthenticated && online,
    retry: false,
  });
  return { query, online };
}

/** The estimate of `night` (`null`: the latest night). */
export function useRestEstimate(night: string | null) {
  const api = useApiClient();
  const online = useOnline();
  const query = useQuery({
    queryKey: restEstimateKey(night),
    queryFn: () => getRestEstimate(api, night ?? undefined),
    enabled: online,
  });
  return { query, online };
}

export function useRestActions() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const refreshSettings = () => queryClient.invalidateQueries({ queryKey: restSettingsKey });
  const refreshEstimates = () => queryClient.invalidateQueries({ queryKey: ['rest', 'estimate'] });
  return {
    saveSettings: async (settings: RestSettings) => {
      await putRestSettings(api, toPayload(settings));
      await Promise.all([refreshSettings(), refreshEstimates()]);
    },
    deleteSettings: async () => {
      await deleteRestSettings(api);
      queryClient.removeQueries({ queryKey: ['rest', 'estimate'] });
      await refreshSettings();
    },
    answerMorning: async (night: string, upAt: string) => {
      await putRestMorning(api, night, upAt);
      await refreshEstimates();
    },
  };
}
