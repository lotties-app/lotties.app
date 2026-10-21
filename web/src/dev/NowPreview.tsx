import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Box, Typography } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { AddSheetProvider } from '../layout/AddSheetProvider';
import { BottomNav } from '../layout/BottomNav';
import { createDatabase, type BabyRoutineDb } from '../db/database';
import { DatabaseProvider } from '../db/DatabaseProvider';
import type {
  Baby,
  BabyEvent,
  EventPayload,
  EventType,
  Medication,
  Prescription,
} from '../db/models';
import { useLocale } from '../i18n/useLocale';
import { NowScreen } from '../now/ui/NowScreen';
import { writeLastSeenAt } from '../now/lastSeen';
import type { PredictionsDto } from '../sync/contract';
import { DIAPER_TYPE, FEEDING_TYPE, SLEEP_TYPE } from '../test/builtInTypes';
import { useNightFeed } from '../theme/NightFeedContext';
import { useThemeMode } from '../theme/ThemeModeContext';
import { SegmentedControl } from '../ui/form';

/*
 * Developer-only (route `/dev/now`, never in production builds): the Now screen on a throw-away
 * local database, seeded for one scenario at a time, with no sign-in and no server. Used to look
 * at the screen in every state, scheme and language (`?state=awake`).
 */

const BABY_ID = 'dev-now-baby';
const SCENARIOS = [
  'empty',
  'learning',
  'awake',
  'nap',
  'night',
  'waking',
  'nursing',
  'forgotten',
  'catchup',
  'viewer',
  'meds',
] as const;
type Scenario = (typeof SCENARIOS)[number];
type Scheme = 'light' | 'dark' | 'night';

const field = (
  key: string,
  extra: Partial<EventType['fields'][number]> = {},
): EventType['fields'][number] => ({
  key,
  label: key,
  kind: 'text',
  isRequired: false,
  options: [],
  min: null,
  max: null,
  unit: null,
  ...extra,
});

const extraType = (
  key: string,
  name: string,
  icon: string,
  hasDuration = false,
  fields: EventType['fields'] = [],
): EventType => ({
  id: `dev-${key}`,
  babyId: null,
  key,
  name,
  icon,
  color: '#4f8ef7',
  hasDuration,
  fields,
});

const TYPES: EventType[] = [
  FEEDING_TYPE,
  SLEEP_TYPE,
  DIAPER_TYPE,
  extraType('medication', 'Medication', 'medication'),
  extraType('belly_pain', 'Belly pain', 'sick', false, [
    field('intensity', { kind: 'number', isRequired: true, min: 1, max: 5 }),
  ]),
  extraType('bath', 'Bath', 'bathtub'),
  extraType('tummy_time', 'Tummy time', 'child_care', true),
];
const typeId = (key: string) => TYPES.find((t) => t.key === key)?.id ?? key;

const MEDICATIONS: Medication[] = [
  ['m1', 'Colidis', true, { amount: 5, unit: 'drops' }],
  ['m2', 'Vitamin D', true, null],
  ['m3', 'Paracetamol', false, { amount: 2.5, unit: 'ml' }],
].map(([id, name, isUsual, defaultDosage]) => ({
  id: id as string,
  babyId: BABY_ID,
  name: name as string,
  isUsual: isUsual as boolean,
  defaultDosage: defaultDosage as Medication['defaultDosage'],
  notes: null,
  createdAt: '2026-10-01T00:00:00.000Z',
}));

const MIN = 60_000;

function eventAt(
  now: number,
  key: string,
  startAgoMin: number,
  endAgoMin: number | null,
  payload: EventPayload = {},
  extra: Partial<BabyEvent> = {},
): BabyEvent {
  const startedAt = new Date(now - startAgoMin * MIN).toISOString();
  // Stable ids: seeding twice (StrictMode runs effects twice) must not duplicate events.
  const id = `dev-${key}-${startAgoMin}-${endAgoMin ?? 'running'}`;
  return {
    id,
    babyId: BABY_ID,
    typeId: typeId(key),
    startedAt,
    endedAt: endAgoMin === null ? null : new Date(now - endAgoMin * MIN).toISOString(),
    payload,
    notes: null,
    createdBy: null,
    createdAt: startedAt,
    updatedAt: startedAt,
    deletedAt: null,
    ...extra,
  };
}

