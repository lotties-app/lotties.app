import { useQuery } from '@tanstack/react-query';
import { ApiError } from '../api/ApiError';
import type { ApiClient } from '../api/apiClient';
import { useApiClient } from '../api/ApiClientContext';
import { useAuth } from '../auth/useAuth';
import type { PersonSummary, ProfessionalSummary } from '../db/models';
import {
  apiPaths,
  fromPersonDto,
  fromProfessionalDto,
  parseRole,
  type AccessLogEntryDto,
  type ProfessionalProfileDto,
  type ProfessionalProfileRequest,
} from '../sync/contract';
import { useOnline } from '../sync/useOnline';
import type { BabyRole } from '../db/models';

/*
 * Online-only doctor access calls (docs/design/16-doctor-access.md): the user's own professional
 * profile and a baby's access log (Owner).
 */

/** Same limits as the API (`ProfessionalProfileTerms`). */
export const PROFESSIONAL_LIMITS = { displayName: 100, specialty: 100, registrationNumber: 40 };

/** The query key of the user's own professional profile. */
export const PROFESSIONAL_PROFILE_KEY = ['professional-profile'] as const;

/** The user's profile, or `null` before she declares one (404 `professional_profile_not_found`). */
export async function getProfessionalProfile(api: ApiClient): Promise<ProfessionalSummary | null> {
  try {
    return fromProfessionalDto(
      await api.request<ProfessionalProfileDto>(apiPaths.professionalProfile()),
    );
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}

/** Declares or updates the profile (self-declared: there is no way to verify it here). */
export async function saveProfessionalProfile(
  api: ApiClient,
  request: Omit<ProfessionalProfileRequest, 'kind'>,
): Promise<ProfessionalSummary> {
  const saved = await api.request<ProfessionalProfileDto>(apiPaths.professionalProfile(), {
    method: 'PUT',
    body: { kind: 'doctor', ...request } satisfies ProfessionalProfileRequest,
  });
  const profile = fromProfessionalDto(saved);
  if (!profile) throw new Error('Unexpected response for the professional profile.');
  return profile;
}

/** The user's own professional profile (`undefined` while unknown, `null` when there is none). */
export function useProfessionalProfile() {
  const api = useApiClient();
  const { isAuthenticated } = useAuth();
  const online = useOnline();
  return useQuery({
    queryKey: PROFESSIONAL_PROFILE_KEY,
    queryFn: () => getProfessionalProfile(api),
    enabled: isAuthenticated && online,
    staleTime: 5 * 60_000,
  });
}

/** One recorded access to the baby's data. */
export interface AccessLogEntry {
  userId: string;
  person: PersonSummary | null;
  role: BabyRole;
  at: string;
}

/** The baby's newest accesses (Owner only), newest first. */
export async function listAccessLog(api: ApiClient, babyId: string): Promise<AccessLogEntry[]> {
  const entries = await api.request<AccessLogEntryDto[]>(apiPaths.accessLog(babyId));
  return (Array.isArray(entries) ? entries : []).map((entry) => ({
    userId: entry.userId,
    person: fromPersonDto(entry.person),
    role: parseRole(entry.role),
    at: entry.at,
  }));
}
