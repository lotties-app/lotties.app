import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Box, Typography } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { AddSheetProvider } from '../layout/AddSheetProvider';
import { BottomNav } from '../layout/BottomNav';
import { NAV_CONTENT_PADDING } from '../layout/navMetrics';
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
import {
  DIAPER_TYPE,
  FEEDING_TYPE,
  FUSSY_TYPE,
  SLEEP_TYPE,
  TUMMY_TIME_TYPE,
} from '../test/builtInTypes';
import { RunningTimerPill } from '../timers/RunningTimerPill';
import { CatchUpButton } from '../now/ui/CatchUpButton';
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
  'paused',
  'timers',
  'belly',
  'overtired',
  'fussy',
  'wet',
  'dirty',
  'bottle',
  'bottlesleep',
  'stack',
  'caregiver',
  'cry',
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
  TUMMY_TIME_TYPE,
  extraType('belly_massage', 'Belly massage', 'massage', true),
  FUSSY_TYPE,
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

const DAY_MIN = 24 * 60;
/** Minutes before `now` of the usual belly pain time in the `belly` scenario (window opened 10 min ago). */
const BELLY_TYPICAL_AGO = -20;
const BELLY_DAYS = [1, 2, 3, 5, 6, 8];

/** `yyyy-mm-dd` of the local date `minAgo` minutes before `now`. */
function dateAgo(now: number, minAgo: number): string {
  const d = new Date(now - minAgo * MIN);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** The server's belly pain pattern for the `belly` scenario: usual window 10 min ago to 50 min from now. */
function bellyPredictions(now: number): PredictionsDto {
  const jitter = [5, -10, 0, 15, -5, 10];
  return {
    ...prediction(now),
    patterns: [
      {
        typeKey: 'belly_pain',
        typicalClock: clockAgo(now, BELLY_TYPICAL_AGO),
        windowStart: clockAgo(now, BELLY_TYPICAL_AGO + 30),
        windowEnd: clockAgo(now, BELLY_TYPICAL_AGO - 30),
        windowMinutes: 60,
        spreadMinutes: 9,
        confidence: 'Medium',
        eventDayCount: 6,
        recentDayCount: 5,
        timeZone: null,
        days: BELLY_DAYS.map((day, index) => {
          const ago = day * DAY_MIN + BELLY_TYPICAL_AGO - jitter[index];
          return { date: dateAgo(now, ago), times: [clockAgo(now, ago)] };
        }).reverse(),
        rule: {
          lookBackDays: 14,
          recentDays: 7,
          minimumRecentDays: 4,
          maximumSpreadMinutes: 45,
          minimumCoveragePercent: 60,
          leadMinutes: 45,
        },
      },
    ],
  };
}

/** Minutes awake in the `overtired` scenario: 10 min before the usual limit of 2h 30m. */
const OVERTIRED_AWAKE_MIN = 140;

/** The server's wake window for the `overtired` scenario: nine daytime stretches, limit 2h 30m. */
function overtiredPredictions(now: number): PredictionsDto {
  const lengths = [95, 120, 150, 110, 150, 135, 160, 125, 150];
  const stretches = lengths.map((minutes, index) => {
    const startAgo = (lengths.length - index) * DAY_MIN - 9 * 60 + index * 17;
    return {
      start: new Date(now - startAgo * MIN).toISOString(),
      end: new Date(now - (startAgo - minutes) * MIN).toISOString(),
      minutes,
    };
  });
  return {
    ...prediction(now),
    wakeWindow: {
      limitMinutes: 150,
      sampleCount: stretches.length,
      awakeSince: new Date(now - OVERTIRED_AWAKE_MIN * MIN).toISOString(),
      awakeMinutes: OVERTIRED_AWAKE_MIN,
      timeZone: null,
      stretches,
      rule: {
        lookBackDays: 14,
        dayStartsAt: '05:00',
        dayEndsAt: '18:00',
        percentile: 75,
        minimumStretches: 5,
        leadMinutes: 15,
        graceMinutes: 30,
      },
    },
  };
}

/** Minutes before `now` of the usual fussy time in the `fussy` scenario (window opened 10 min ago). */
const FUSSY_TYPICAL_AGO = -20;
const FUSSY_DAYS = [1, 2, 3, 4, 6, 7, 9];

/** The server's fussy pattern for the `fussy` scenario: usual window 10 min ago to 50 min from now. */
function fussyPredictions(now: number): PredictionsDto {
  const jitter = [10, -5, 0, 15, -10, 5, 0];
  return {
    ...prediction(now),
    patterns: [
      {
        typeKey: 'fussy',
        typicalClock: clockAgo(now, FUSSY_TYPICAL_AGO),
        windowStart: clockAgo(now, FUSSY_TYPICAL_AGO + 30),
        windowEnd: clockAgo(now, FUSSY_TYPICAL_AGO - 30),
        windowMinutes: 60,
        spreadMinutes: 8,
        confidence: 'Medium',
        eventDayCount: 7,
        recentDayCount: 6,
        timeZone: null,
        days: FUSSY_DAYS.map((day, index) => {
          const ago = day * DAY_MIN + FUSSY_TYPICAL_AGO - jitter[index];
          return { date: dateAgo(now, ago), times: [clockAgo(now, ago)] };
        }).reverse(),
        rule: {
          lookBackDays: 14,
          recentDays: 7,
          minimumRecentDays: 4,
          maximumSpreadMinutes: 45,
          minimumCoveragePercent: 60,
          leadMinutes: 45,
        },
      },
    ],
  };
}

const DIAPER_RULE = {
  wetLookBackDays: 7,
  minimumWetEvents: 8,
  dirtyLookBackDays: 14,
  minimumDirtyEvents: 5,
  lowerPercentile: 25,
  upperPercentile: 75,
  feedWindowMinutes: 180,
  minimumFeedPairs: 5,
  maximumLagSpreadMinutes: 40,
  leadMinutes: 20,
  graceMinutes: 40,
};

/** Minutes before `now` of the latest wet diaper of the `wet` scenario (the morning's). */
const WET_AGO = 142;
/** Minutes before `now` the feed of the `dirty` scenario ended. */
const FEED_ENDED_AGO = 28;

/**
 * The server's diaper predictions: `wet` expects the next wet diaper 8 min from now (usual gap
 * 2h30); `dirty` has the lag after feeds (25-40 min, median 30) and no wet estimate.
 */
function diaperPredictions(now: number, kind: 'wet' | 'dirty'): PredictionsDto {
  const at = (minAgo: number) => new Date(now - minAgo * MIN).toISOString();
  const wet = {
    anchorAt: at(WET_AGO),
    nextStart: {
      earliest: at(WET_AGO - 130),
      expected: at(WET_AGO - 150),
      latest: at(WET_AGO - 170),
    },
    lowerGapMinutes: 130,
    medianGapMinutes: 150,
    upperGapMinutes: 170,
    eventCount: 46,
    gapCount: 45,
    confidence: 'Medium' as const,
    trend: { last24Hours: 8, usualPer24Hours: 7.4, droppedSharply: false },
  };
  const gap = {
    ...wet,
    anchorAt: at(312),
    lowerGapMinutes: 360,
    medianGapMinutes: 470,
    upperGapMinutes: 610,
    eventCount: 19,
    gapCount: 18,
    confidence: 'Low' as const,
    trend: null,
  };
  return {
    ...prediction(now),
    diaper: {
      wet: kind === 'wet' ? wet : null,
      dirty: {
        lastDirtyAt: at(312),
        gap: { ...gap, nextStart: { earliest: at(-48), expected: at(-158), latest: at(-298) } },
        afterFeed: {
          lowerLagMinutes: 25,
          medianLagMinutes: 30,
          upperLagMinutes: 40,
          pairCount: 11,
          confidence: 'Medium',
          latestFeedEndedAt: at(kind === 'dirty' ? FEED_ENDED_AGO : 242),
        },
      },
      rule: DIAPER_RULE,
    },
  };
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
    case 'paused':
      return {
        baby,
        events: [
          ...morning(now, 400),
          eventAt(now, 'sleep', 38, null, {
            kind: 'nap',
            pause_count: 1,
            paused_seconds: 240,
            paused_at: new Date(now - 130 * 1000).toISOString(),
          }),
        ],
        predictions: prediction(now),
      };
    case 'timers':
      return {
        baby,
        events: [
          ...morning(now, 400),
          eventAt(now, 'sleep', 24, null, { kind: 'nap', pause_count: 1, paused_seconds: 180 }),
          eventAt(now, 'tummy_time', 5, null, {}),
        ],
        predictions: prediction(now),
      };
    case 'belly':
      return {
        baby,
        events: [
          ...morning(now, 112),
          ...BELLY_DAYS.map((day) =>
            eventAt(
              now,
              'belly_pain',
              day * DAY_MIN + BELLY_TYPICAL_AGO,
              day * DAY_MIN + BELLY_TYPICAL_AGO,
              {
                intensity: 3,
              },
            ),
          ),
        ],
        predictions: bellyPredictions(now),
      };
    case 'overtired':
      return {
        baby,
        events: morning(now, OVERTIRED_AWAKE_MIN),
        predictions: overtiredPredictions(now),
      };
    case 'fussy':
      return {
        baby,
        events: [
          ...morning(now, 112),
          ...FUSSY_DAYS.map((day) =>
            eventAt(
              now,
              'fussy',
              day * DAY_MIN + FUSSY_TYPICAL_AGO,
              day * DAY_MIN + FUSSY_TYPICAL_AGO - 35,
              { intensity: 'moderate', what_helped: 'rocking' },
            ),
          ),
        ],
        predictions: fussyPredictions(now),
      };
    case 'wet':
      return { baby, events: morning(now, 112), predictions: diaperPredictions(now, 'wet') };
    case 'dirty':
      return {
        baby,
        events: [
          ...morning(now, 112),
          eventAt(now, 'feeding', FEED_ENDED_AGO + 15, FEED_ENDED_AGO, {
            method: 'bottle',
            amount_ml: 120,
            bottle_feeding_type: 'formula',
          }),
        ],
        predictions: diaperPredictions(now, 'dirty'),
      };
    case 'bottle':
      return {
        baby,
        events: [...morning(now, 112), eventAt(now, 'feeding', 6, null, RUNNING_BOTTLE)],
        predictions: prediction(now),
      };
    case 'bottlesleep':
      // She fell asleep during the bottle: the follow-up asks how much was left.
      return {
        baby,
        events: [
          ...morning(now, 400),
          eventAt(now, 'feeding', 40, 14, { ...RUNNING_BOTTLE, ended_by: 'sleep' }),
          eventAt(now, 'sleep', 14, null, { kind: 'nap' }),
        ],
        predictions: prediction(now),
      };
    case 'stack':
      return {
        baby,
        events: [
          ...morning(now, 400),
          eventAt(now, 'sleep', 24, null, { kind: 'nap' }),
          eventAt(now, 'feeding', 6, null, RUNNING_BOTTLE),
          eventAt(now, 'tummy_time', 9, null, {
            pause_count: 1,
            paused_seconds: 60,
            paused_at: new Date(now - 70 * 1000).toISOString(),
          }),
          eventAt(now, 'bath', 3, null, {}),
        ],
        predictions: prediction(now),
      };
    case 'caregiver':
      return {
        baby: { ...baby, role: 'Caregiver', userId: 'u-me' },
        events: [
          ...morning(now, 95),
          eventAt(
            now,
            'feeding',
            8,
            null,
            { method: 'breast', side: 'left', side_since: new Date(now - 8 * MIN).toISOString() },
            { createdBy: 'u-ana' },
          ),
          eventAt(now, 'feeding', 4, null, RUNNING_BOTTLE, { createdBy: 'u-ana' }),
        ],
        predictions: prediction(now),
      };
    case 'viewer':
      return {
        baby,
        events: [...morning(now, 112), eventAt(now, 'feeding', 6, null, RUNNING_BOTTLE)],
        predictions: prediction(now),
      };
    case 'cry':
      return { baby, events: cryLog(now), predictions: empty };
    case 'awake':
      return { baby, events: morning(now, 112), predictions: prediction(now) };
  }
}

