import { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Routes, useSearchParams } from 'react-router-dom';
import type { ApiClient, RequestOptions } from '../api/apiClient';
import { ApiClientContext } from '../api/ApiClientContext';
import { AuthContext, type AuthApi } from '../auth/AuthContext';
import { addDays, dayValue, parseDayValue, startOfDay } from '../day/dayModel';
import { createDatabase, type BabyRoutineDb } from '../db/database';
import { DatabaseProvider } from '../db/DatabaseProvider';
import type { Baby, Medication, Note, PersonSummary, Prescription, Proposal } from '../db/models';
import { doctorRoutes } from '../doctor/doctorRoutes';
import { writeAppMode } from '../doctor/dashboardStorage';
import type { ClinicalSummaryDto, DoctorPatientDto } from '../doctor/doctorApi';
import { DOCTOR_SCOPES, type DoctorScope } from '../doctor/scopes';
import { SyncEngine } from '../sync/SyncEngine';
import { SyncEngineContext } from '../sync/SyncEngineContext';
import type { EventDto, EventTypeDto, MeasurementDto, PrescriptionDto } from '../sync/contract';
import {
  DIAPER_DTO,
  FEEDING_DTO,
  SLEEP_DTO,
  SPIT_UP_DTO,
  SYMPTOM_DTO,
  TEMPERATURE_DTO,
} from '../test/builtInTypes';
import { PreviewToolbar } from './PreviewToolbar';

/*
 * Developer-only (route `/dev/doctor-dashboard`, never in production builds): the doctor's
 * dashboard (docs/design/19-doctor-dashboard.md) over a throw-away local database and an in-memory
 * API, no sign-in. `?state=home` (Patients), `summary` (Lia, every section shared), `partial` (Theo:
 * only the daily log and growth shared), `timeline`, `growth`, `medications`, `notes`, `settings`,
 * `empty` (no patients yet). `?scheme=dark` switches the colour scheme. The page is the real route
 * tree mounted at a fixed location, so links inside it do not navigate the preview.
 */

const STATES = [
  'home',
  'summary',
  'partial',
  'timeline',
  'growth',
  'medications',
  'notes',
  'settings',
  'empty',
] as const;
type State = (typeof STATES)[number];

const DOCTOR_ID = 'dev-dash-doctor';
const LIA = 'dev-dash-lia';
const THEO = 'dev-dash-theo';
const MAYA = 'dev-dash-maya';
const BIA = 'dev-dash-bia';

const PATHS: Record<State, string> = {
  home: '/doctor',
  summary: `/doctor/${LIA}`,
  partial: `/doctor/${THEO}`,
  timeline: `/doctor/${LIA}/timeline`,
  growth: `/doctor/${LIA}/growth`,
  medications: `/doctor/${LIA}/medications`,
  notes: `/doctor/${LIA}/notes`,
  settings: '/doctor/settings',
  empty: '/doctor',
};

const PROFILE = {
  kind: 'doctor' as const,
  displayName: 'Ana Souza',
  specialty: 'Pediatrics',
  registrationNumber: 'CRM-SP 123456',
  verified: false,
};
const ANA: PersonSummary = { userId: DOCTOR_ID, displayName: 'Ana Souza', professional: PROFILE };

const now = () => new Date();
const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString();
const daysAgo = (days: number) => dayValue(addDays(startOfDay(now()), -days));

interface Patient {
  id: string;
  name: string;
  birthDate: string;
  scopes: DoctorScope[];
  lastEventHours: number | null;
}

const PATIENTS: Patient[] = [
  { id: LIA, name: 'Lia', birthDate: daysAgo(64), scopes: [...DOCTOR_SCOPES], lastEventHours: 1.5 },
  {
    id: THEO,
    name: 'Theo',
    birthDate: daysAgo(196),
    scopes: ['daily_log', 'growth'],
    lastEventHours: 6,
  },
  {
    id: MAYA,
    name: 'Maya',
    birthDate: daysAgo(330),
    scopes: [...DOCTOR_SCOPES],
    lastEventHours: 24 * 5,
  },
  {
    id: BIA,
    name: 'Bia',
    birthDate: daysAgo(21),
    scopes: ['notes', 'vaccines'],
    lastEventHours: null,
  },
];

