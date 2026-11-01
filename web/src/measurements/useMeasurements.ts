import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../api/ApiClientContext';
import { deleteMeasurement, listMeasurements, putMeasurement } from '../api/measurementsApi';
import { useAuth } from '../auth/useAuth';
import type { MeasurementRequest } from '../sync/contract';
import { useOnline } from '../sync/useOnline';

export const measurementsKey = (babyId: string) => ['measurements', babyId] as const;

/** Measurements are online-only: fetched while online and signed in, cached by TanStack Query. */
export function useMeasurements(babyId: string) {
  const api = useApiClient();
  const { isAuthenticated } = useAuth();
  const online = useOnline();
  const query = useQuery({
    queryKey: measurementsKey(babyId),
    queryFn: () => listMeasurements(api, babyId),
    enabled: isAuthenticated && online,
  });
  return { query, online };
}

export function useMeasurementActions(babyId: string) {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: measurementsKey(babyId) });
  return {
    save: async (id: string, request: MeasurementRequest) => {
      await putMeasurement(api, babyId, id, request);
      await refresh();
    },
    remove: async (id: string) => {
      await deleteMeasurement(api, babyId, id);
      await refresh();
    },
  };
}