/** A normal morning: wake-up, a feed, a diaper, a nap that ended `awakeMin` minutes ago. */
function morning(now: number, awakeMin: number): BabyEvent[] {
  const napStart = awakeMin + 70;
  return [
    eventAt(now, 'sleep', napStart, awakeMin, { kind: 'nap' }),
    eventAt(now, 'feeding', awakeMin + 130, awakeMin + 130, {
      method: 'bottle',
      amount_ml: 120,
      bottle_feeding_type: 'formula',
    }),
    eventAt(now, 'diaper', awakeMin + 30, awakeMin + 30, { content: 'WET' }),
    eventAt(now, 'diaper', awakeMin + 200, awakeMin + 200, { content: 'DIRTY' }),
    eventAt(now, 'sleep', awakeMin + 400, awakeMin + 300, { kind: 'nap' }),
    eventAt(now, 'feeding', awakeMin + 240, awakeMin + 228, { method: 'breast', side: 'left' }),
  ];
}

function prediction(now: number): PredictionsDto {
  return {
    babyId: BABY_ID,
    generatedAt: new Date(now).toISOString(),
    engineVersion: 'heuristic-1.1',
    insufficientData: [],
    bedTime: {
      typeKey: 'sleep',
      kind: 'night',
      nextStart: {
        earliest: new Date(now + 3.6 * 60 * MIN).toISOString(),
        expected: new Date(now + 4 * 60 * MIN).toISOString(),
        latest: new Date(now + 4.5 * 60 * MIN).toISOString(),
      },
      expectedDuration: { minutes: 600, sampleCount: 9 },
      confidence: 'Medium',
      sampleCount: 9,
      reason: '',
      basis: {
        kind: 'BedTimeClock',
        sampleCount: 9,
        recentBedTimeCount: 9,
        lookBackDays: 14,
        medianClock: '19:50',
      },
    },
    predictions: [
      {
        typeKey: 'sleep',
        confidence: 'Medium',
        sampleCount: 18,
        reason: '',
        expectedDuration: { minutes: 75, sampleCount: 12 },
        nextStart: {
          earliest: new Date(now - 7 * MIN).toISOString(),
          expected: new Date(now + 8 * MIN).toISOString(),
          latest: new Date(now + 22 * MIN).toISOString(),
        },
        basis: {
          kind: 'AwakeWindow',
          medianGapMinutes: 105,
          lookBackDays: 7,
          ageBand: '0-3m',
          dayPhase: 'day',
          assumesEventInProgressEnds: false,
        },
      },
    ],
  };
}

