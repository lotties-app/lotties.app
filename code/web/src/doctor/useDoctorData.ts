import { useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useApiClient } from '../api/ApiClientContext';
import { useAuth } from '../auth/useAuth';
import { addDays, startOfDay } from '../day/dayModel';
import { useBabies } from '../db/hooks';
import type { Baby } from '../db/models';
import { useOnline } from '../sync/useOnline';
import {
  fetchClinicalSummary,
  fetchEventTypes,
  fetchPatients,
  fetchTimeline,
  type DoctorPatient,
} from './doctorApi';
import type { PatientSort } from './dashboardStorage';
import { hasScope, scopesOf } from './scopes';

/*
 * The dashboard's data (docs/design/19-doctor-dashboard.md): on-demand reads with a short cache.
 * Nothing here is written to the device's database; a patient's numbers are fetched when a screen
 * shows them and kept by TanStack Query for a few minutes (offline, the last answer stays shown).
 */

/** How long an answer counts as fresh (a revisit within it does not refetch). */
export const DASHBOARD_STALE_MS = 60_000;

const doctorKey = ['doctor'] as const;
export const patientsKey = [...doctorKey, 'patients'] as const;

/** The babies the user follows as their Doctor (from the device), by name. */
export function doctorBabies(babies: readonly Baby[] | undefined): Baby[] | undefined {
  return babies
    ?.filter((baby) => baby.role === 'Doctor')
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function useDoctorBabies(): Baby[] | undefined {
  const babies = useBabies();
  return useMemo(() => doctorBabies(babies), [babies]);
}

/** A patient card built from the device alone (offline, or before the server answered). */
export function localPatient(baby: Baby): DoctorPatient {
  return {
    babyId: baby.id,
    name: baby.name,
    birthDate: baby.birthDate,
    scopes: [...scopesOf(baby)],
    lastEventAt: null,
    week: null,
    latestWeight: null,
    pendingProposals: null,
    vaccinesDue: null,
    sharedNotes: null,
  };
}

/**
 * The patients with their card data: the server's answer for the babies the device knows as
 * Doctor memberships (a patient the device already dropped is not shown), else the device's list.
 */
export function usePatients() {
  const api = useApiClient();
  const { isAuthenticated } = useAuth();
  const online = useOnline();
  const babies = useDoctorBabies();
  const query = useQuery({
    queryKey: patientsKey,
    queryFn: ({ signal }) => fetchPatients(api, signal),
    enabled: isAuthenticated && online,
    staleTime: DASHBOARD_STALE_MS,
  });
  const patients = useMemo(() => {
    const fromServer = new Map((query.data ?? []).map((patient) => [patient.babyId, patient]));
    // The server's card follows the latest sections; the device's name and birth date are shown.
    return babies?.map((baby) => {
      const server = fromServer.get(baby.id);
      return server
        ? { ...server, name: baby.name, birthDate: baby.birthDate }
        : localPatient(baby);
    });
  }, [babies, query.data]);
  return { patients, query, online };
}

const ageKey = (patient: DoctorPatient) => patient.birthDate;

/** Patients in the chosen order: latest activity (none last), name, or youngest first. */
export function sortPatients(
  patients: readonly DoctorPatient[],
  sort: PatientSort,
): DoctorPatient[] {
  const byName = (a: DoctorPatient, b: DoctorPatient) =>
    a.name.localeCompare(b.name) || a.babyId.localeCompare(b.babyId);
  const sorted = [...patients];
  if (sort === 'name') return sorted.sort(byName);
  if (sort === 'age') {
    return sorted.sort((a, b) => ageKey(b).localeCompare(ageKey(a)) || byName(a, b));
  }
  return sorted.sort((a, b) => {
    if (a.lastEventAt && b.lastEventAt) {
      return b.lastEventAt.localeCompare(a.lastEventAt) || byName(a, b);
    }
    if (a.lastEventAt) return -1;
    if (b.lastEventAt) return 1;
    return byName(a, b);
  });
}

/** Case- and accent-insensitive name match for the search boxes. */
export function matchesName(name: string, search: string): boolean {
  const fold = (text: string) =>
    text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase();
  return fold(name).includes(fold(search.trim()));
}

export interface SummaryRange {
  /** `yyyy-mm-dd`, inclusive. */
  from: string;
  to: string;
}

/** The server's aggregates of one patient over a range of local days. */
export function useClinicalSummary(baby: Baby, range: SummaryRange) {
  const api = useApiClient();
  const { isAuthenticated } = useAuth();
  const online = useOnline();
  return useQuery({
    queryKey: [...doctorKey, 'summary', baby.id, range.from, range.to, scopesOf(baby).join(',')],
    queryFn: ({ signal }) => fetchClinicalSummary(api, baby.id, range, signal),
    enabled: isAuthenticated && online,
    staleTime: DASHBOARD_STALE_MS,
    placeholderData: keepPreviousData,
  });
}

/** How far before a day the timeline also reads, so a sleep from the evening before shows. */
const TIMELINE_LOOK_BACK_DAYS = 1;

/** One local day of a patient's events (and the evening before, for the ribbon). */
export function useTimelineDay(baby: Baby, day: Date) {
  const api = useApiClient();
  const { isAuthenticated } = useAuth();
  const online = useOnline();
  const start = startOfDay(day);
  const from = addDays(start, -TIMELINE_LOOK_BACK_DAYS);
  const to = addDays(start, 1);
  return useQuery({
    queryKey: [...doctorKey, 'timeline', baby.id, start.toISOString()],
    queryFn: ({ signal }) => fetchTimeline(api, baby.id, from, to, signal),
    enabled: isAuthenticated && online && hasScope(baby, 'daily_log'),
    staleTime: DASHBOARD_STALE_MS,
  });
}

/** The patient's event types (names, icons and fields of the timeline rows). */
export function usePatientEventTypes(baby: Baby) {
  const api = useApiClient();
  const { isAuthenticated } = useAuth();
  const online = useOnline();
  return useQuery({
    queryKey: [...doctorKey, 'event-types', baby.id],
    queryFn: ({ signal }) => fetchEventTypes(api, baby.id, signal),
    enabled: isAuthenticated && online && hasScope(baby, 'daily_log'),
    staleTime: 10 * DASHBOARD_STALE_MS,
  });
}