/** What helped in the answered fussy spells of the `cry` scenario (newest first). */
const CRY_ANSWERS = ['holding', 'feeding', 'rocking', 'feeding', 'burping'];

/**
 * "Why is she crying?" (`cry`): feeds every 2h 30m (the last 2h 40m ago, so hunger leads), a nap
 * that ended 30 min ago, a diaper an hour ago and five answered fussy spells for the hint.
 */
function cryLog(now: number): BabyEvent[] {
  const feeds = [160, 310, 460, 610, 760].map((ago) =>
    eventAt(now, 'feeding', ago, ago - 15, { method: 'breast', side: 'left' }),
  );
  const spells = CRY_ANSWERS.map((helped, index) => {
    const ago = (index + 1) * DAY_MIN - 90;
    return eventAt(now, 'fussy', ago, ago - 25, { intensity: 'moderate', what_helped: helped });
  });
  return [
    ...feeds,
    eventAt(now, 'sleep', 110, 30, { kind: 'nap' }),
    eventAt(now, 'diaper', 60, 60, { content: 'WET' }),
    ...spells,
  ];
}

/** A bottle being given: what the "Running now" card shows as "Bottle · 120 ml". */
const RUNNING_BOTTLE = { method: 'bottle', amount_ml: 120, bottle_feeding_type: 'formula' };

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
          <Box sx={{ maxWidth: 480, mx: 'auto', px: 2, pt: 1, pb: NAV_CONTENT_PADDING }}>
            <Typography variant="h5" component="p" sx={{ py: 1 }}>
              Lia
            </Typography>
            {ready?.scenario === scenario && <NowScreen key={scenario} baby={ready.baby} />}
            <Toolbar
              scenario={scenario}
              onScenario={(next) => setParams({ state: next }, { replace: true })}
            />
          </Box>
          {ready?.scenario === scenario && (
            <Box sx={{ position: 'fixed', top: 8, right: 8, zIndex: 1100, display: 'flex' }}>
              <RunningTimerPill key={scenario} baby={ready.baby} />
              <CatchUpButton babyId={ready.baby.id} />
            </Box>
          )}
          <BottomNav />
        </Box>
      </AddSheetProvider>
    </DatabaseProvider>
  );
}