const babyOf = (patient: Patient): Baby => ({
  id: patient.id,
  name: patient.name,
  birthDate: patient.birthDate,
  role: 'Doctor',
  userId: DOCTOR_ID,
  doctorScopes: patient.scopes,
});

/** A stable pseudo-random number in [0, 1) for a key (the same day always gets the same numbers). */
function noise(key: string): number {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return ((hash >>> 0) % 1000) / 1000;
}

const between = (key: string, min: number, max: number) =>
  Math.round(min + noise(key) * (max - min));

function daysOf(from: string, to: string): string[] {
  const start = parseDayValue(from);
  const end = parseDayValue(to);
  if (!start || !end) return [];
  const days: string[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(dayValue(day));
  return days;
}

const mean = (values: number[]) =>
  values.length === 0
    ? null
    : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;

const MEDICATIONS: Medication[] = [
  ['dev-dash-vitd', 'Vitamin D', true],
  ['dev-dash-para', 'Paracetamol', false],
].map(([id, name, isUsual]) => ({
  id: id as string,
  babyId: LIA,
  name: name as string,
  isUsual: isUsual as boolean,
  defaultDosage: null,
  notes: null,
  productId: null,
  createdAt: hoursAgo(24 * 40),
}));

const PRESCRIPTION: PrescriptionDto = {
  id: 'dev-dash-rx1',
  babyId: LIA,
  medicationId: 'dev-dash-vitd',
  status: 'active',
  kind: 'scheduled',
  dose: { amount: 2, unit: 'drops', perKg: false, roundingStep: null },
  timesOfDay: ['09:00'],
  startDate: daysAgo(30),
  endDate: null,
  instructions: 'With the morning feed.',
  prescribedByUserId: DOCTOR_ID,
  prescribedByName: 'Ana Souza',
  prescribedBy: ANA,
  proposalId: 'dev-dash-p1',
  changedByParent: false,
  createdAt: hoursAgo(24 * 30),
  updatedAt: hoursAgo(24 * 30),
};

const MEASUREMENTS: MeasurementDto[] = [
  [45, 4.62, 55.5, 38.0, false],
  [30, 5.05, 57.0, 38.8, true],
  [9, 5.48, 58.6, 39.4, true],
].map(([days, weightKg, heightCm, head, doctor], index) => ({
  id: `dev-dash-m${index}`,
  babyId: LIA,
  date: daysAgo(days as number),
  weightKg: weightKg as number,
  heightCm: heightCm as number,
  headCircumferenceCm: head as number,
  notes: null,
  createdBy: doctor ? DOCTOR_ID : 'dev-mom',
  createdAt: hoursAgo((days as number) * 24),
  updatedAt: hoursAgo((days as number) * 24),
  recordedByDoctor: doctor as boolean,
  recordedBy: doctor ? ANA : null,
}));

const MEDICATION_TYPE: EventTypeDto = {
  id: 'dev-dash-medication',
  babyId: null,
  key: 'medication',
  name: 'Medication',
  icon: 'medication',
  color: '#c2410c',
  hasDuration: false,
  fields: [],
};
const TYPES: EventTypeDto[] = [
  FEEDING_DTO,
  SLEEP_DTO,
  DIAPER_DTO,
  TEMPERATURE_DTO,
  SYMPTOM_DTO,
  SPIT_UP_DTO,
  MEDICATION_TYPE,
];

function event(
  id: string,
  type: EventTypeDto,
  start: Date,
  minutes: number | null,
  payload: Record<string, unknown>,
): EventDto {
  const startedAt = start.toISOString();
  const endedAt =
    minutes === null ? startedAt : new Date(start.getTime() + minutes * 60_000).toISOString();
  return {
    id,
    babyId: LIA,
    typeId: type.id,
    startedAt,
    endedAt,
    payload,
    notes: null,
    createdBy: 'dev-mom',
    createdAt: endedAt,
    updatedAt: endedAt,
    clientUpdatedAt: endedAt,
    deletedAt: null,
  };
}

/** A believable day of Lia's (and the evening before), only what happened before now. */
function dayEvents(day: Date): EventDto[] {
  const key = dayValue(day);
  const at = (hours: number, minutes = 0) =>
    new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes);
  const events = [
    event(`${key}-night`, SLEEP_DTO, at(-3, -30), 9 * 60 + 40, { kind: 'night' }),
    event(`${key}-nap1`, SLEEP_DTO, at(9, 5), 70, { kind: 'nap' }),
    event(`${key}-nap2`, SLEEP_DTO, at(12, 40), 45, { kind: 'nap' }),
    event(`${key}-nap3`, SLEEP_DTO, at(15, 50), 55, { kind: 'nap' }),
    event(`${key}-night2`, SLEEP_DTO, at(20, 30), 9 * 60 + 30, { kind: 'night' }),
    ...[6, 9, 12, 15, 18, 21].map((hour, index) =>
      event(
        `${key}-feed${index}`,
        FEEDING_DTO,
        at(hour, between(`${key}${index}`, 0, 25)),
        index % 2 === 0 ? 20 : 15,
        index % 2 === 0
          ? { method: 'breast', side: 'both' }
          : { method: 'bottle', amount_ml: 120, bottle_feeding_type: 'formula' },
      ),
    ),
    ...[7, 10, 13, 17, 20].map((hour, index) =>
      event(`${key}-diaper${index}`, DIAPER_DTO, at(hour, 20), null, {
        content: index === 2 ? 'MIXED' : index === 4 ? 'DIRTY' : 'WET',
      }),
    ),
    event(`${key}-temp`, TEMPERATURE_DTO, at(14, 5), null, { value_c: 37.4, method: 'armpit' }),
    event(`${key}-vitd`, MEDICATION_TYPE, at(9, 0), null, {
      medications: [
        { medicationId: 'dev-dash-vitd', name: 'Vitamin D', dose: { amount: 2, unit: 'drops' } },
      ],
    }),
  ];
  const nowIso = now().toISOString();
  // What started already; a sleep that would end later is still running.
  return events
    .filter((item) => item.startedAt <= nowIso)
    .map((item) => (item.endedAt && item.endedAt > nowIso ? { ...item, endedAt: null } : item));
}

