import { createContext, use } from 'react';
import type { Baby } from '../db/models';
import type { DoctorPatient } from './doctorApi';
import type { PatientSort } from './dashboardStorage';

export interface DoctorDashboard {
  /** The patients in the current sort order; `undefined` while the device list loads. */
  patients: DoctorPatient[] | undefined;
  sort: PatientSort;
  setSort: (sort: PatientSort) => void;
  /** The server's card data is loading for the first time. */
  loading: boolean;
  /** The last fetch of the card data failed (the device list is shown). */
  failed: boolean;
  online: boolean;
  refresh: () => void;
}

export const DoctorDashboardContext = createContext<DoctorDashboard | null>(null);

export function useDoctorDashboard(): DoctorDashboard {
  const value = use(DoctorDashboardContext);
  if (!value) throw new Error('useDoctorDashboard must be used within the DoctorShell');
  return value;
}

/** The patient of the current `/doctor/:babyId` route (a Doctor membership on the device). */
export const PatientContext = createContext<Baby | null>(null);

export function usePatientBaby(): Baby {
  const value = use(PatientContext);
  if (!value) throw new Error('usePatientBaby must be used within a patient route');
  return value;
}
