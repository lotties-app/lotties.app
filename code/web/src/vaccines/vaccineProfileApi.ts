import type { ApiClient } from '../api/apiClient';
import type { BabyRoutineDb } from '../db/database';
import type { Baby } from '../db/models';
import {
  apiPaths,
  vaccineProfileFromDto,
  type BabyDto,
  type VaccineProfileRequest,
} from '../sync/contract';

/**
 * `PUT /babies/{id}/vaccine-profile` (Owner and Parent, online): replaces the baby's vaccine
 * profile and stores what the server answered, so the schedule on screen follows at once.
 */
export async function saveVaccineProfile(
  api: ApiClient,
  db: BabyRoutineDb,
  babyId: string,
  request: VaccineProfileRequest,
): Promise<Pick<Baby, 'vaccineProfile' | 'gestationalAgeWeeks' | 'rsvMaternalVaccination'>> {
  const answer = await api.request<BabyDto | undefined>(apiPaths.vaccineProfile(babyId), {
    method: 'PUT',
    body: request,
  });
  // The server's copy wins; an empty or older answer falls back to what was sent.
  const stored = {
    vaccineProfile: request.vaccineProfile,
    gestationalAgeWeeks: request.gestationalAgeWeeks,
    rsvMaternalVaccination: request.rsvMaternalVaccination,
    ...(answer && typeof answer === 'object' ? vaccineProfileFromDto(answer) : {}),
  };
  await db.babies.update(babyId, stored);
  return stored;
}
