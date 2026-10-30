import { Suspense } from 'react';
import { Route } from 'react-router-dom';
import {
  DoctorAboutPage,
  DoctorCreditsPage,
  DoctorPrivacyPage,
  DoctorSettingsPage,
  DoctorShell,
  PatientGrowth,
  PatientMedications,
  PatientNotes,
  PatientRoute,
  PatientsHome,
  PatientSummary,
  PatientTimeline,
} from './lazyPages';

/**
 * The `/doctor` route tree: Patients, Settings and the sections of one patient (`/doctor/:babyId`,
 * `/timeline`, `/growth`, `/medications`, `/notes`). A function returning the `<Route>` element so
 * the app and the developer preview mount the same tree.
 */
export function doctorRoutes() {
  return (
    <Route
      path="doctor"
      element={
        <Suspense fallback={null}>
          <DoctorShell />
        </Suspense>
      }
    >
      <Route index element={<PatientsHome />} />
      <Route path="settings" element={<DoctorSettingsPage />} />
      <Route path="credits" element={<DoctorCreditsPage />} />
      <Route path="about" element={<DoctorAboutPage />} />
      <Route path="privacy" element={<DoctorPrivacyPage />} />
      <Route path=":babyId" element={<PatientRoute />}>
        <Route index element={<PatientSummary />} />
        <Route path="timeline" element={<PatientTimeline />} />
        <Route path="growth" element={<PatientGrowth />} />
        <Route path="medications" element={<PatientMedications />} />
        <Route path="notes" element={<PatientNotes />} />
      </Route>
    </Route>
  );
}
