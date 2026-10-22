import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Box, Typography } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { ApiClientContext } from '../api/ApiClientContext';
import type { ApiClient } from '../api/apiClient';
import { dayKeyOf } from '../appointments/calendarModel';
import { createDatabase, type BabyRoutineDb } from '../db/database';
import { DatabaseProvider } from '../db/DatabaseProvider';
import type { Baby, BabyRole, Vaccination } from '../db/models';
import { seedSchedule, TEST_SCHEDULE } from '../test/vaccineSchedule';
import { UndoSnackbar } from '../ui/UndoSnackbar';
import { VaccinationCardScreen } from '../vaccines/VaccinationCardScreen';
import { VaccinationSheet } from '../vaccines/VaccinationSheet';
import { VaccineProfileBlock } from '../vaccines/VaccineProfileBlock';
import { VaccineSourcesSheet } from '../vaccines/VaccineSourcesSheet';
import { VaccinesDue } from '../vaccines/VaccinesDueCard';
import { VaccinesScreen } from '../vaccines/VaccinesScreen';
import { overviewOf } from '../vaccines/vaccineModel';
import { addDays } from '../vaccines/vaccineStatus';
import { PREVIEW_BABY_ID } from './previewData';
import { PreviewToolbar } from './PreviewToolbar';

/*
 * Developer-only (route `/dev/vaccines`, never in production builds): the vaccine screens over a
 * throw-away local database with a small synthetic schedule (src/test/vaccineSchedule.ts).
 * `?state=timeline` (the page), `record` (the record sheet on a dose), `edit` (a record's sheet),
 * `profile` (the "About this baby" block of a premature baby), `sources`, `now` (the Now card), `card`
 * (the printable vaccination card), `private` (private clinic recommendations on), `caregiver`
 * (read-only), `empty` (no birth date). Dates follow today. No sign-in, no server.
 */

const SCENARIOS = [
  'timeline',
  'record',
  'edit',
  'profile',
  'sources',
  'now',
  'card',
  'private',
  'caregiver',
  'empty',
] as const;
type Scenario = (typeof SCENARIOS)[number];

const BABY_AGE_DAYS = 137;

const todayKey = () => dayKeyOf(Date.now());

function babyOf(scenario: Scenario): Baby {
  const role: BabyRole = scenario === 'caregiver' ? 'Caregiver' : 'Owner';
  const base: Baby = {
    id: PREVIEW_BABY_ID,
    name: 'Lia',
    birthDate: addDays(todayKey(), -BABY_AGE_DAYS),
    role,
  };
  if (scenario === 'empty') return { ...base, birthDate: '' };
  if (scenario === 'private') return { ...base, vaccineProfile: 'public+private' };
  if (scenario === 'profile') {
    return { ...base, gestationalAgeWeeks: 34, rsvMaternalVaccination: 'no' };
  }
  return base;
}

function record(
  id: string,
  doseOffsetDays: number,
  extra: Partial<Vaccination> & { vaccineKey: string | null; doseId: string | null },
): Vaccination {
  const givenOn = addDays(todayKey(), -BABY_AGE_DAYS + doseOffsetDays);
  return {
    id: `dev-vacc-${id}`,
    babyId: PREVIEW_BABY_ID,
    customName: null,
    doseLabel: null,
    givenOn,
    network: 'public',
    clinic: null,
    lot: null,
    administeredBy: null,
    notes: null,
    createdBy: null,
    createdAt: `${givenOn}T12:00:00.000Z`,
    updatedAt: `${givenOn}T12:00:00.000Z`,
    deletedAt: null,
    ...extra,
  };
}

function records(): Vaccination[] {
  return [
    record('bcg', 2, {
      vaccineKey: 'bcg',
      doseId: 'bcg-1',
      doseLabel: 'Single dose',
      clinic: 'Maternidade Santa Clara',
    }),
    record('hepb', 2, {
      vaccineKey: 'hepatite-b',
      doseId: 'hepatite-b-1',
      doseLabel: 'Birth dose',
    }),
    record('vip', 63, {
      vaccineKey: 'vip',
      doseId: 'vip-1',
      doseLabel: '1st dose',
      clinic: 'UBS Centro',
    }),
    record('pneumo', 70, {
      vaccineKey: 'pneumo-conjugada',
      doseId: 'pneumo-conjugada-1',
      doseLabel: '1st dose',
      lot: 'PN2231',
      clinic: 'Clínica Vacina Fácil',
      network: 'private',
    }),
    record('rota', 64, { vaccineKey: 'rotavirus', doseId: 'rotavirus-1', doseLabel: '1st dose' }),
    record('retired', 66, {
      vaccineKey: 'penta',
      doseId: 'penta-retired',
      doseLabel: 'Old 1st dose',
    }),
    record('custom', 100, {
      vaccineKey: null,
      doseId: null,
      customName: 'Travel vaccine',
      doseLabel: '1st dose',
      notes: 'Before the trip.',
    }),
  ];
}