function summaryOf(patient: Patient, from: string, to: string): ClinicalSummaryDto {
  const today = dayValue(now());
  const days = daysOf(from, to);
  const counted = days.filter((day) => day !== today);
  const has = (scope: DoctorScope) => patient.scopes.includes(scope);
  const sleepDays = days.map((date) => {
    const night = date === today ? 560 : between(`${date}n`, 560, 640);
    const nap = date === today ? 70 : between(`${date}p`, 150, 220);
    return {
      date,
      totalMinutes: night + nap,
      nightMinutes: night,
      napMinutes: nap,
      naps: date === today ? 1 : between(`${date}c`, 3, 4),
      longestMinutes: between(`${date}l`, 240, 330),
    };
  });
  const sleepCounted = sleepDays.filter((day) => counted.includes(day.date));
  const feedDays = days.map((date) => {
    const feeds = date === today ? 4 : between(`${date}f`, 7, 9);
    return {
      date,
      feeds,
      bottleMl: feeds * 60,
      breast: Math.ceil(feeds / 2),
      bottle: Math.floor(feeds / 2),
      solid: 0,
    };
  });
  const feedCounted = feedDays.filter((day) => counted.includes(day.date));
  const diaperDays = days.map((date) => {
    const total = date === today ? 3 : between(`${date}d`, 6, 8);
    return { date, total, wet: total - 1, dirty: between(`${date}x`, 1, 3) };
  });
  const diaperCounted = diaperDays.filter((day) => counted.includes(day.date));
  const temperature = event(
    'dev-dash-temp',
    TEMPERATURE_DTO,
    new Date(Date.now() - 50 * 3_600_000),
    null,
    {
      value_c: 37.8,
      method: 'armpit',
    },
  );
  const cough = event('dev-dash-cough', SYMPTOM_DTO, new Date(Date.now() - 74 * 3_600_000), null, {
    symptom: 'cough',
    severity: 'mild',
  });
  const spit = event('dev-dash-spit', SPIT_UP_DTO, new Date(Date.now() - 98 * 3_600_000), null, {
    kind: 'spit_up',
    amount: 'little',
  });
  return {
    babyId: patient.id,
    from,
    to,
    today,
    timeZone: 'America/Sao_Paulo',
    generatedAt: hoursAgo(0.05),
    scopes: patient.scopes,
    sleep: has('daily_log')
      ? {
          days: sleepDays,
          averageTotalMinutes: mean(sleepCounted.map((d) => d.totalMinutes)),
          averageNightMinutes: mean(sleepCounted.map((d) => d.nightMinutes)),
          averageNapMinutes: mean(sleepCounted.map((d) => d.napMinutes)),
          napsPerDay: mean(sleepCounted.map((d) => d.naps)),
          daysCounted: sleepCounted.length,
          longestStretchMinutes: 342,
          longestStretchStartedAt: hoursAgo(60),
          bedtimeMedian: '20:25',
          wakeMedian: '06:10',
        }
      : null,
    feeding: has('daily_log')
      ? {
          days: feedDays,
          feedsPerDay: mean(feedCounted.map((d) => d.feeds)),
          averageIntervalMinutes: 168,
          bottleMlPerDay: mean(feedCounted.map((d) => d.bottleMl)),
          breastCount: feedDays.reduce((sum, d) => sum + d.breast, 0),
          bottleCount: feedDays.reduce((sum, d) => sum + d.bottle, 0),
          solidCount: 0,
          formulas: [
            {
              formulaId: 'dev-dash-f1',
              name: 'Aptamil Profutura 1',
              feeds: feedDays.reduce((sum, d) => sum + d.bottle, 0),
              ml: feedDays.reduce((sum, d) => sum + d.bottleMl, 0),
            },
          ],
        }
      : null,
    diapers: has('daily_log')
      ? {
          days: diaperDays,
          perDay: mean(diaperCounted.map((d) => d.total)),
          wetPerDay: mean(diaperCounted.map((d) => d.wet)),
          dirtyPerDay: mean(diaperCounted.map((d) => d.dirty)),
        }
      : null,
    symptoms: has('daily_log') ? { items: [temperature, cough, spit] } : null,
    medications: has('medications')
      ? {
          doses: [
            {
              medicationId: 'dev-dash-vitd',
              name: 'Vitamin D',
              count: counted.length,
              lastGivenAt: hoursAgo(5),
            },
            {
              medicationId: 'dev-dash-para',
              name: 'Paracetamol',
              count: 2,
              lastGivenAt: hoursAgo(49),
            },
          ],
          activePrescriptions: [PRESCRIPTION],
        }
      : null,
    vaccines: has('vaccines')
      ? {
          given: 9,
          due: 1,
          overdue: 0,
          upcoming: 14,
          dueDoses: [
            {
              doseId: 'penta-2',
              vaccineKey: 'penta',
              vaccineNames: {
                en: 'Pentavalent (DTP-Hib-HepB)',
                'pt-BR': 'Pentavalente (DTP-Hib-HB)',
              },
              doseLabel: { en: '2nd dose', 'pt-BR': '2ª dose' },
              state: 'due',
              dueOn: daysAgo(3),
            },
          ],
        }
      : null,
    growth: has('growth')
      ? { measurements: MEASUREMENTS.map((m) => ({ ...m, babyId: patient.id })) }
      : null,
    formulas: has('formulas')
      ? {
          current: {
            id: 'dev-dash-f1',
            babyId: patient.id,
            name: 'Aptamil Profutura 1',
            brand: 'Danone',
            stage: '1',
            startedOn: daysAgo(20),
            isCurrent: true,
            archived: false,
            createdAt: hoursAgo(24 * 20),
            updatedAt: hoursAgo(24 * 20),
          },
          history: [
            {
              id: 'dev-dash-f0',
              babyId: patient.id,
              name: 'NAN Supreme 1',
              brand: 'Nestlé',
              stage: '1',
              startedOn: daysAgo(55),
              isCurrent: false,
              archived: true,
              createdAt: hoursAgo(24 * 55),
              updatedAt: hoursAgo(24 * 20),
            },
          ],
        }
      : null,
  };
}

