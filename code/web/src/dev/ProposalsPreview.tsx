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
import type {
  Baby,
  BabyEvent,
  Medication,
  Note,
  PersonSummary,
  Prescription,
  PrescriptionOriginal,
  Proposal,
} from '../db/models';
import { NowScreen } from '../now/ui/NowScreen';
import { PrescriptionSheet } from '../medications/PrescriptionSheet';
import { OriginalSheet } from '../proposals/Provenance';
import { FromDoctorScreen } from '../proposals/FromDoctorScreen';
import { ProposalDetailsSheet } from '../proposals/ProposalDetailsSheet';
import { ProposalsScreen } from '../proposals/ProposalsScreen';
import { SyncEngine } from '../sync/SyncEngine';
import { SyncEngineContext } from '../sync/SyncEngineContext';
import { PreviewToolbar } from './PreviewToolbar';
import { PREVIEW_TYPES, typeIdOf } from './previewData';

/*
 * Developer-only (route `/dev/proposals`, never in production builds): the doctor's prescription
 * proposals (docs/design/16-doctor-access.md section 10) over a throw-away local database and an
 * in-memory API, no sign-in. `?state=prescribe` (the Doctor's blank sheet), `change` (propose a
 * change, prefilled), `proposals` (her list with every status), `inbox` (the parents' Now cards),
 * `details` (a suggestion that replaces a prescription), `declining` (the same with the reason
 * field), `fromDoctor` (the page), `provenance` (Now with doctor-sourced prescriptions; open the Meds
 * tile), `original` (what the doctor prescribed, read-only) and `verified` (a verified and a
 * self-declared doctor side by side).
 */

const SCENARIOS = [
  'prescribe',
  'change',
  'proposals',
  'inbox',
  'details',
  'declining',
  'fromDoctor',
  'provenance',
  'original',
  'verified',
] as const;
type Scenario = (typeof SCENARIOS)[number];

const LIA = 'dev-proposals-lia';
const DOCTOR_ID = 'dev-ana';
const OTHER_ID = 'dev-marcos';
const MOM = 'dev-mom';

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const dayKey = (daysAgo: number) => hoursAgo(daysAgo * 24).slice(0, 10);

const PROFILE = {
  kind: 'doctor' as const,
  displayName: 'Ana Souza',
  specialty: 'Pediatrics',
  registrationNumber: 'CRM-SP 123456',
  verified: false,
};
const ANA: PersonSummary = { userId: DOCTOR_ID, displayName: 'Ana Souza', professional: PROFILE };
const ANA_VERIFIED: PersonSummary = {
  ...ANA,
  professional: { ...PROFILE, verified: true },
};
const MARCOS: PersonSummary = {
  userId: OTHER_ID,
  displayName: 'Marcos Lima',
  professional: { ...PROFILE, displayName: 'Marcos Lima', registrationNumber: null },
};

const isDoctorScenario = (s: Scenario) => s === 'prescribe' || s === 'change' || s === 'proposals';
const babyFor = (scenario: Scenario): Baby => ({
  id: LIA,
  name: 'Lia',
  birthDate: '2026-08-20',
  role: isDoctorScenario(scenario) ? 'Doctor' : 'Owner',
  userId: isDoctorScenario(scenario) ? DOCTOR_ID : MOM,
});

const MEDICATIONS: Medication[] = [
  ['dev-m-colidis', 'Colidis', true, { amount: 5, unit: 'drops' }],
  ['dev-m-vitd', 'Vitamin D', true, { amount: 1, unit: 'drop' }],
  ['dev-m-para', 'Paracetamol', false, { amount: 2.5, unit: 'ml' }],
].map(([id, name, isUsual, defaultDosage]) => ({
  id: id as string,
  babyId: LIA,
  name: name as string,
  defaultDosage: defaultDosage as Medication['defaultDosage'],
  notes: null,
  isUsual: isUsual as boolean,
  createdAt: '2026-10-01T00:00:00.000Z',
}));

const colicOriginal: PrescriptionOriginal = {
  medicationName: 'Colidis',
  productId: null,
  kind: 'asNeeded',
  dose: { amount: 5, unit: 'drops', perKg: false, roundingStep: null },
  timesOfDay: null,
  everyMinutes: null,
  dayParts: null,
  dayPartReminders: null,
  minIntervalMinutes: 480,
  maxDosesPer24h: 3,
  indication: 'belly pain',
  intervalGroup: null,
  startDate: dayKey(20),
  endDate: null,
  instructions: 'Give it after a feed. Call me if the pain lasts more than two days.',
};

