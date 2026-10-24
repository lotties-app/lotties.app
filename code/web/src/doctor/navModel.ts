import { useLocation, useNavigate } from 'react-router-dom';
import { patientPath, sectionOfPath, type PatientSection } from './dashboardStorage';
import type { DoctorPatient } from './doctorApi';

/*
 * Navigation of the doctor's dashboard (docs/design/19-doctor-dashboard.md section 6): which item
 * a path shows, the patient of a path and the neighbours in the Patients order. Pure, except
 * `useSwitchPatient`.
 */

/** Width of the left rail on wide screens (the content starts after it). */
export const RAIL_WIDTH = 96;

/** Widest content column of the dashboard (wide screens show the summary in two columns). */
export const DASHBOARD_MAX_WIDTH = 1040;

export type NavKey = 'patients' | PatientSection;

/** `/doctor/<page>` paths that are hers, not a patient id: Settings, credits and the privacy policy. */
const ACCOUNT_PAGES: ReadonlySet<string> = new Set(['settings', 'credits', 'privacy']);

/** Which item the path shows: Patients on `/doctor`, a section under `/doctor/:babyId`. */
export function activeNavKey(pathname: string): NavKey | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'doctor') return null;
  if (parts.length === 1) return 'patients';
  if (ACCOUNT_PAGES.has(parts[1])) return null;
  return sectionOfPath(pathname);
}

/** The patient id of a `/doctor/:babyId/...` path, or `null` (Patients, Settings). */
export function patientIdOfPath(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'doctor' || parts.length < 2 || ACCOUNT_PAGES.has(parts[1])) return null;
  return decodeURIComponent(parts[1]);
}

/** The patients before and after `babyId` in `order` (wrapping around), or `null` alone. */
export function neighbours(
  order: readonly DoctorPatient[],
  babyId: string,
): { previous: DoctorPatient; next: DoctorPatient; index: number } | null {
  const index = order.findIndex((patient) => patient.babyId === babyId);
  if (index < 0 || order.length < 2) return null;
  return {
    previous: order[(index - 1 + order.length) % order.length],
    next: order[(index + 1) % order.length],
    index,
  };
}

/** Moves to another patient and keeps the section the doctor is looking at. */
export function useSwitchPatient() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const section = sectionOfPath(pathname);
  return (babyId: string) => navigate(patientPath(babyId, section));
}
