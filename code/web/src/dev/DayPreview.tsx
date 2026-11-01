import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Box, Typography } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { DayScreen } from '../day/DayScreen';
import { createDatabase, type BabyRoutineDb } from '../db/database';
import { DatabaseProvider } from '../db/DatabaseProvider';
import { createEvent } from '../db/eventCommands';
import type { Baby, BabyEvent, EventPayload } from '../db/models';
import { DeletedEventSnackbar } from '../events/DeletedEventSnackbar';
import { AddSheetProvider } from '../layout/AddSheetProvider';
import { BottomNav } from '../layout/BottomNav';
import { NAV_CONTENT_PADDING } from '../layout/navMetrics';
import { RunningTimerPill } from '../timers/RunningTimerPill';
import { MORE_BUILT_IN_TYPES } from '../test/builtInTypes';
import { PREVIEW_BABY_ID, PREVIEW_MEDICATIONS, PREVIEW_TYPES, typeIdOf } from './previewData';
import { PreviewToolbar } from './PreviewToolbar';

/*
 * Developer-only (route `/dev/day`, never in production builds): the Day screen on a throw-away
 * local database, seeded per scenario, with no sign-in and no server. `?state=full` is a busy day
 * (yesterday, `offset=1`) with a night that crosses midnight; `?offset=0` is today with a running
 * timer; `busy` seeds about 1,200 events for a speed check; `caregiver` is the full day seen by a
 * Caregiver ("Lu") where most entries were logged by "Ana" (read-only rows, "Given by Ana").
 */

const SCENARIOS = ['full', 'empty', 'busy', 'viewer', 'timers', 'caregiver', 'moretypes'] as const;
type Scenario = (typeof SCENARIOS)[number];
const MIN = 60_000;

function at(day: Date, hour: number, minute = 0): string {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute).toISOString();
}

function make(
  key: string,
  start: string,
  end: string | null,
  payload: EventPayload = {},
  extra: Partial<BabyEvent> = {},
): BabyEvent {
  return {
    id: `dev-day-${key}-${start}`,
    babyId: PREVIEW_BABY_ID,
    typeId: typeIdOf(key),
    startedAt: start,
    endedAt: end,
    payload,
    notes: null,
    createdBy: null,
    createdAt: start,
    updatedAt: start,
    deletedAt: null,
    ...extra,
  };
}

/** A whole day of a young baby, on the local calendar day of `day`. */
function fullDay(day: Date): BabyEvent[] {
  const next = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  return [
    make('sleep', at(day, 6, 30), at(day, 6, 30), { kind: 'woke_up' }),
    make('feeding', at(day, 6, 40), at(day, 6, 58), {
      method: 'breast',
      side: 'left',
      breast_left_seconds: 480,
      breast_right_seconds: 360,
    }),
    make('diaper', at(day, 7, 5), at(day, 7, 5), { content: 'WET' }),
    make('sleep', at(day, 8, 45), at(day, 9, 40), { kind: 'nap' }),
    // A timed bottle (18 min); the 13:40 one is an older instant bottle without a duration.
    make('feeding', at(day, 9, 50), at(day, 10, 8), {
      method: 'bottle',
      amount_ml: 120,
      bottle_feeding_type: 'formula',
    }),
    make('diaper', at(day, 10, 20), at(day, 10, 20), { content: 'DIRTY' }),
    make('medication', at(day, 11, 40), at(day, 11, 40), {
      medications: [
        { medicationId: 'm2', name: 'Vitamin D' },
        { medicationId: 'm1', name: 'Colidis', dose: { amount: 5, unit: 'drops' } },
      ],
    }),
    make('sleep', at(day, 12, 10), at(day, 13, 25), {
      kind: 'nap',
      how_slept: 'in_bed',
      fall_asleep: 'took_long',
      time_to_fall_asleep_minutes: 12,
      how_woke: 'naturally',
      mood_on_wake: 'good',
      pause_count: 2,
      paused_seconds: 600,
    }),
    make('feeding', at(day, 13, 40), at(day, 13, 40), {
      method: 'bottle',
      amount_ml: 90,
      bottle_feeding_type: 'breast_milk',
    }),
    make('feeding', at(day, 15, 10), at(day, 15, 25), { method: 'solid', food: 'Pumpkin puree' }),
    make('diaper', at(day, 15, 30), at(day, 15, 30), { content: 'MIXED' }),
    make('bath', at(day, 17, 45), at(day, 17, 58), { temperature_c: 37 }),
    make('belly_pain', at(day, 18, 20), at(day, 18, 20), { intensity: 3 }),
    make('sleep', at(day, 19, 20), at(day, 19, 20), { kind: 'bed_time' }),
    make('sleep', at(day, 19, 40), at(next, 5, 50), { kind: 'night' }),
    make('feeding', at(day, 22, 15), at(day, 22, 15), {
      method: 'bottle',
      amount_ml: 150,
      bottle_feeding_type: 'formula',
    }),
    make('sleep', at(day, 23, 50), at(next, 0, 25), { kind: 'night_waking' }),
  ];
}

