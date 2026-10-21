import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../api/ApiClientContext';
import { listMembers } from '../api/managementApi';
import { useAuth } from '../auth/useAuth';
import { useOnline } from '../sync/useOnline';

const MEMBERS_STALE_MS = 5 * 60_000;

/**
 * The baby's members (`GET /babies/{id}/members`, online only), shared with Settings' members list
 * through the same query key. `undefined` while unknown (offline, loading or failed): the catch-up
 * card then names nobody ("Someone").
 */
export function useMembers(babyId: string) {
  const api = useApiClient();
  const { isAuthenticated } = useAuth();
  const online = useOnline();
  const query = useQuery({
    queryKey: ['members', babyId],
    queryFn: () => listMembers(api, babyId),
    enabled: isAuthenticated && online,
    staleTime: MEMBERS_STALE_MS,
  });
  return query.data;
}
