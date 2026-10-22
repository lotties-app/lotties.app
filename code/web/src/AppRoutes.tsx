import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { LandingGate } from './landing/LandingGate';
import { CallbackPage } from './auth/CallbackPage';
import { AppShell } from './layout/AppShell';
import { HomePage } from './pages/HomePage';
import { InviteEntry, LegacyInviteEntry } from './invite/InviteEntry';

// Everything except Now is split into route chunks so the first load stays small.
const DayPage = lazy(() => import('./pages/DayPage').then((m) => ({ default: m.DayPage })));
const InsightsPage = lazy(() =>
  import('./pages/InsightsPage').then((m) => ({ default: m.InsightsPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const InvitePage = lazy(() =>
  import('./pages/InvitePage').then((m) => ({ default: m.InvitePage })),
);
const AppointmentsPage = lazy(() =>
  import('./pages/AppointmentsPage').then((m) => ({ default: m.AppointmentsPage })),
);
const NotesPage = lazy(() => import('./pages/NotesPage').then((m) => ({ default: m.NotesPage })));
const PatientsPage = lazy(() =>
  import('./pages/PatientsPage').then((m) => ({ default: m.PatientsPage })),
);

/**
 * Developer UI gallery and Now preview: registered only in development. `import.meta.env.DEV` is a build-time
 * constant, so production builds drop the branch and the gallery chunk is never emitted.
 */
const DevUiGallery = import.meta.env.DEV ? lazy(() => import('./dev/UiGallery')) : null;
const DevNowPreview = import.meta.env.DEV ? lazy(() => import('./dev/NowPreview')) : null;
const DevDayPreview = import.meta.env.DEV ? lazy(() => import('./dev/DayPreview')) : null;
const DevRolesPreview = import.meta.env.DEV ? lazy(() => import('./dev/RolesPreview')) : null;
const DevSheetPreview = import.meta.env.DEV ? lazy(() => import('./dev/SheetPreview')) : null;
const DevMedsPreview = import.meta.env.DEV ? lazy(() => import('./dev/MedsPreview')) : null;
const DevLandingPreview = import.meta.env.DEV ? lazy(() => import('./dev/LandingPreview')) : null;
const DevNotificationsPreview = import.meta.env.DEV
  ? lazy(() => import('./dev/NotificationsPreview'))
  : null;
const DevInsightsPreview = import.meta.env.DEV ? lazy(() => import('./dev/InsightsPreview')) : null;
const DevFormulasPreview = import.meta.env.DEV ? lazy(() => import('./dev/FormulasPreview')) : null;
const DevAppointmentsPreview = import.meta.env.DEV
  ? lazy(() => import('./dev/AppointmentsPreview'))
  : null;
const DevDoctorPreview = import.meta.env.DEV ? lazy(() => import('./dev/DoctorPreview')) : null;
const DevIllustrationGallery = import.meta.env.DEV
  ? lazy(() => import('./dev/IllustrationGallery'))
  : null;
const DevRingPreview = import.meta.env.DEV ? lazy(() => import('./dev/RingPreview')) : null;

export function AppRoutes() {
  return (
    <Routes>
      {DevUiGallery && (
        <Route
          path="/dev/ui"
          element={
            <Suspense fallback={null}>
              <DevUiGallery />
            </Suspense>
          }
        />
      )}
      {DevNowPreview && (
        <Route
          path="/dev/now"
          element={
            <Suspense fallback={null}>
              <DevNowPreview />
            </Suspense>
          }
        />
      )}
      {DevDayPreview && (
        <Route
          path="/dev/day"
          element={
            <Suspense fallback={null}>
              <DevDayPreview />
            </Suspense>
          }
        />
      )}
      {DevSheetPreview && (
        <Route
          path="/dev/sheet"
          element={
            <Suspense fallback={null}>
              <DevSheetPreview />
            </Suspense>
          }
        />
      )}
      {DevMedsPreview && (
        <Route
          path="/dev/meds"
          element={
            <Suspense fallback={null}>
              <DevMedsPreview />
            </Suspense>
          }
        />
      )}
      {DevFormulasPreview && (
        <Route
          path="/dev/formulas"
          element={
            <Suspense fallback={null}>
              <DevFormulasPreview />
            </Suspense>
          }
        />
      )}
      {DevAppointmentsPreview && (
        <Route
          path="/dev/appointments"
          element={
            <Suspense fallback={null}>
              <DevAppointmentsPreview />
            </Suspense>
          }
        />
      )}
      {DevDoctorPreview && (
        <Route
          path="/dev/doctor"
          element={
            <Suspense fallback={null}>
              <DevDoctorPreview />
            </Suspense>
          }
        />
      )}
      {DevInsightsPreview && (
        <Route
          path="/dev/insights"
          element={
            <Suspense fallback={null}>
              <DevInsightsPreview />
            </Suspense>
          }
        />
      )}
      {DevIllustrationGallery && (
        <Route
          path="/dev/illustrations"
          element={
            <Suspense fallback={null}>
              <DevIllustrationGallery />
            </Suspense>
          }
        />
      )}
      {DevLandingPreview && (
        <Route
          path="/dev/landing"
          element={
            <Suspense fallback={null}>
              <DevLandingPreview />
            </Suspense>
          }
        />
      )}
      {DevRolesPreview && (
        <Route
          path="/dev/roles"
          element={
            <Suspense fallback={null}>
              <DevRolesPreview />
            </Suspense>
          }
        />
      )}
      {DevNotificationsPreview && (
        <Route
          path="/dev/notifications"
          element={
            <Suspense fallback={null}>
              <DevNotificationsPreview />
            </Suspense>
          }
        />
      )}
      {DevRingPreview && (
        <Route
          path="/dev/ring"
          element={
            <Suspense fallback={null}>
              <DevRingPreview />
            </Suspense>
          }
        />
      )}
      {/* The sign-in page is gone (the landing page and the identity provider replace it). */}
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/auth/callback" element={<CallbackPage />} />
      {/* Invite entry sits outside RequireAuth: the token is parked before any sign-in redirect. */}
      <Route path="/invite" element={<InviteEntry />}>
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<InvitePage />} />
          </Route>
        </Route>
      </Route>
      <Route path="/invite/:token" element={<LegacyInviteEntry />} />
      <Route element={<LandingGate />}>
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<HomePage />} />
            <Route path="day" element={<DayPage />} />
            <Route path="insights" element={<InsightsPage />} />
            {/* Old routes keep working: bookmarks and links from before the three-tab layout. */}
            <Route path="timeline" element={<Navigate to="/day" replace />} />
            <Route path="growth" element={<Navigate to="/insights" replace />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="appointments" element={<AppointmentsPage />} />
            <Route path="notes" element={<NotesPage />} />
            <Route path="patients" element={<PatientsPage />} />
          </Route>
        </Route>
      </Route>
    </Routes>
  );
}