/**
 * The `moretypes` scenario: one day with the built-in types of the `MoreEventTypes` migration, to
 * review their Day rows (a temperature reads as the number only, never judged).
 */
function moreTypesDay(day: Date): BabyEvent[] {
  const of = (key: string) => MORE_BUILT_IN_TYPES.find((type) => type.key === key)!.id;
  const instant = (key: string, hour: number, minute: number, payload: EventPayload) =>
    make(key, at(day, hour, minute), at(day, hour, minute), payload, { typeId: of(key) });
  return [
    instant('temperature', 8, 10, { value_c: 37.8, method: 'armpit' }),
    instant('nail_trim', 9, 0, { where: 'both' }),
    instant('spit_up', 10, 15, { kind: 'spit_up', amount: 'little' }),
    instant('teething', 11, 0, { stage: 'tooth_came_through', tooth: 'lower_central_incisor' }),
    make(
      'outdoor',
      at(day, 15, 0),
      at(day, 15, 40),
      { kind: 'stroller_walk' },
      {
        typeId: of('outdoor'),
      },
    ),
    instant('milestone', 16, 20, { milestone: 'rolls_over' }),
    instant('symptom', 17, 30, { symptom: 'runny_nose', severity: 'mild' }),
    instant('skin_care', 19, 0, { product: 'diaper_cream' }),
    instant('temperature', 20, 30, { value_c: 38.4 }),
  ];
}

const CAREGIVER_ID = 'dev-me';
const ANA_ID = 'dev-ana';
const PREVIEW_MEMBERS = [
  { userId: ANA_ID, displayName: 'Ana', role: 'Owner', joinedAt: '2026-08-01T10:00:00.000Z' },
  {
    userId: CAREGIVER_ID,
    displayName: 'Lu',
    role: 'Caregiver',
    joinedAt: '2026-10-01T10:00:00.000Z',
  },
];

/** The caregiver scenario: the diapers are the caregiver's own, everything else is Ana's. */
function loggedByAnaOrMe(event: BabyEvent): BabyEvent {
  return { ...event, createdBy: event.typeId === typeIdOf('diaper') ? CAREGIVER_ID : ANA_ID };
}

/** About 1,200 events over 60 days, for the speed check. */
function busyHistory(today: Date): BabyEvent[] {
  const events: BabyEvent[] = [];
  for (let back = 0; back < 60; back++) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    const base = fullDay(day);
    events.push(...base);
    for (let extra = 0; extra < 3; extra++) {
      events.push(
        make('diaper', at(day, 8 + extra * 4, 15), at(day, 8 + extra * 4, 15), { content: 'WET' }),
      );
    }
  }
  return events;
}

