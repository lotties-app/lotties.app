import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../api/ApiClientContext';
import { canManageCommunityInsights } from '../baby/permissions';
import type { Baby } from '../db/models';
import { useOnline } from '../sync/useOnline';
import { communityConsentQueryKey, getCommunityConsent } from './communityConsentApi';

/**
 * The baby's community insights consent, for an Owner or a Parent and only online. A 404 means the
 * feature is off on the server: callers then show nothing. Not retried, so a hidden feature costs
 * one request per baby.
 */
export function useCommunityConsent(baby: Baby) {
  const api = useApiClient();
  const online = useOnline();
  return useQuery({
    queryKey: communityConsentQueryKey(baby.id),
    queryFn: () => getCommunityConsent(api, baby.id),
    enabled: canManageCommunityInsights(baby) && online,
    retry: false,
    staleTime: 30_000,
  });
}