const prescription = (
  id: string,
  medicationId: string,
  extra: Partial<Prescription>,
): Prescription => ({
  id,
  babyId: LIA,
  medicationId,
  status: 'active',
  kind: 'asNeeded',
  dose: { amount: 5, unit: 'drops', perKg: false, roundingStep: null },
  timesOfDay: null,
  everyMinutes: null,
  dayParts: null,
  dayPartReminders: null,
  minIntervalMinutes: 480,
  maxDosesPer24h: null,
  indication: null,
  intervalGroup: null,
  startDate: dayKey(20),
  endDate: null,
  prescriber: null,
  instructions: null,
  createdBy: MOM,
  createdAt: hoursAgo(24 * 20),
  updatedAt: hoursAgo(24 * 20),
  clientUpdatedAt: hoursAgo(24 * 20),
  deletedAt: null,
  ...extra,
});

function prescriptions(scenario: Scenario): Prescription[] {
  const verified = scenario === 'verified';
  return [
    prescription('dev-rx-colic', 'dev-m-colidis', {
      ...colicOriginal,
      status: 'active',
      prescriber: 'Ana Souza',
      prescribedByUserId: DOCTOR_ID,
      prescribedByName: 'Ana Souza',
      prescribedBy: verified ? ANA_VERIFIED : ANA,
      proposalId: 'dev-p-old',
      changedByParent: false,
      original: colicOriginal,
    }),
    prescription('dev-rx-vitd', 'dev-m-vitd', {
      kind: 'scheduled',
      dose: { amount: 2, unit: 'drops', perKg: false, roundingStep: null },
      dayParts: ['morning'],
      minIntervalMinutes: null,
      prescriber: 'Ana Souza',
      prescribedByUserId: DOCTOR_ID,
      prescribedByName: 'Ana Souza',
      prescribedBy: ANA,
      proposalId: 'dev-p-vitd',
      changedByParent: true,
      original: {
        ...colicOriginal,
        medicationName: 'Vitamin D',
        kind: 'scheduled',
        dose: { amount: 1, unit: 'drop', perKg: false, roundingStep: null },
        dayParts: ['morning'],
        minIntervalMinutes: null,
        maxDosesPer24h: null,
        indication: null,
        instructions: 'One drop every morning, with the first feed.',
      },
    }),
    prescription('dev-rx-para', 'dev-m-para', {
      dose: { amount: 2.5, unit: 'ml', perKg: false, roundingStep: null },
      indication: 'fever',
      prescriber: 'Pediatric urgent care',
    }),
  ];
}

const proposal = (id: string, hours: number, extra: Partial<Proposal>): Proposal => ({
  id,
  babyId: LIA,
  authorUserId: DOCTOR_ID,
  author: ANA,
  medicationId: null,
  productId: null,
  medicationName: 'Colidis',
  kind: 'asNeeded',
  dose: { amount: 5, unit: 'drops', perKg: false, roundingStep: null },
  timesOfDay: null,
  everyMinutes: null,
  dayParts: null,
  dayPartReminders: null,
  minIntervalMinutes: 480,
  maxDosesPer24h: null,
  indication: null,
  intervalGroup: null,
  startDate: dayKey(0),
  endDate: null,
  instructions: null,
  replacesPrescriptionId: null,
  status: 'pending',
  declineReason: null,
  cancelReason: null,
  decidedBy: null,
  decidedAt: null,
  acceptedPrescriptionId: null,
  createdAt: hoursAgo(hours),
  updatedAt: hoursAgo(hours),
  clientUpdatedAt: hoursAgo(hours),
  ...extra,
});