async function seed(db: BabyRoutineDb, scenario: Scenario): Promise<Baby> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  const baby: Baby = {
    id: PREVIEW_BABY_ID,
    name: 'Lia',
    birthDate: '2026-08-01',
    role: scenario === 'viewer' ? 'Viewer' : scenario === 'caregiver' ? 'Caregiver' : 'Owner',
    ...(scenario === 'caregiver' ? { userId: CAREGIVER_ID } : {}),
  };
  await Promise.all([
    db.babies.clear(),
    db.eventTypes.clear(),
    db.events.clear(),
    db.medications.clear(),
    db.outbox.clear(),
  ]);
  await db.babies.put(baby);
  await db.eventTypes.bulkPut(
    scenario === 'moretypes' ? [...PREVIEW_TYPES, ...MORE_BUILT_IN_TYPES] : PREVIEW_TYPES,
  );
  await db.medications.bulkPut(PREVIEW_MEDICATIONS);
  if (scenario === 'empty') return baby;
  if (scenario === 'moretypes') {
    await db.events.bulkPut(moreTypesDay(yesterday));
    return baby;
  }
  if (scenario === 'busy') {
    await db.events.bulkPut(busyHistory(today));
    return baby;
  }
  await db.events.bulkPut(
    scenario === 'caregiver' ? fullDay(yesterday).map(loggedByAnaOrMe) : fullDay(yesterday),
  );

  // Today: a few recent events, a running timer, one unsynced and one rejected row.
  const ago = (minutes: number) => new Date(now.getTime() - minutes * MIN).toISOString();
  const startOfToday = today.getTime();
  const recent = [
    make('sleep', ago(95), ago(35), { kind: 'nap' }),
    make('feeding', ago(30), ago(30), {
      method: 'bottle',
      amount_ml: 120,
      bottle_feeding_type: 'formula',
    }),
    make('diaper', ago(20), ago(20), { content: 'WET' }),
    make('tummy_time', ago(7), null),
    ...(scenario === 'timers'
      ? [make('sleep', ago(42), null, { kind: 'nap', pause_count: 1, paused_seconds: 300 })]
      : []),
  ]
    .filter((event) => Date.parse(event.startedAt) >= startOfToday)
    // Stable ids: seeding twice (StrictMode runs effects twice) must not duplicate the rows.
    .map((event, index) => ({ ...event, id: `dev-day-recent-${index}` }))
    .map((event) => (scenario === 'caregiver' ? { ...event, createdBy: ANA_ID } : event));
  await db.events.bulkPut(recent);
  if (now.getTime() - startOfToday > 15 * MIN) {
    const pending = await createEvent(
      db,
      {
        babyId: PREVIEW_BABY_ID,
        typeId: typeIdOf('feeding'),
        startedAt: ago(10),
        endedAt: ago(10),
        payload: { method: 'bottle', amount_ml: 60, bottle_feeding_type: 'breast_milk' },
      },
      { newId: () => 'dev-day-pending' },
    );
    const failed = await createEvent(
      db,
      {
        babyId: PREVIEW_BABY_ID,
        typeId: typeIdOf('belly_pain'),
        startedAt: ago(12),
        endedAt: ago(12),
        payload: { intensity: 2 },
      },
      { newId: () => 'dev-day-failed' },
    );
    await db.outbox
      .where('entityId')
      .equals(failed.id)
      .modify({ status: 'dead', needsAttention: true });
    void pending;
  }
  return baby;
}

/** Developer-only: the Day screen with seeded local data (route `/dev/day?state=full&offset=1`). */
export default function DayPreview() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('state');
  const scenario: Scenario = SCENARIOS.find((s) => s === requested) ?? 'full';
  const offset = Number(params.get('offset') ?? 0) || 0;
  const [db] = useState(() => createDatabase('dev-day-preview'));
  const [ready, setReady] = useState<{ scenario: Scenario; baby: Baby } | null>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    let live = true;
    void (async () => {
      const baby = await seed(db, scenario);
      queryClient.setQueryData(['members', PREVIEW_BABY_ID], PREVIEW_MEMBERS);
      if (live) setReady({ scenario, baby });
    })();
    return () => {
      live = false;
    };
  }, [db, scenario, queryClient]);

  const today = new Date();
  const initialDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
  return (
    <DatabaseProvider db={db}>
      <AddSheetProvider enabled={scenario !== 'viewer'}>
        <Box sx={{ bgcolor: 'background.default', color: 'text.primary', minHeight: '100dvh' }}>
          <Box sx={{ maxWidth: 640, mx: 'auto', px: 2, pt: 1, pb: NAV_CONTENT_PADDING }}>
            <Typography variant="h5" component="p" sx={{ py: 1 }}>
              Lia
            </Typography>
            {ready?.scenario === scenario && (
              <DayScreen key={`${scenario}-${offset}`} baby={ready.baby} initialDay={initialDay} />
            )}
            <PreviewToolbar
              scenarios={SCENARIOS}
              scenario={scenario}
              onScenario={(next) =>
                setParams({ state: next, offset: String(offset) }, { replace: true })
              }
            />
          </Box>
          {ready?.scenario === scenario && (
            <Box sx={{ position: 'fixed', top: 8, right: 8, zIndex: 1100, display: 'flex' }}>
              <RunningTimerPill key={scenario} baby={ready.baby} />
            </Box>
          )}
          <BottomNav />
          <DeletedEventSnackbar />
        </Box>
      </AddSheetProvider>
    </DatabaseProvider>
  );
}
