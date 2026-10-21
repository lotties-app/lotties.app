import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { LoginPage } from './auth/LoginPage';
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

/**
 * Developer UI gallery and Now preview: registered only in development. `import.meta.env.DEV` is a build-time
 * constant, so production builds drop the branch and the gallery chunk is never emitted.
 */
const DevUiGallery = import.meta.env.DEV ? lazy(() => import('./dev/UiGallery')) : null;
const DevNowPreview = import.meta.env.DEV ? lazy(() => import('./dev/NowPreview')) : null;
const DevDayPreview = import.meta.env.DEV ? lazy(() => import('./dev/DayPreview')) : null;
const DevSheetPreview = import.meta.env.DEV ? lazy(() => import('./dev/SheetPreview')) : null;
const DevMedsPreview = import.meta.env.DEV ? lazy(() => import('./dev/MedsPreview')) : null;
const DevIllustrationGallery = import.meta.env.DEV
  ? lazy(() => import('./dev/IllustrationGallery'))
  : null;

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
      <Route path="/login" element={<LoginPage />} />
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
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="day" element={<DayPage />} />
          <Route path="insights" element={<InsightsPage />} />
          {/* Old routes keep working: bookmarks and links from before the three-tab layout. */}
          <Route path="timeline" element={<Navigate to="/day" replace />} />
          <Route path="growth" element={<Navigate to="/insights" replace />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