function proposals(scenario: Scenario): Proposal[] {
  const author = scenario === 'verified' ? ANA_VERIFIED : ANA;
  return [
    proposal('dev-p-1', 2, {
      author,
      medicationId: 'dev-m-colidis',
      medicationName: 'Colidis',
      dose: { amount: 8, unit: 'drops', perKg: false, roundingStep: null },
      minIntervalMinutes: 360,
      maxDosesPer24h: 4,
      indication: 'belly pain',
      endDate: dayKey(-14),
      replacesPrescriptionId: 'dev-rx-colic',
      instructions:
        'Give it after the feed, never in the middle of it.\nCall me if it does not help in 2 days.',
    }),
    proposal('dev-p-2', 5, {
      author,
      medicationName: 'Sorine saline spray',
      kind: 'scheduled',
      dose: { amount: 2, unit: 'sprays', perKg: false, roundingStep: null },
      timesOfDay: ['08:00', '20:00'],
      minIntervalMinutes: null,
      endDate: dayKey(-5),
      instructions: 'For the blocked nose, before the morning and the night feeds.',
    }),
    proposal('dev-p-3', 9, {
      author: scenario === 'verified' ? MARCOS : author,
      authorUserId: scenario === 'verified' ? OTHER_ID : DOCTOR_ID,
      medicationId: 'dev-m-para',
      medicationName: 'Paracetamol',
      dose: { amount: 0.2, unit: 'ml', perKg: true, roundingStep: 0.5 },
      minIntervalMinutes: 360,
      maxDosesPer24h: 4,
      indication: 'fever above 38 C',
      instructions: 'Only with a fever. Write down the temperature.',
    }),
    proposal('dev-p-4', 20, {
      author,
      medicationName: 'Vitamin K drops',
      kind: 'scheduled',
      dose: { amount: 1, unit: 'drop', perKg: false, roundingStep: null },
      dayParts: ['morning'],
      minIntervalMinutes: null,
    }),
    proposal('dev-p-5', 24 * 6, {
      author,
      medicationName: 'Vitamin D',
      status: 'accepted',
      kind: 'scheduled',
      dose: { amount: 1, unit: 'drop', perKg: false, roundingStep: null },
      dayParts: ['morning'],
      minIntervalMinutes: null,
      decidedBy: MOM,
      decidedAt: hoursAgo(24 * 5),
      acceptedPrescriptionId: 'dev-rx-vitd',
    }),
    proposal('dev-p-6', 24 * 9, {
      author,
      medicationName: 'Simethicone',
      status: 'declined',
      declineReason: 'We will wait for the next visit and see.',
      decidedBy: MOM,
      decidedAt: hoursAgo(24 * 8),
    }),
    proposal('dev-p-7', 24 * 12, {
      author: MARCOS,
      authorUserId: OTHER_ID,
      medicationName: 'Ibuprofen',
      status: 'cancelled',
      cancelReason: 'access_removed',
    }),
    proposal('dev-p-8', 24 * 14, {
      author,
      medicationName: 'Colidis',
      status: 'superseded',
    }),
    proposal('dev-p-9', 24 * 16, {
      author,
      medicationName: 'Paracetamol',
      status: 'cancelled',
      cancelReason: 'withdrawn',
    }),
  ];
}

function recommendations(scenario: Scenario): Note[] {
  const author = scenario === 'verified' ? ANA_VERIFIED : ANA;
  const note = (id: string, hours: number, body: string): Note => ({
    id,
    babyId: LIA,
    authorUserId: DOCTOR_ID,
    author,
    kind: 'recommendation',
    visibility: 'shared',
    body,
    createdAt: hoursAgo(hours),
    updatedAt: hoursAgo(hours),
    clientUpdatedAt: hoursAgo(hours),
    deletedAt: null,
  });
  return [
    note(
      'dev-rec-1',
      3,
      'Offer 120 ml every 3 hours during the day. Keep the night feeds on demand.\nWeigh again in 2 weeks.',
    ),
    note(
      'dev-rec-2',
      30,
      'Tummy time after the morning feed helps the colic, a few minutes at a time.',
    ),
  ];
}

const MEMBERS = [
  { userId: MOM, displayName: 'Carla', role: 'Owner', joinedAt: '2026-08-01T10:00:00Z' },
  {
    userId: DOCTOR_ID,
    displayName: 'ana.s',
    role: 'Doctor',
    joinedAt: '2026-10-01T10:00:00Z',
    professional: PROFILE,
  },
];

const PREDICTIONS = {
  babyId: LIA,
  generatedAt: new Date().toISOString(),
  predictions: [],
  insufficientData: [],
};