async function seed(db: BabyRoutineDb, scenario: Scenario): Promise<void> {
  await Promise.all([
    db.babies.clear(),
    db.vaccinations.clear(),
    db.vaccineSchedules.clear(),
    db.outbox.clear(),
  ]);
  await db.babies.put(babyOf(scenario));
  await seedSchedule(db);
  if (scenario !== 'empty') await db.vaccinations.bulkPut(records());
}

/** A stand-in API: it answers the profile save with what was sent, and nothing else. */
const previewApi: ApiClient = {
  request: async <T,>(_path: string, options?: { body?: unknown }) =>
    ({ id: PREVIEW_BABY_ID, name: 'Lia', ...(options?.body as object) }) as T,
  requestWithMeta: () => Promise.reject(new Error('Not available in the preview')),
};

function Body({ scenario }: { scenario: Scenario }) {
  const { t } = useTranslation();
  const [closed, setClosed] = useState(false);
  const [now] = useState(() => Date.now());
  const baby = babyOf(scenario);
  const done = () => setClosed(true);
  const today = todayKey();
  const overview = overviewOf({ schedule: TEST_SCHEDULE, baby, records: records(), today });
  const statuses = overview?.views.map((view) => view.status) ?? [];

  switch (scenario) {
    case 'timeline':
    case 'private':
    case 'caregiver':
    case 'empty':
      return <VaccinesScreen baby={baby} />;
    case 'profile':
      return (
        <>
          <VaccineProfileBlock baby={baby} writable now={new Date(now)} />
          <Alert severity="info">{t('vaccines.premature')}</Alert>
        </>
      );
    case 'now':
      return <VaccinesDue baby={baby} now={now} />;
    case 'card':
      return <VaccinationCardScreen baby={baby} />;
    default:
      break;
  }
  if (closed) return null;
  if (scenario === 'sources')
    return <VaccineSourcesSheet schedule={TEST_SCHEDULE} onClose={done} />;
  if (scenario === 'edit') {
    return (
      <VaccinationSheet
        babyId={PREVIEW_BABY_ID}
        schedule={TEST_SCHEDULE}
        statuses={statuses}
        today={today}
        record={records().find((r) => r.id === 'dev-vacc-pneumo')!}
        onClose={done}
      />
    );
  }
  return (
    <VaccinationSheet
      babyId={PREVIEW_BABY_ID}
      schedule={TEST_SCHEDULE}
      statuses={statuses}
      today={today}
      preset={{ vaccineKey: 'penta', doseId: 'penta-1' }}
      onClose={done}
    />
  );
}

/** Developer-only: the vaccine screens with seeded local data (`/dev/vaccines?state=timeline`). */
export default function VaccinesPreview() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('state');
  const scenario: Scenario = SCENARIOS.find((s) => s === requested) ?? 'timeline';
  const [db] = useState(() => createDatabase('dev-vaccines-preview'));
  const [ready, setReady] = useState<Scenario | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    let live = true;
    void seed(db, scenario).then(() => {
      queryClient.setQueryData(['members', PREVIEW_BABY_ID], []);
      if (live) setReady(scenario);
    });
    return () => {
      live = false;
    };
  }, [db, scenario, queryClient]);

  return (
    <DatabaseProvider db={db}>
      <ApiClientContext value={previewApi}>
        <Box sx={{ bgcolor: 'background.default', color: 'text.primary', minHeight: '100dvh' }}>
          <Box sx={{ maxWidth: 480, mx: 'auto', px: 2, pt: 1, pb: 12, display: 'grid', gap: 2 }}>
            <Typography variant="h5" component="p" sx={{ py: 1 }}>
              Lia
            </Typography>
            {ready === scenario && <Body key={scenario} scenario={scenario} />}
            <PreviewToolbar
              scenarios={SCENARIOS}
              scenario={scenario}
              onScenario={(next) => setParams({ state: next }, { replace: true })}
            />
          </Box>
          <UndoSnackbar />
        </Box>
      </ApiClientContext>
    </DatabaseProvider>
  );
}
