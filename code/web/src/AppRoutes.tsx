import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { RequireAuth } from './auth/RequireAuth';
import { ConsentGate } from './consent/ConsentGate';
import { LandingGate } from './landing/LandingGate';
import { WelcomeRoute } from './landing/WelcomeRoute';
import { CallbackPage } from './auth/CallbackPage';
import { AppShell } from './layout/AppShell';
import { HomePage } from './pages/HomePage';
import { InviteEntry, LegacyInviteEntry } from './invite/InviteEntry';
import { doctorRoutes } from './doctor/doctorRoutes';

// Everything except Now is split into route chunks so the first load stays small.
const DayPage = lazy(() => import('./pages/DayPage').then((m) => ({ default: m.DayPage })));
const InsightsPage = lazy(() =>
  import('./pages/InsightsPage').then((m) => ({ default: m.InsightsPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const HubPage = lazy(() => import('./pages/HubPage').then((m) => ({ default: m.HubPage })));
type HubSubPageName = Exclude<keyof typeof import('./pages/HubSubPages'), never>;
const hubSubPage = (name: HubSubPageName) =>
  lazy(() => import('./pages/HubSubPages').then((m) => ({ default: m[name] })));
const HubMedicinesPage = hubSubPage('HubMedicinesPage');
const HubFormulasPage = hubSubPage('HubFormulasPage');
const HubProvidersPage = hubSubPage('HubProvidersPage');
const HubFamilyPage = hubSubPage('HubFamilyPage');
const HubImportPage = hubSubPage('HubImportPage');
const HubExportPage = hubSubPage('HubExportPage');
const HubBackupImportPage = hubSubPage('HubBackupImportPage');
const HubUpdatesPage = hubSubPage('HubUpdatesPage');
const HubAboutPage = hubSubPage('HubAboutPage');
const HubCreditsPage = hubSubPage('HubCreditsPage');
const HubVoiceCommandsPage = hubSubPage('HubVoiceCommandsPage');
const HubInstallPage = hubSubPage('HubInstallPage');
const HubPrivacyPage = hubSubPage('HubPrivacyPage');
const HubDataLocationPage = hubSubPage('HubDataLocationPage');
const HubOwnDatabaseHelpPage = hubSubPage('HubOwnDatabaseHelpPage');
// The cry monitor's page is its own chunk; the engine loads only when monitoring starts.
const HubCryMonitorPage = lazy(() => import('./cryMonitor/CryMonitorPage'));
// The public credits, install, privacy and voice commands pages: outside the auth gate, so they
// open without signing in.
const CreditsPage = lazy(() => import('./credits/CreditsPage'));
const InstallPage = lazy(() => import('./install/InstallPage'));
const PrivacyPage = lazy(() => import('./legal/PrivacyPage'));
const SelfHostPage = lazy(() => import('./selfHost/SelfHostPage'));
const TermsPage = lazy(() => import('./legal/TermsPage'));
const VoiceCommandsPage = lazy(() => import('./assistants/VoiceCommandsPage'));
const InvitePage = lazy(() =>
  import('./pages/InvitePage').then((m) => ({ default: m.InvitePage })),
);
const AppointmentsPage = lazy(() =>
  import('./pages/AppointmentsPage').then((m) => ({ default: m.AppointmentsPage })),
);
const VaccinesPage = lazy(() =>
  import('./pages/VaccinesPage').then((m) => ({ default: m.VaccinesPage })),
);
const VaccinationCardPage = lazy(() =>
  import('./pages/VaccinationCardPage').then((m) => ({ default: m.VaccinationCardPage })),
);
const NotesPage = lazy(() => import('./pages/NotesPage').then((m) => ({ default: m.NotesPage })));
const ProposalsPage = lazy(() =>
  import('./pages/ProposalsPage').then((m) => ({ default: m.ProposalsPage })),
);
const FromDoctorPage = lazy(() =>
  import('./pages/FromDoctorPage').then((m) => ({ default: m.FromDoctorPage })),
);
// The project board: its own frame outside the parents' shell (no baby data near it), online only.
const BoardPage = lazy(() => import('./board/BoardPage'));

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
const DevVaccinesPreview = import.meta.env.DEV ? lazy(() => import('./dev/VaccinesPreview')) : null;
const DevDoctorPreview = import.meta.env.DEV ? lazy(() => import('./dev/DoctorPreview')) : null;
const DevDoctorDashboardPreview = import.meta.env.DEV
  ? lazy(() => import('./dev/DoctorDashboardPreview'))
  : null;
const DevProposalsPreview = import.meta.env.DEV
  ? lazy(() => import('./dev/ProposalsPreview'))
  : null;
const DevIllustrationGallery = import.meta.env.DEV
  ? lazy(() => import('./dev/IllustrationGallery'))
  : null;
const DevRingPreview = import.meta.env.DEV ? lazy(() => import('./dev/RingPreview')) : null;
const DevHubPreview = import.meta.env.DEV ? lazy(() => import('./dev/HubPreview')) : null;
const DevCryMonitorPreview = import.meta.env.DEV
  ? lazy(() => import('./dev/CryMonitorPreview'))
  : null;
const DevBoardPreview = import.meta.env.DEV ? lazy(() => import('./dev/BoardPreview')) : null;
const DevDataLocationPreview = import.meta.env.DEV
  ? lazy(() => import('./dev/DataLocationPreview'))
  : null;

export function AppRoutes() {
  const { pathname } = useLocation();
  // The dashboard preview mounts the real `/doctor` route tree at a fixed location, which a nested
  // <Routes> cannot do: it is rendered instead of the app's routes.
  if (DevDoctorDashboardPreview && pathname === '/dev/doctor-dashboard') {
    return (
      <Suspense fallback={null}>
        <DevDoctorDashboardPreview />
      </Suspense>
    );
  }
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
      {DevDataLocationPreview && (
        <Route
          path="/dev/data-location"
          element={
            <Suspense fallback={null}>
              <DevDataLocationPreview />
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
      {DevVaccinesPreview && (
        <Route
          path="/dev/vaccines"
          element={
            <Suspense fallback={null}>
              <DevVaccinesPreview />
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
      {DevProposalsPreview && (
        <Route
          path="/dev/proposals"
          element={
            <Suspense fallback={null}>
              <DevProposalsPreview />
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
      {DevHubPreview && (
        <Route
          path="/dev/hub"
          element={
            <Suspense fallback={null}>
              <DevHubPreview />
            </Suspense>
          }
        />
      )}
      {DevCryMonitorPreview && (
        <Route
          path="/dev/cry-monitor"
          element={
            <Suspense fallback={null}>
              <DevCryMonitorPreview />
            </Suspense>
          }
        />
      )}
      {DevBoardPreview && (
        <Route
          path="/dev/board/:itemId?"
          element={
            <Suspense fallback={null}>
              <DevBoardPreview />
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
      <Route
        path="/credits"
        element={
          <Suspense fallback={null}>
            <CreditsPage />
          </Suspense>
        }
      />
      <Route
        path="/install"
        element={
          <Suspense fallback={null}>
            <InstallPage />
          </Suspense>
        }
      />
      <Route
        path="/self-host"
        element={
          <Suspense fallback={null}>
            <SelfHostPage />
          </Suspense>
        }
      />
      <Route
        path="/voice-commands"
        element={
          <Suspense fallback={null}>
            <VoiceCommandsPage />
          </Suspense>
        }
      />
      <Route
        path="/privacy"
        element={
          <Suspense fallback={null}>
            <PrivacyPage />
          </Suspense>
        }
      />
      <Route
        path="/terms"
        element={
          <Suspense fallback={null}>
            <TermsPage />
          </Suspense>
        }
      />
      {/* The landing page on purpose for a signed-in person; `/` keeps opening the app. */}
      <Route path="/welcome" element={<WelcomeRoute />} />
      {/* Invite entry sits outside RequireAuth: the token is parked before any sign-in redirect. */}
      <Route path="/invite" element={<InviteEntry />}>
        <Route element={<RequireAuth />}>
          <Route element={<ConsentGate />}>
            <Route element={<AppShell />}>
              <Route index element={<InvitePage />} />
            </Route>
          </Route>
        </Route>
      </Route>
      <Route path="/invite/:token" element={<LegacyInviteEntry />} />
      <Route element={<LandingGate />}>
        <Route element={<RequireAuth />}>
          {/* Everything about a baby needs a current consent: the gate shows the consent screen until it is given. */}
          <Route element={<ConsentGate />}>
            <Route element={<AppShell />}>
              <Route index element={<HomePage />} />
              <Route path="day" element={<DayPage />} />
              <Route path="insights" element={<InsightsPage />} />
              {/* Old routes keep working: bookmarks and links from before the three-tab layout. */}
              <Route path="timeline" element={<Navigate to="/day" replace />} />
              <Route path="growth" element={<Navigate to="/insights" replace />} />
              <Route path="hub" element={<HubPage />} />
              <Route path="hub/medicines" element={<HubMedicinesPage />} />
              <Route path="hub/formulas" element={<HubFormulasPage />} />
              <Route path="hub/providers" element={<HubProvidersPage />} />
              <Route path="hub/family" element={<HubFamilyPage />} />
              <Route path="hub/import" element={<HubImportPage />} />
              <Route path="hub/export" element={<HubExportPage />} />
              <Route path="hub/backup" element={<HubBackupImportPage />} />
              <Route path="hub/cry-monitor" element={<HubCryMonitorPage />} />
              <Route path="hub/updates" element={<HubUpdatesPage />} />
              <Route path="hub/about" element={<HubAboutPage />} />
              <Route path="hub/credits" element={<HubCreditsPage />} />
              <Route path="hub/install" element={<HubInstallPage />} />
              <Route path="hub/privacy" element={<HubPrivacyPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="settings/voice-commands" element={<HubVoiceCommandsPage />} />
              <Route path="settings/data-location" element={<HubDataLocationPage />} />
              <Route path="help/own-database" element={<HubOwnDatabaseHelpPage />} />
              <Route path="appointments" element={<AppointmentsPage />} />
              <Route path="vaccines" element={<VaccinesPage />} />
              <Route path="vaccines/card" element={<VaccinationCardPage />} />
              <Route path="notes" element={<NotesPage />} />
              {/* The old Patients list is the doctor's dashboard now. */}
              <Route path="patients" element={<Navigate to="/doctor" replace />} />
              <Route path="proposals" element={<ProposalsPage />} />
              <Route path="from-doctor" element={<FromDoctorPage />} />
            </Route>
            {doctorRoutes()}
          </Route>
          {/* `/hub/board` and `/hub/board/<item id>` (the drawer): one route, the page stays mounted. The project board is internal tracking, never baby data: no consent needed. */}
          <Route
            path="hub/board/:itemId?"
            element={
              <Suspense fallback={null}>
                <BoardPage />
              </Suspense>
            }
          />
        </Route>
      </Route>
    </Routes>
  );
}