function previewApi(): ApiClient {
  const answer = (path: string, options?: RequestOptions): unknown => {
    if (options?.method && options.method !== 'GET') return undefined;
    if (path.includes('/predictions')) return PREDICTIONS;
    if (path.endsWith('/members')) return MEMBERS;
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

function nowEvents(): BabyEvent[] {
  const event = (key: string, startHours: number, endHours: number | null, payload = {}) => ({
    id: `dev-prop-ev-${key}-${startHours}`,
    babyId: LIA,
    typeId: typeIdOf(key),
    startedAt: hoursAgo(startHours),
    endedAt: endHours === null ? null : hoursAgo(endHours),
    payload,
    notes: null,
    createdBy: MOM,
    createdAt: hoursAgo(startHours),
    updatedAt: hoursAgo(startHours),
    deletedAt: null,
  });
  return [
    event('feeding', 1.2, 1, { method: 'bottle', amount_ml: 120, bottle_feeding_type: 'formula' }),
    event('diaper', 0.8, 0.8, { content: 'WET' }),
    event('sleep', 3.5, 2, { kind: 'nap' }),
  ];
}

async function seed(db: BabyRoutineDb, scenario: Scenario): Promise<void> {
  await Promise.all([
    db.babies.clear(),
    db.eventTypes.clear(),
    db.events.clear(),
    db.medications.clear(),
    db.prescriptions.clear(),
    db.proposals.clear(),
    db.notes.clear(),
    db.noteReads.clear(),
    db.outbox.clear(),
  ]);
  const baby = babyFor(scenario);
  await db.babies.put(baby);
  await db.eventTypes.bulkPut(PREVIEW_TYPES);
  await db.medications.bulkPut(MEDICATIONS);
  await db.prescriptions.bulkPut(prescriptions(scenario));
  const doctor = baby.role === 'Doctor';
  const all = proposals(scenario);
  await db.proposals.bulkPut(doctor ? all.filter((p) => p.authorUserId === DOCTOR_ID) : all);
  const notes = recommendations(scenario);
  await db.notes.bulkPut(notes);
  await db.noteReads.put({ noteId: 'dev-rec-2', babyId: LIA, readAt: hoursAgo(28) });
  if (scenario === 'inbox' || scenario === 'provenance') await db.events.bulkPut(nowEvents());
  if (scenario === 'inbox') await db.noteReads.clear();
}

function Body({ scenario, baby }: { scenario: Scenario; baby: Baby }) {
  const [closed, setClosed] = useState(false);
  const done = () => setClosed(true);
  const original = prescriptions(scenario)[1].original;
  switch (scenario) {
    case 'prescribe':
      return (
        <>
          <ProposalsScreen baby={baby} />
          {!closed && (
            <PrescriptionSheet
              mode="proposal"
              babyId={LIA}
              authorUserId={DOCTOR_ID}
              onDone={done}
            />
          )}
        </>
      );
    case 'change':
      return (
        <>
          <ProposalsScreen baby={baby} />
          {!closed && (
            <PrescriptionSheet
              mode="proposal"
              babyId={LIA}
              authorUserId={DOCTOR_ID}
              replaces={prescriptions(scenario)[0]}
              onDone={done}
            />
          )}
        </>
      );
    case 'proposals':
      return <ProposalsScreen baby={baby} />;
    case 'inbox':
    case 'provenance':
      return <NowScreen baby={baby} />;
    case 'details':
    case 'declining':
      return (
        <>
          <FromDoctorScreen baby={baby} />
          {!closed && <ProposalDetailsSheet baby={baby} proposalId="dev-p-1" onClose={done} />}
        </>
      );
    case 'original':
      return (
        <>
          <FromDoctorScreen baby={baby} />
          {!closed && original && (
            <OriginalSheet doctor="Dr. Ana Souza" original={original} onClose={done} />
          )}
        </>
      );
    default:
      return <FromDoctorScreen baby={baby} />;
  }
}

/** Developer-only: the doctor's proposals with seeded data (`/dev/proposals?state=inbox`). */
export default function ProposalsPreview() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('state');
  const scenario: Scenario = SCENARIOS.find((s) => s === requested) ?? 'proposals';
  const [setup] = useState(() => {
    const db = createDatabase('dev-proposals-preview');
    const api = previewApi();
    const queries = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    queries.setQueryData(['predictions', LIA], PREDICTIONS);
    queries.setQueryData(['members', LIA], MEMBERS);
    return {
      db,
      api,
      engine: new SyncEngine({ db, api, locks: null, eventTarget: null }),
      queries,
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

  const baby = babyFor(scenario);
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
                      gridTemplateColumns: 'minmax(0, 1fr)',
                    }}
                  >
                    {(scenario === 'inbox' || scenario === 'provenance') && (
                      <Typography variant="h5" component="p" sx={{ py: 1 }}>
                        Lia
                      </Typography>
                    )}
                    {ready === scenario && <Body key={scenario} scenario={scenario} baby={baby} />}
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
