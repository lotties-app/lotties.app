import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Box, CircularProgress, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { SelectedBabyProvider } from '../baby/SelectedBabyProvider';
import { ErrorBoundary } from '../layout/ErrorBoundary';
import { NAV_CONTENT_PADDING } from '../layout/navMetrics';
import { SessionBanner } from '../layout/SessionBanner';
import { SyncIconButton } from '../layout/SyncIconButton';
import { UserMenu } from '../layout/UserMenu';
import { useSyncEngine } from '../sync/SyncEngineContext';
import { RejectedChangeSnackbar } from '../sync/RejectedChangeSnackbar';
import {
  forgetPatients,
  patientPath,
  readDashboardState,
  sectionOfPath,
  writeAppMode,
  writePatientSort,
  type PatientSort,
} from './dashboardStorage';
import type { DoctorPatient } from './doctorApi';
import { DoctorDashboardContext } from './DoctorDashboardContext';
import { DoctorNav } from './DoctorNav';
import { DASHBOARD_MAX_WIDTH, neighbours, patientIdOfPath, RAIL_WIDTH } from './navModel';
import { PatientSwitcher } from './PatientSwitcher';
import { sameScopes, scopesOf, type DoctorScope } from './scopes';
import { sortPatients, useDoctorBabies, usePatients } from './useDoctorData';

/**
 * Keeps the device in step with what each family shares: when a patient's sections change (the
 * sync saw new scopes), the cached answers of that patient are dropped, so nothing of a revoked
 * section stays on screen; when the server's patient list already shows other sections than the
 * device, a sync runs at once to purge (and fetch) accordingly.
 */
function useScopeWatch(serverScopes: ReadonlyMap<string, readonly DoctorScope[]>) {
  const babies = useDoctorBabies();
  const queryClient = useQueryClient();
  const engine = useSyncEngine();
  const seen = useRef(new Map<string, string>());
  const asked = useRef(false);

  useEffect(() => {
    for (const baby of babies ?? []) {
      const key = scopesOf(baby).join(',');
      const before = seen.current.get(baby.id);
      if (before !== undefined && before !== key) {
        queryClient.removeQueries({
          predicate: (query) => query.queryKey[0] === 'doctor' && query.queryKey.includes(baby.id),
        });
      }
      seen.current.set(baby.id, key);
    }
    if (babies) forgetPatients(new Set(babies.map((baby) => baby.id)));
  }, [babies, queryClient]);

  useEffect(() => {
    if (asked.current || !babies) return;
    const stale = babies.some((baby) => {
      const server = serverScopes.get(baby.id);
      return server !== undefined && !sameScopes(scopesOf(baby), server);
    });
    if (stale) {
      asked.current = true;
      void engine.syncNow();
    }
  }, [babies, serverScopes, engine]);
}

/** `[` and `]` move to the previous and next patient (not while typing or with a dialog open). */
function usePatientShortcuts(
  patientId: string | null,
  patients: readonly DoctorPatient[] | undefined,
  move: (babyId: string) => void,
) {
  const moveRef = useRef(move);
  useEffect(() => {
    moveRef.current = move;
  });
  useEffect(() => {
    if (!patientId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '[' && event.key !== ']') return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) {
        return;
      }
      const around = neighbours(patients ?? [], patientId);
      if (!around) return;
      event.preventDefault();
      moveRef.current(event.key === '[' ? around.previous.babyId : around.next.babyId);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [patientId, patients]);
}

function ShellBody() {
  const { t } = useTranslation();
  const theme = useTheme();
  const rail = useMediaQuery(theme.breakpoints.up('md'));
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const babies = useDoctorBabies();
  const { patients, query, online } = usePatients();
  const [sort, setSortState] = useState<PatientSort>(() => readDashboardState().sort);
  const sorted = useMemo(
    () => (patients ? sortPatients(patients, sort) : undefined),
    [patients, sort],
  );
  const patientId = patientIdOfPath(pathname);
  const patient = patientId ? babies?.find((baby) => baby.id === patientId) : undefined;
  const lastPatient = readDashboardState().lastPatient;
  const navPatient =
    patientId ?? (babies?.some((baby) => baby.id === lastPatient) ? lastPatient : null);
  const serverScopes = useMemo(
    () => new Map((query.data ?? []).map((p) => [p.babyId, p.scopes])),
    [query.data],
  );
  useScopeWatch(serverScopes);
  const section = sectionOfPath(pathname);
  usePatientShortcuts(patientId, sorted, (babyId) => navigate(patientPath(babyId, section)));

  useEffect(() => {
    // Opening the dashboard is choosing the doctor's mode on this device.
    writeAppMode('patients');
  }, []);

  const setSort = (next: PatientSort) => {
    writePatientSort(next);
    setSortState(next);
  };

  return (
    <DoctorDashboardContext
      value={{
        patients: sorted,
        sort,
        setSort,
        loading: query.isPending && online,
        failed: query.isError,
        online,
        refresh: () => void query.refetch(),
      }}
    >
      <Box
        sx={{
          minHeight: '100dvh',
          bgcolor: 'background.default',
          pl: rail ? `${RAIL_WIDTH}px` : 'env(safe-area-inset-left)',
          pr: 'env(safe-area-inset-right)',
        }}
      >
        <Box
          sx={{
            minHeight: '100dvh',
            display: 'flex',
            flexDirection: 'column',
            maxWidth: DASHBOARD_MAX_WIDTH,
            mx: 'auto',
          }}
        >
          <Stack
            component="header"
            direction="row"
            spacing={0.5}
            sx={{
              alignItems: 'center',
              px: rail ? 3 : 1,
              pt: 'calc(env(safe-area-inset-top) + 8px)',
              pb: 1,
            }}
          >
            {patient ? (
              <PatientSwitcher baby={patient} />
            ) : (
              <Typography variant="h5" component="p" sx={{ flexGrow: 1, px: 1 }} noWrap>
                {t('doctorDashboard.title')}
              </Typography>
            )}
            <SyncIconButton to="/doctor/settings#sync" />
            <UserMenu />
          </Stack>
          <SessionBanner />
          <Box
            component="main"
            sx={{
              flexGrow: 1,
              px: rail ? 3 : 2,
              py: 1,
              pb: rail ? 6 : NAV_CONTENT_PADDING,
              minWidth: 0,
            }}
          >
            <ErrorBoundary resetKey={pathname}>
              <Suspense fallback={<CircularProgress aria-label={t('app.loadingPage')} />}>
                <Outlet />
              </Suspense>
            </ErrorBoundary>
          </Box>
        </Box>
        <DoctorNav patientId={navPatient} rail={rail} />
        <RejectedChangeSnackbar />
      </Box>
    </DoctorDashboardContext>
  );
}

/**
 * The doctor's dashboard (route prefix `/doctor`, docs/design/19-doctor-dashboard.md): its own
 * header (the patient switcher), its own navigation (bottom pill on phones, left rail on wide
 * screens) and no logging controls. The parents' shell never shows a baby the user follows as its
 * Doctor.
 */
export function DoctorShell() {
  return (
    <SelectedBabyProvider>
      <ShellBody />
    </SelectedBabyProvider>
  );
}