function patientDto(patient: Patient): DoctorPatientDto {
  const has = (scope: DoctorScope) => patient.scopes.includes(scope);
  const weekly = summaryOf(patient, daysAgo(6), daysAgo(0));
  return {
    babyId: patient.id,
    name: patient.name,
    birthDate: patient.birthDate,
    doctorScopes: patient.scopes,
    lastEventAt:
      has('daily_log') && patient.lastEventHours !== null ? hoursAgo(patient.lastEventHours) : null,
    week: has('daily_log')
      ? {
          from: daysAgo(6),
          to: daysAgo(0),
          sleepMinutesPerDay: weekly.sleep?.averageTotalMinutes ?? null,
          feedsPerDay: weekly.feeding?.feedsPerDay ?? null,
          bottleMlPerDay: weekly.feeding?.bottleMlPerDay ?? null,
          diapersPerDay: weekly.diapers?.perDay ?? null,
        }
      : null,
    latestWeight: has('growth') ? { weightKg: 5.48, date: daysAgo(9) } : null,
    pendingProposals: has('medications') ? (patient.id === LIA ? 1 : 0) : null,
    vaccinesDue: has('vaccines') ? (patient.id === BIA ? 2 : patient.id === LIA ? 1 : 0) : null,
    sharedNotes: has('notes') ? 2 : null,
  };
}

