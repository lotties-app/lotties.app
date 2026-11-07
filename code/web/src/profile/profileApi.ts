import { useQuery } from '@tanstack/react-query';
import type { ApiClient } from '../api/apiClient';
import { useApiClient } from '../api/ApiClientContext';
import { useAuth } from '../auth/useAuth';
import { apiPaths } from '../sync/contract';
import { useOnline } from '../sync/useOnline';

/*
 * The signed-in user's own profile (`GET /me`, `PUT /me/profile`; docs/design/45): a display name that
 * may be empty and a role label (a preset code or a custom text). Online only.
 */

export interface MyProfile {
  displayName: string;
  roleLabel: string | null;
}

interface MeDto {
  displayName?: string | null;
  roleLabel?: string | null;
}

export const MY_PROFILE_KEY = ['my-profile'] as const;

function fromMeDto(dto: MeDto): MyProfile {
  return { displayName: dto.displayName ?? '', roleLabel: dto.roleLabel?.trim() || null };
}

export async function getMyProfile(api: ApiClient): Promise<MyProfile> {
  return fromMeDto(await api.request<MeDto>(apiPaths.me()));
}

export async function saveMyProfile(api: ApiClient, profile: MyProfile): Promise<MyProfile> {
  return fromMeDto(
    await api.request<MeDto>(apiPaths.meProfile(), {
      method: 'PUT',
      body: { displayName: profile.displayName.trim(), roleLabel: profile.roleLabel ?? '' },
    }),
  );
}

export function useMyProfile() {
  const api = useApiClient();
  const { isAuthenticated } = useAuth();
  const online = useOnline();
  return useQuery({
    queryKey: MY_PROFILE_KEY,
    queryFn: () => getMyProfile(api),
    enabled: isAuthenticated && online,
    staleTime: 5 * 60_000,
  });
}
