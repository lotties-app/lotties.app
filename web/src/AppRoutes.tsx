import { lazy } from 'react';
import { Route, Routes } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { LoginPage } from './auth/LoginPage';
import { CallbackPage } from './auth/CallbackPage';
import { AppShell } from './layout/AppShell';
import { HomePage } from './pages/HomePage';
import { InviteEntry, LegacyInviteEntry } from './invite/InviteEntry';

// Everything except Home is split into route chunks so the first load stays small.
const TimelinePage = lazy(() =>
  import('./pages/TimelinePage').then((m) => ({ default: m.TimelinePage })),
);
const GrowthPage = lazy(() =>
  import('./pages/GrowthPage').then((m) => ({ default: m.GrowthPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const InvitePage = lazy(() =>
  import('./pages/InvitePage').then((m) => ({ default: m.InvitePage })),
);

export function AppRoutes() {
  return (
    <Routes>
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
          <Route path="timeline" element={<TimelinePage />} />
          <Route path="growth" element={<GrowthPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