function previewApi(patients: () => Patient[]): ApiClient {
  const answer = (path: string, options?: RequestOptions): unknown => {
    if (options?.method && options.method !== 'GET') return {};
    const url = new URL(path, 'http://preview');
    const parts = url.pathname.split('/').filter(Boolean);
    const patient = patients().find((p) => parts.includes(p.id));
    if (url.pathname.endsWith('/doctor/patients')) return patients().map(patientDto);
    if (url.pathname.endsWith('/clinical-summary') && patient) {
      return summaryOf(
        patient,
        url.searchParams.get('from') ?? '',
        url.searchParams.get('to') ?? '',
      );
    }
    if (url.pathname.endsWith('/timeline')) {
      const from = new Date(url.searchParams.get('from') ?? Date.now());
      const day = addDays(startOfDay(from), 1);
      return [...dayEvents(addDays(day, -1)), ...dayEvents(day)];
    }
    if (url.pathname.endsWith('/event-types')) return TYPES;
    if (url.pathname.endsWith('/measurements')) return MEASUREMENTS;
    if (url.pathname.endsWith('/professional-profile')) return { ...PROFILE, userId: DOCTOR_ID };
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
  user: { name: 'Ana Souza' },
  accountId: 'dev|doctor-dashboard',
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
  note('dev-dash-n1', 26, {
    kind: 'recommendation',
    body: 'Keep 2 drops of vitamin D every morning. Offer the bottle every 3 hours during the day.',
  }),
  note('dev-dash-n2', 24 * 9, {
    body: 'Consultation at 2 months: weight and length on track. Next visit in 4 weeks.',
  }),
];

const PROPOSAL: Proposal = {
  id: 'dev-dash-p2',
  babyId: LIA,
  authorUserId: DOCTOR_ID,
  author: ANA,
  medicationId: 'dev-dash-para',
  productId: null,
  medicationName: 'Paracetamol',
  kind: 'asNeeded',
  dose: { amount: 2.5, unit: 'ml', perKg: false, roundingStep: null },
  timesOfDay: null,
  everyMinutes: null,
  dayParts: null,
  dayPartReminders: null,
  minIntervalMinutes: 360,
  maxDosesPer24h: 4,
  indication: 'Fever over 38 °C',
  intervalGroup: null,
  startDate: daysAgo(1),
  endDate: null,
  instructions: null,
  replacesPrescriptionId: null,
  status: 'pending',
  declineReason: null,
  cancelReason: null,
  decidedBy: null,
  decidedAt: null,
  acceptedPrescriptionId: null,
  createdAt: hoursAgo(20),
  updatedAt: hoursAgo(20),
  clientUpdatedAt: hoursAgo(20),
};

async function seed(db: BabyRoutineDb, patients: Patient[]): Promise<void> {
  await Promise.all([
    db.babies.clear(),
    db.notes.clear(),
    db.medications.clear(),
    db.prescriptions.clear(),
    db.proposals.clear(),
    db.outbox.clear(),
  ]);
  await db.babies.bulkPut(patients.map(babyOf));
  if (patients.length === 0) return;
  await db.notes.bulkPut(NOTES);
  await db.medications.bulkPut(MEDICATIONS);
  await db.prescriptions.bulkPut([
    {
      ...PRESCRIPTION,
      status: 'active',
      kind: 'scheduled',
      dose: { amount: 2, unit: 'drops', perKg: false, roundingStep: null },
      timesOfDay: ['09:00'],
      everyMinutes: null,
      dayParts: null,
      dayPartReminders: null,
      minIntervalMinutes: null,
      maxDosesPer24h: null,
      indication: null,
      intervalGroup: null,
      endDate: null,
      prescriber: 'Ana Souza',
      instructions: 'With the morning feed.',
      createdBy: 'dev-mom',
      deletedAt: null,
    } as Prescription,
  ]);
  await db.proposals.bulkPut([PROPOSAL]);
}

/** Developer-only: the doctor's dashboard with seeded data (`/dev/doctor-dashboard?state=summary`). */
export default function DoctorDashboardPreview() {
  const [params] = useSearchParams();
  const requested = params.get('state');
  const state: State = STATES.find((s) => s === requested) ?? 'home';
  const patients = state === 'empty' ? [] : PATIENTS;
  const [setup] = useState(() => {
    const db = createDatabase('dev-doctor-dashboard-preview');
    let current = patients;
    const api = previewApi(() => current);
    return {
      db,
      api,
      setPatients: (next: Patient[]) => {
        current = next;
      },
      engine: new SyncEngine({ db, api, locks: null, eventTarget: null }),
      queries: new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: Infinity } },
      }),
    };
  });
  const [ready, setReady] = useState<State | null>(null);

  useEffect(() => {
    let live = true;
    setup.setPatients(patients);
    setup.queries.clear();
    writeAppMode('patients');
    void seed(setup.db, patients).then(() => live && setReady(state));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setup, state]);

  return (
    <AuthContext value={AUTH}>
      <ApiClientContext value={setup.api}>
        <QueryClientProvider client={setup.queries}>
          <DatabaseProvider db={setup.db}>
            <SyncEngineContext value={setup.engine}>
              {ready === state && <Routes location={PATHS[state]}>{doctorRoutes()}</Routes>}
              {/* Applies `?scheme=` (hidden: the dashboard fills the screen). */}
              <Box
                inert
                sx={{
                  position: 'fixed',
                  width: 1,
                  height: 1,
                  overflow: 'hidden',
                  opacity: 0,
                  top: 0,
                }}
              >
                <PreviewToolbar scenarios={STATES} scenario={state} onScenario={() => {}} />
              </Box>
            </SyncEngineContext>
          </DatabaseProvider>
        </QueryClientProvider>
      </ApiClientContext>
    </AuthContext>
  );
}
