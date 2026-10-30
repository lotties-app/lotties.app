import { lazy } from 'react';

// The doctor's dashboard (docs/design/19-doctor-dashboard.md) is its own set of route chunks.
export const DoctorShell = lazy(() =>
  import('./DoctorShell').then((m) => ({ default: m.DoctorShell })),
);
export const PatientsHome = lazy(() =>
  import('./PatientsHome').then((m) => ({ default: m.PatientsHome })),
);
export const PatientRoute = lazy(() =>
  import('./PatientRoute').then((m) => ({ default: m.PatientRoute })),
);
export const PatientSummary = lazy(() =>
  import('./summary/PatientSummary').then((m) => ({ default: m.PatientSummary })),
);
export const PatientTimeline = lazy(() =>
  import('./PatientTimeline').then((m) => ({ default: m.PatientTimeline })),
);
export const PatientGrowth = lazy(() =>
  import('./PatientPages').then((m) => ({ default: m.PatientGrowth })),
);
export const PatientMedications = lazy(() =>
  import('./PatientPages').then((m) => ({ default: m.PatientMedications })),
);
export const PatientNotes = lazy(() =>
  import('./PatientPages').then((m) => ({ default: m.PatientNotes })),
);
export const DoctorSettingsPage = lazy(() =>
  import('./PatientPages').then((m) => ({ default: m.DoctorSettingsPage })),
);
export const DoctorCreditsPage = lazy(() =>
  import('./PatientPages').then((m) => ({ default: m.DoctorCreditsPage })),
);
export const DoctorAboutPage = lazy(() =>
  import('./PatientPages').then((m) => ({ default: m.DoctorAboutPage })),
);
export const DoctorPrivacyPage = lazy(() =>
  import('./PatientPages').then((m) => ({ default: m.DoctorPrivacyPage })),
);
