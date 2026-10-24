import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '../api/ApiClientContext';
import { useAuth } from '../auth/useAuth';
import { isNativeApp } from '../platform/nativeApp';
import { useOnline } from '../sync/useOnline';
import { fetchBoardMe, type BoardMe } from './boardApi';

export const boardKey = ['board'] as const;
export const boardMeKey = (accountId: string | null) => [...boardKey, 'me', accountId] as const;

/**
 * The signed-in person's board access (`GET /board/me`), asked once per session and account and
 * kept in memory only. `undefined` while unknown (offline, in flight), `null` when there is none
 * (board disabled, no board role, the native app). Never blocks a render and never retries: the
 * Hub entry simply appears once the answer grants read access.
 */
export function useBoardAccess(): {
  access: BoardMe | null | undefined;
  /** The question failed (network, server): the page offers a retry. */
  failed: boolean;
  refetch: () => void;
} {
  const api = useApiClient();
  const { isAuthenticated, accountId } = useAuth();
  const online = useOnline();
  const native = isNativeApp();
  const query = useQuery({
    queryKey: boardMeKey(accountId),
    queryFn: ({ signal }) => fetchBoardMe(api, signal),
    enabled: isAuthenticated && online && !native,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
    retryOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  return {
    access: native ? null : query.data,
    failed: !native && query.isError,
    refetch: () => void query.refetch(),
  };
}