/** `HH:mm` of the local clock `minAgo` minutes before `now`. */
function clockAgo(now: number, minAgo: number): string {
  const d = new Date(now - minAgo * MIN);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Prescriptions of the `meds` scenario: waiting, per kg, due now, and an ended course. */
function prescriptionsFor(now: number): Prescription[] {
  const base = {
    babyId: BABY_ID,
    status: 'active' as const,
    startDate: '2026-09-01',
    endDate: null,
    prescriber: null,
    instructions: null,
    indication: null,
    intervalGroup: null,
    timesOfDay: null,
    everyMinutes: null,
    minIntervalMinutes: null,
    maxDosesPer24h: null,
    createdBy: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    deletedAt: null,
  };
  return [
    {
      ...base,
      id: 'dev-rx-colidis',
      medicationId: 'm1',
      kind: 'asNeeded',
      dose: { amount: 1, unit: 'drops', perKg: true, roundingStep: 1 },
      minIntervalMinutes: 480,
      maxDosesPer24h: 3,
      indication: 'belly pain',
      intervalGroup: 'colic',
    },
    {
      ...base,
      id: 'dev-rx-paracetamol',
      medicationId: 'm3',
      kind: 'asNeeded',
      dose: { amount: 2.5, unit: 'ml', perKg: false, roundingStep: null },
      minIntervalMinutes: 360,
      indication: 'fever',
      intervalGroup: 'colic',
    },
    {
      ...base,
      id: 'dev-rx-vitd',
      medicationId: 'm2',
      kind: 'scheduled',
      dose: { amount: 2, unit: 'drops', perKg: false, roundingStep: null },
      timesOfDay: [clockAgo(now, 30), '23:00'],
    },
  ];
}

interface Seeded {
  baby: Baby;
  events: BabyEvent[];
  predictions: PredictionsDto | null;
  lastSeenMinAgo?: number;
}

function seedFor(scenario: Scenario, now: number): Seeded {
  const baby: Baby = {
    id: BABY_ID,
    name: 'Lia',
    birthDate: '2026-08-01',
    role: scenario === 'viewer' ? 'Viewer' : 'Owner',
  };
  const empty: PredictionsDto = {
    babyId: BABY_ID,
    generatedAt: new Date(now).toISOString(),
    predictions: [],
    insufficientData: [],
  };
  switch (scenario) {
    case 'empty':
      return { baby, events: [], predictions: empty };
    case 'learning':
      return {
        baby,
        events: morning(now, 40).slice(0, 3),
        predictions: {
          ...empty,
          insufficientData: [{ typeKey: 'sleep', sampleCount: 1, requiredSamples: 3, reason: '' }],
        },
      };
    case 'nap':
      return {
        baby,
        events: [...morning(now, 400), eventAt(now, 'sleep', 42, null, { kind: 'nap' })],
        predictions: prediction(now),
      };
    case 'night':
      return {
        baby,
        events: [
          ...morning(now, 700),
          eventAt(now, 'sleep', 250, null, { kind: 'night' }),
          eventAt(now, 'sleep', 262, 262, { kind: 'bed_time' }),
        ],
        predictions: empty,
      };
    case 'waking':
      return {
        baby,
        events: [
          ...morning(now, 700),
          eventAt(now, 'sleep', 300, null, { kind: 'night' }),
          eventAt(now, 'sleep', 4, null, { kind: 'night_waking' }),
        ],
        predictions: empty,
      };
    case 'nursing':
      return {
        baby,
        events: [
          ...morning(now, 95),
          eventAt(now, 'feeding', 6, null, {
            method: 'breast',
            side: 'right',
            breast_left_seconds: 190,
            side_since: new Date(now - 3 * MIN).toISOString(),
          }),
        ],
        predictions: prediction(now),
      };
    case 'forgotten':
      return {
        baby,
        events: [
          ...morning(now, 400),
          eventAt(now, 'sleep', 300, null, { kind: 'nap' }),
          eventAt(now, 'tummy_time', 125, null),
        ],
        predictions: empty,
      };
    case 'catchup':
      return {
        baby,
        events: [
          ...morning(now, 112).map((e) => ({ ...e, createdBy: 'u-ana', createdAt: e.startedAt })),
          eventAt(
            now,
            'medication',
            90,
            90,
            {
              medications: [
                { medicationId: 'm3', name: 'Paracetamol', dose: { amount: 2.5, unit: 'ml' } },
              ],
            },
            { createdBy: 'u-ana', createdAt: new Date(now - 90 * MIN).toISOString() },
          ),
        ],
        predictions: prediction(now),
        lastSeenMinAgo: 600,
      };
    case 'meds':
      return {
        baby,
        events: [
          ...morning(now, 112),
          eventAt(now, 'medication', 120, 120, {
            medications: [
              {
                medicationId: 'm1',
                name: 'Colidis',
                dose: { amount: 5, unit: 'drops' },
                prescriptionId: 'dev-rx-colidis',
                kgUsed: 4.6,
              },
            ],
          }),
        ],
        predictions: prediction(now),
      };
    case 'awake':
    case 'viewer':
      return { baby, events: morning(now, 112), predictions: prediction(now) };
  }
}

async function seed(db: BabyRoutineDb, scenario: Scenario): Promise<Seeded> {
  const seeded = seedFor(scenario, Date.now());
  await Promise.all([
    db.babies.clear(),
    db.eventTypes.clear(),
    db.events.clear(),
    db.medications.clear(),
    db.prescriptions.clear(),
    db.bodyWeights.clear(),
  ]);
  await db.babies.put(seeded.baby);
  await db.eventTypes.bulkPut(TYPES);
  await db.medications.bulkPut(MEDICATIONS);
  await db.events.bulkPut(seeded.events);
  if (scenario === 'meds') {
    await db.prescriptions.bulkPut(prescriptionsFor(Date.now()));
    const weighed = new Date(Date.now() - 6 * 24 * 60 * MIN);
    await db.bodyWeights.put({
      babyId: BABY_ID,
      kg: 4.6,
      date: `${weighed.getFullYear()}-${String(weighed.getMonth() + 1).padStart(2, '0')}-${String(weighed.getDate()).padStart(2, '0')}`,
    });
  }
  return seeded;
}

function Toolbar({
  scenario,
  onScenario,
}: {
  scenario: Scenario;
  onScenario: (s: Scenario) => void;
}) {
  const { mode, scheme, setMode } = useThemeMode();
  const night = useNightFeed();
  const { locale, setPreference } = useLocale();
  void mode;
  const setScheme = (next: Scheme) => {
    if (next === 'night') {
      if (!night.active) night.toggle();
      return;
    }
    setMode(next);
    if (night.active) night.toggle();
  };
  return (
    <Box sx={{ display: 'grid', gap: 1, p: 1, bgcolor: 'background.paper' }}>
      <select
        aria-label="Scenario"
        value={scenario}
        onChange={(event) => onScenario(event.target.value as Scenario)}
      >
        {SCENARIOS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <SegmentedControl<Scheme>
        aria-label="Colour scheme"
        value={scheme}
        onChange={(value) => value && setScheme(value)}
        options={[
          { value: 'light', label: 'Light' },
          { value: 'dark', label: 'Dark' },
          { value: 'night', label: 'Night' },
        ]}
      />
      <SegmentedControl<'en' | 'pt-BR'>
        aria-label="Language"
        value={locale}
        onChange={(value) => value && setPreference(value)}
        options={[
          { value: 'en', label: 'English' },
          { value: 'pt-BR', label: 'Português' },
        ]}
      />
    </Box>
  );
}

/** Developer-only: the Now screen with seeded local data (route `/dev/now?state=awake`). */
export default function NowPreview() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('state');
  const scenario: Scenario = SCENARIOS.find((s) => s === requested) ?? 'awake';
  const [db] = useState(() => createDatabase('dev-now-preview'));
  const [ready, setReady] = useState<{ scenario: Scenario; baby: Baby } | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    let live = true;
    void (async () => {
      const seeded = await seed(db, scenario);
      queryClient.setQueryData(['predictions', BABY_ID], seeded.predictions);
      queryClient.setQueryData(
        ['members', BABY_ID],
        [{ userId: 'u-ana', displayName: 'Ana', role: 'Parent', joinedAt: '2026-10-01' }],
      );
      writeLastSeenAt(
        BABY_ID,
        new Date(Date.now() - (seeded.lastSeenMinAgo ?? 0) * MIN).toISOString(),
      );
      if (live) setReady({ scenario, baby: seeded.baby });
    })();
    return () => {
      live = false;
    };
  }, [db, scenario, queryClient]);

  return (
    <DatabaseProvider db={db}>
      <AddSheetProvider enabled={scenario !== 'viewer'}>
        <Box sx={{ bgcolor: 'background.default', color: 'text.primary', minHeight: '100dvh' }}>
          <Box sx={{ maxWidth: 480, mx: 'auto', px: 2, pt: 1, pb: 12 }}>
            <Typography variant="h5" component="p" sx={{ py: 1 }}>
              Lia
            </Typography>
            {ready?.scenario === scenario && <NowScreen key={scenario} baby={ready.baby} />}
            <Toolbar
              scenario={scenario}
              onScenario={(next) => setParams({ state: next }, { replace: true })}
            />
          </Box>
          <BottomNav />
        </Box>
      </AddSheetProvider>
    </DatabaseProvider>
  );
}
