import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../api/ApiClientContext';
import { canManageDataStore } from '../baby/permissions';
import type { Baby } from '../db/models';
import { useOnline } from '../sync/useOnline';
import { dataStoreQueryKey, getDataStore } from './dataStoreApi';

/**
 * Where the baby's records live, for the Owner only and only online. A 404 means the feature does
 * not exist for this person (off on the server or not on its allowlist): callers then show nothing.
 * Not retried, so a hidden feature costs one request per baby.
 */
export function useDataStore(baby: Baby | undefined) {
  const api = useApiClient();
  const online = useOnline();
  const babyId = baby?.id ?? '';
  return useQuery({
    queryKey: dataStoreQueryKey(babyId),
    queryFn: () => getDataStore(api, babyId),
    enabled: !!baby && canManageDataStore(baby) && online,
    retry: false,
    staleTime: 30_000,
  });
}
