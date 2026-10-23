import { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { dayKeyOf } from '../appointments/calendarModel';
import { SelectedBabyContext, type SelectedBaby } from '../baby/SelectedBabyContext';
import { createDatabase, type BabyRoutineDb } from '../db/database';
import { DatabaseProvider } from '../db/DatabaseProvider';
import type { Baby, BabyEvent, BabyRole } from '../db/models';
import type { HubContext } from '../hub/hubEntries';
import { AboutScreen } from '../hub/AboutScreen';
import { HubScreen } from '../hub/HubScreen';
import { UpdatesScreen } from '../hub/UpdatesScreen';
import { resetHubPrefs } from '../hub/hubUsage';
import { AddSheetProvider } from '../layout/AddSheetProvider';
import { BottomNav } from '../layout/BottomNav';
import { NAV_CONTENT_PADDING } from '../layout/navMetrics';
import { ANA, DOCTOR_ID, proposal, recommendation } from '../proposals/proposalKit';
import { seedSchedule } from '../test/vaccineSchedule';
import { ApiClientContext } from '../api/ApiClientContext';
import { SyncEngine } from '../sync/SyncEngine';
import { SyncEngineContext } from '../sync/SyncEngineContext';
import { fakeApi } from '../test/fakeApi';
import { SettingsPage } from '../pages/SettingsPage';
import {
  HubBackupImportPage,
  HubCreditsPage,
  HubExportPage,
  HubImportPage,
  HubProvidersPage,
} from '../pages/HubSubPages';
import { RunningTimerPill } from '../timers/RunningTimerPill';
import { addDays } from '../vaccines/vaccineStatus';
import { PREVIEW_BABY_ID, PREVIEW_TYPES, typeIdOf } from './previewData';
import { PreviewToolbar } from './PreviewToolbar';

/*
 * Developer-only (route `/dev/hub`, never in production builds): the Hub (docs/design/21-hub.md)
 * with the floating dock and, in `timers`, the running-timer pill in the header, over a
 * throw-away local database. `?state=owner` (vaccines due, an appointment soon, a doctor
 * suggestion: every badge), `quiet` (nothing waits), `caregiver`, `viewer`, `doctor` (patients and
 * proposals), `timers` (a night sleep and tummy time running; the review script opens the pill), `updates`, `about`,
 * `settings`, `providers`, `import`, `export`, `backup` and `credits` (the pages opened from the Hub, in the page
 * column; the overflow audit visits them).
 * No sign-in, no server.
 */

const SCENARIOS = [
  'owner',
  'quiet',
  'caregiver',
  'viewer',
  'doctor',
  'timers',
  'updates',
  'about',
  'settings',
  'providers',
  'import',
  'export',
  'backup',
  'credits',
] as const;
/** Scenarios that show a page opened from the Hub instead of the Hub itself. */
const PAGES: readonly Scenario[] = [
  'updates',
  'about',
  'settings',
  'providers',
  'import',
  'export',
  'backup',
  'credits',
];
type Scenario = (typeof SCENARIOS)[number];

const MIN = 60_000;
const DAY = 86_400_000;

function babyOf(scenario: Scenario): Baby {
  const role: BabyRole =
    scenario === 'caregiver'
      ? 'Caregiver'
      : scenario === 'viewer'
        ? 'Viewer'
        : scenario === 'doctor'
          ? 'Doctor'
          : 'Owner';
  return {
    id: PREVIEW_BABY_ID,
    name: 'Lia',
    birthDate: addDays(dayKeyOf(Date.now()), -82),
    role,
    userId: scenario === 'doctor' ? DOCTOR_ID : 'dev-me',
  };
}

function running(key: string, minutesAgo: number, payload: BabyEvent['payload']): BabyEvent {
  const startedAt = new Date(Date.now() - minutesAgo * MIN).toISOString();
  return {
    id: `dev-hub-${key}`,
    babyId: PREVIEW_BABY_ID,
    typeId: typeIdOf(key),
    startedAt,
    endedAt: null,
    payload,
    notes: null,
    createdBy: null,
    createdAt: startedAt,
    updatedAt: startedAt,
    deletedAt: null,
  };
}

async function seed(db: BabyRoutineDb, scenario: Scenario): Promise<Baby> {
  const baby = babyOf(scenario);
  await Promise.all([
    db.babies.clear(),
    db.eventTypes.clear(),
    db.events.clear(),
    db.appointments.clear(),
    db.proposals.clear(),
    db.notes.clear(),
    db.noteReads.clear(),
    db.vaccinations.clear(),
    db.outbox.clear(),
  ]);
  await db.babies.put(baby);
  await db.eventTypes.bulkPut(PREVIEW_TYPES);
  if (['quiet', 'viewer', 'doctor'].includes(scenario) || PAGES.includes(scenario)) return baby;
  await seedSchedule(db);
  if (scenario === 'timers') {
    await db.events.bulkPut([
      running('sleep', 61, { kind: 'night' }),
      running('tummy_time', 4, {}),
    ]);
    return baby;
  }
  const soon = new Date(Date.now() + DAY).toISOString();
  await db.appointments.put({
    id: 'dev-hub-appointment',
    babyId: PREVIEW_BABY_ID,
    title: 'Pediatrician',
    type: 'consultation',
    startsAt: soon,
    durationMinutes: 30,
    location: null,
    doctorName: null,
    notes: null,
    outcome: null,
    status: 'upcoming',
    reminderOffsetsMinutes: [],
    createdBy: null,
    createdAt: soon,
    updatedAt: soon,
  });
  if (scenario === 'owner') {
    await db.proposals.put({
      ...proposal('dev-hub-proposal', { babyId: PREVIEW_BABY_ID, author: ANA }),
    });
    await db.notes.put({ ...recommendation('dev-hub-note', { babyId: PREVIEW_BABY_ID }) });
  }
  return baby;
}

/** Developer-only: the Hub and the dock with seeded local data (route `/dev/hub?state=owner`). */
export default function HubPreview() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('state');
  const scenario: Scenario = SCENARIOS.find((s) => s === requested) ?? 'owner';
  const [db] = useState(() => createDatabase('dev-hub-preview'));
  // The Settings page reads the sync engine and the API: an idle engine over an in-memory API.
  const [api] = useState(() => fakeApi().api);
  const [engine] = useState(() => new SyncEngine({ db, api, locks: null, eventTarget: null }));
  const [ready, setReady] = useState<{ scenario: Scenario; baby: Baby } | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      window.localStorage.removeItem('lotties.hub.v1');
      resetHubPrefs();
      const baby = await seed(db, scenario);
      if (live) setReady({ scenario, baby });
    })();
    return () => {
      live = false;
    };
  }, [db, scenario]);

  const baby = ready?.scenario === scenario ? ready.baby : undefined;
  const context: HubContext | undefined = baby && {
    baby,
    hasPatients: scenario === 'doctor',
    hasDoctorContent: scenario === 'owner',
    native: false,
  };
  const selected: SelectedBaby = {
    babies: baby ? [baby] : undefined,
    baby,
    select: () => undefined,
  };
  return (
    <DatabaseProvider db={db}>
      <ApiClientContext value={api}>
        <SyncEngineContext value={engine}>
          <SelectedBabyContext value={selected}>
            <AddSheetProvider enabled={!!baby && baby.role !== 'Viewer' && baby.role !== 'Doctor'}>
              <Box
                sx={{ bgcolor: 'background.default', color: 'text.primary', minHeight: '100dvh' }}
              >
                <Box sx={{ maxWidth: 480, mx: 'auto', px: 2, pt: 1, pb: NAV_CONTENT_PADDING }}>
                  <Box
                    component="header"
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      py: 1,
                    }}
                  >
                    <Box component="p" sx={{ m: 0, typography: 'h5' }}>
                      Lia
                    </Box>
                    {baby && <RunningTimerPill key={scenario} baby={baby} />}
                  </Box>
                  {context && scenario === 'updates' && <UpdatesScreen />}
                  {context && scenario === 'about' && <AboutScreen />}
                  {context && scenario === 'settings' && <SettingsPage />}
                  {context && scenario === 'providers' && <HubProvidersPage />}
                  {context && scenario === 'import' && <HubImportPage />}
                  {context && scenario === 'export' && <HubExportPage />}
                  {context && scenario === 'backup' && <HubBackupImportPage />}
                  {context && scenario === 'credits' && <HubCreditsPage />}
                  {context && !PAGES.includes(scenario) && (
                    <HubScreen key={scenario} context={context} />
                  )}
                  <PreviewToolbar
                    scenarios={SCENARIOS}
                    scenario={scenario}
                    onScenario={(next) => setParams({ state: next }, { replace: true })}
                  />
                </Box>
                <BottomNav />
              </Box>
            </AddSheetProvider>
          </SelectedBabyContext>
        </SyncEngineContext>
      </ApiClientContext>
    </DatabaseProvider>
  );
}
