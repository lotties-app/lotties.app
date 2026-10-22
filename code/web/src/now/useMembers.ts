import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../api/ApiClientContext';
import { listMembers } from '../api/managementApi';
import { useAuth } from '../auth/useAuth';
import { canSeeFamilyRecords } from '../baby/permissions';
import type { Baby } from '../db/models';
import { useOnline } from '../sync/useOnline';

const MEMBERS_STALE_MS = 5 * 60_000;

/**
 * The baby's members (`GET /babies/{id}/members`, online only), shared with Settings' members list
 * through the same query key. `undefined` while unknown (offline, loading or failed): the catch-up
 * card then names nobody ("Someone"). Never asked for a Doctor (the server refuses her: the family's
 * names are not clinical data), so for her it stays `undefined`.
 */
export function useMembers(baby: Pick<Baby, 'id' | 'role'>) {
  const api = useApiClient();
  const { isAuthenticated } = useAuth();
  const online = useOnline();
  const family = canSeeFamilyRecords(baby);
  const query = useQuery({
    queryKey: ['members', baby.id],
    queryFn: () => listMembers(api, baby.id),
    enabled: isAuthenticated && online && family,
    staleTime: MEMBERS_STALE_MS,
  });
  // A list cached before her role became Doctor is not shown either.
  return family ? query.data : undefined;
}
