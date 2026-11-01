import type { Baby } from '../db/models';
import type { AppMode } from './dashboardStorage';

/*
 * Which app a user sees (docs/design/19-doctor-dashboard.md section 3): the parents' app for the
 * babies they care for, the doctor's dashboard for the babies they follow as their Doctor. A user
 * with only Doctor memberships always lands on the dashboard; a user with both switches in the
 * account menu ("My babies" / "My patients"), remembered on the device.
 */

/** The babies the user cares for (every role but Doctor): the parents' app shows only these. */
export const familyBabies = (babies: readonly Baby[]): Baby[] =>
  babies.filter((baby) => baby.role !== 'Doctor');

export const hasPatients = (babies: readonly Baby[] | undefined): boolean =>
  !!babies && babies.some((baby) => baby.role === 'Doctor');

/** Every baby of the user is a Doctor membership (no baby of her own). */
export function isDoctorOnly(babies: readonly Baby[] | undefined): boolean {
  return !!babies && babies.length > 0 && babies.every((baby) => baby.role === 'Doctor');
}

/** Both apps apply: the account menu offers the mode switch. */
export const hasBothModes = (babies: readonly Baby[] | undefined): boolean =>
  hasPatients(babies) && familyBabies(babies ?? []).length > 0;

/** Whether `/` opens the doctor's dashboard instead of the parents' Now. */
export function landsOnDashboard(babies: readonly Baby[] | undefined, mode: AppMode | null) {
  return isDoctorOnly(babies) || (hasPatients(babies) && mode === 'patients');
}
