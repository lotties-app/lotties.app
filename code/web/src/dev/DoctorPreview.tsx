import { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import type { ApiClient, RequestOptions } from '../api/apiClient';
import { ApiClientContext } from '../api/ApiClientContext';
import { AuthContext, type AuthApi } from '../auth/AuthContext';
import { SelectedBabyProvider } from '../baby/SelectedBabyProvider';
import { createDatabase, type BabyRoutineDb } from '../db/database';
import { DatabaseProvider } from '../db/DatabaseProvider';
import type { Baby, BabyEvent, Note, PersonSummary } from '../db/models';
import { NoteComposer } from '../notes/NoteComposer';
import { NotesScreen } from '../notes/NotesScreen';
import { GrowthPage } from '../pages/GrowthPage';
import { DeclareToJoin } from '../pages/InvitePage';
import { PatientsScreen } from '../patients/PatientsScreen';
import { MembersSection } from '../settings/MembersSection';
import { ProfessionalSection } from '../settings/ProfessionalSection';
import { SyncEngine } from '../sync/SyncEngine';
import { SyncEngineContext } from '../sync/SyncEngineContext';
import { PREVIEW_TYPES } from './previewData';
import { PreviewToolbar } from './PreviewToolbar';

/*
 * Developer-only (route `/dev/doctor`, never in production builds): the doctor access screens
 * (docs/design/16-doctor-access.md) over a throw-away local database and an in-memory API, no
 * sign-in. `?state=profile` (Settings > I'm a healthcare professional), `accept` (a Doctor invite
 * asking for the profile), `members` (the Owner's members with the doctor, the invite picker and the
 * access log), `patients` (the doctor's Patients), `notes` (the doctor's notes), `composer` (a new
 * note), `family` (the parents reading the shared notes, one by a doctor no longer with access) and
 * `growth` (a consultation measurement, "Recorded by Dr.").
 */

const SCENARIOS = [
  'profile',
  'accept',
  'members',
  'patients',
  'notes',
  'composer',
  'family',
  'growth',
] as const;
type Scenario = (typeof SCENARIOS)[number];

const DOCTOR_ID = 'dev-doctor';
const OLD_DOCTOR_ID = 'dev-old-doctor';
const LIA = 'dev-doctor-lia';
const PROFILE = {
  kind: 'doctor' as const,
  displayName: 'Ana Souza',
  specialty: 'Pediatrics',
  registrationNumber: 'CRM-SP 123456',
  verified: false,
};
const ANA: PersonSummary = { userId: DOCTOR_ID, displayName: 'Ana Souza', professional: PROFILE };
const OLD: PersonSummary = {
  userId: OLD_DOCTOR_ID,
  displayName: 'Marcos Lima',
  professional: { ...PROFILE, displayName: 'Marcos Lima', registrationNumber: null },
};

const baby = (id: string, name: string, birthDate: string, role: Baby['role']): Baby => ({
  id,
  name,
  birthDate,
  role,
  userId: role === 'Doctor' ? DOCTOR_ID : 'dev-mom',
});

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();

const note = (id: string, hours: number, extra: Partial<Note>): Note => ({
  id,
  babyId: LIA,
  authorUserId: DOCTOR_ID,
  author: ANA,
  kind: 'note',
  visibility: 'shared',
  body: '',
  createdAt: hoursAgo(hours),
  updatedAt: hoursAgo(hours),
  clientUpdatedAt: hoursAgo(hours),
  deletedAt: null,
  ...extra,
});

const NOTES: Note[] = [
  note('dev-n1', 2, {
    kind: 'recommendation',
    body: 'Offer 120 ml every 3 hours during the day. Keep the night feeds on demand.\nWeigh again in 2 weeks.',
  }),
  note('dev-n2', 26, {
    body: 'Consultation of 2 months: weight and length on track. Vaccines up to date.',
  }),
  note('dev-n3', 30, {
    visibility: 'private',
    body: 'Mother mentioned colic in the evenings: check again next visit.',
  }),
  note('dev-n4', 24 * 20, {
    authorUserId: OLD_DOCTOR_ID,
    author: OLD,
    body: 'First visit: healthy newborn. Next visit at 1 month.',
  }),
];

const MEMBERS = [
  { userId: 'dev-mom', displayName: 'Carla', role: 'Owner', joinedAt: '2026-08-01T10:00:00Z' },
  { userId: 'dev-dad', displayName: 'Rui', role: 'Parent', joinedAt: '2026-08-02T10:00:00Z' },
  {
    userId: DOCTOR_ID,
    displayName: 'ana.s',
    role: 'Doctor',
    joinedAt: '2026-10-01T10:00:00Z',
    professional: PROFILE,
  },
];

const ACCESS_LOG = [hoursAgo(1), hoursAgo(5), hoursAgo(26)].map((at) => ({
  userId: DOCTOR_ID,
  person: ANA,
  role: 'Doctor',
  kind: 'view',
  at,
}));

const MEASUREMENTS = [
  {
    id: 'dev-m1',
    babyId: LIA,
    date: hoursAgo(26).slice(0, 10),
    weightKg: 5.42,
    heightCm: 58.5,
    headCircumferenceCm: 39.2,
    notes: null,
    createdBy: DOCTOR_ID,
    createdAt: hoursAgo(26),
    updatedAt: hoursAgo(26),
    recordedByDoctor: true,
    recordedBy: ANA,
  },
  {
    id: 'dev-m2',
    babyId: LIA,
    date: hoursAgo(24 * 15).slice(0, 10),
    weightKg: 5.0,
    heightCm: null,
    headCircumferenceCm: null,
    notes: 'Pharmacy scale',
    createdBy: 'dev-mom',
    createdAt: hoursAgo(24 * 15),
    updatedAt: hoursAgo(24 * 15),
    recordedByDoctor: false,
    recordedBy: null,
  },
  {
    id: 'dev-m3',
    babyId: LIA,
    date: hoursAgo(24 * 40).slice(0, 10),
    weightKg: 4.1,
    heightCm: 54,
    headCircumferenceCm: 37,
    notes: null,
    createdBy: OLD_DOCTOR_ID,
    createdAt: hoursAgo(24 * 40),
    updatedAt: hoursAgo(24 * 40),
    recordedByDoctor: true,
    recordedBy: OLD,
  },
];

function previewApi(): ApiClient {
  const answer = (path: string, options?: RequestOptions): unknown => {
    if (options?.method && options.method !== 'GET') return PROFILE;
    if (path.endsWith('/members')) return MEMBERS;
    if (path.endsWith('/invites')) return [];
    if (path.endsWith('/access-log')) return ACCESS_LOG;
    if (path.endsWith('/professional-profile')) return { ...PROFILE, userId: DOCTOR_ID };
    if (path.endsWith('/measurements')) return MEASUREMENTS;
    return [];
  };
  return {
    request: async <T,>(path: string, options?: RequestOptions) => answer(path, options) as T,
    requestWithMeta: async <T,>(path: string, options?: RequestOptions) => ({
      data: answer(path, options) as T,
      status: 200,
      headers: new Headers(),
    }),
  };
}

const AUTH: AuthApi = {
  user: { name: 'Preview' },
  accountId: 'dev|preview',
  isAuthenticated: true,
  isLoading: false,
  error: null,
  session: 'active',
  sessionEnded: false,
  login: async () => {},
  logout: async () => {},
  getAccessToken: async () => null,
  renewAccessToken: async () => null,
};

const roleOf = (scenario: Scenario): Baby['role'] =>
  scenario === 'family' || scenario === 'growth' || scenario === 'members' ? 'Owner' : 'Doctor';

function events(babyId: string, hours: number): BabyEvent[] {
  const startedAt = hoursAgo(hours);
  return [
    {
      id: `dev-doctor-ev-${babyId}`,
      babyId,
      typeId: PREVIEW_TYPES[0].id,
      startedAt,
      endedAt: startedAt,
      payload: {},
      notes: null,
      createdBy: 'dev-mom',
      createdAt: startedAt,
      updatedAt: startedAt,
      deletedAt: null,
    },
  ];
}

async function seed(db: BabyRoutineDb, scenario: Scenario): Promise<void> {
  await Promise.all([db.babies.clear(), db.events.clear(), db.notes.clear(), db.outbox.clear()]);
  const role = roleOf(scenario);
  await db.babies.put(baby(LIA, 'Lia', '2026-08-20', role));
  if (scenario === 'patients') {
    await db.babies.bulkPut([
      baby('dev-doctor-theo', 'Theo', '2026-04-11', 'Doctor'),
      baby('dev-doctor-maya', 'Maya', '2025-12-02', 'Doctor'),
    ]);
    await db.events.bulkPut([...events(LIA, 0.5), ...events('dev-doctor-theo', 5)]);
  }
  const visible = role === 'Doctor' ? NOTES : NOTES.filter((n) => n.visibility === 'shared');
  await db.notes.bulkPut(visible);
}

function Body({ scenario }: { scenario: Scenario }) {
  const [closed, setClosed] = useState(false);
  const lia = baby(LIA, 'Lia', '2026-08-20', roleOf(scenario));
  switch (scenario) {
    case 'profile':
      return <ProfessionalSection />;
    case 'accept':
      return <DeclareToJoin onDeclared={() => {}} />;
    case 'members':
      return <MembersSection baby={lia} />;
    case 'patients':
      return <PatientsScreen />;
    case 'growth':
      return <GrowthPage />;
    case 'composer':
      return (
        <>
          <NotesScreen baby={lia} />
          {!closed && (
            <NoteComposer babyId={LIA} authorUserId={DOCTOR_ID} onClose={() => setClosed(true)} />
          )}
        </>
      );
    default:
      return <NotesScreen baby={lia} />;
  }
}

/** Developer-only: the doctor access screens with seeded data (`/dev/doctor?state=notes`). */
export default function DoctorPreview() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('state');
  const scenario: Scenario = SCENARIOS.find((s) => s === requested) ?? 'notes';
  const [setup] = useState(() => {
    const db = createDatabase('dev-doctor-preview');
    const api = previewApi();
    return {
      db,
      api,
      engine: new SyncEngine({ db, api, locks: null, eventTarget: null }),
      queries: new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: Infinity } },
      }),
    };
  });
  const [ready, setReady] = useState<Scenario | null>(null);

  useEffect(() => {
    let live = true;
    void seed(setup.db, scenario).then(() => live && setReady(scenario));
    return () => {
      live = false;
    };
  }, [setup.db, scenario]);

  return (
    <AuthContext value={AUTH}>
      <ApiClientContext value={setup.api}>
        <QueryClientProvider client={setup.queries}>
          <DatabaseProvider db={setup.db}>
            <SyncEngineContext value={setup.engine}>
              <SelectedBabyProvider>
                <Box
                  sx={{ bgcolor: 'background.default', color: 'text.primary', minHeight: '100dvh' }}
                >
                  <Box
                    sx={{
                      maxWidth: 480,
                      mx: 'auto',
                      px: 2,
                      pt: 1,
                      pb: 12,
                      display: 'grid',
                      gap: 2,
                    }}
                  >
                    {(scenario === 'profile' || scenario === 'members') && (
                      <Typography variant="h5" component="h1" sx={{ py: 1 }}>
                        {scenario === 'members' ? 'Lia' : 'Lotties'}
                      </Typography>
                    )}
                    {ready === scenario && <Body key={scenario} scenario={scenario} />}
                    <PreviewToolbar
                      scenarios={SCENARIOS}
                      scenario={scenario}
                      onScenario={(next) => setParams({ state: next }, { replace: true })}
                    />
                  </Box>
                </Box>
              </SelectedBabyProvider>
            </SyncEngineContext>
          </DatabaseProvider>
        </QueryClientProvider>
      </ApiClientContext>
    </AuthContext>
  );
}
