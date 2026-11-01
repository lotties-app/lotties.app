import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Typography } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { createDatabase, type BabyRoutineDb } from '../db/database';
import { DatabaseProvider } from '../db/DatabaseProvider';
import type { Baby, BabyEvent, EventPayload } from '../db/models';
import { InsightsSection } from '../insights/InsightsSection';
import { AddSheetProvider } from '../layout/AddSheetProvider';
import { BottomNav } from '../layout/BottomNav';
import { PREVIEW_BABY_ID, PREVIEW_TYPES, typeIdOf } from './previewData';
import { PreviewToolbar } from './PreviewToolbar';

/*
 * Developer-only (route `/dev/insights`, never in production builds): the Insights section on a
 * throw-away local database, no sign-in and no server. `?state=rich` is a baby with 14 days of
 * history (every insight open), `partial` 5 days (the rhythm still on its way), `short` 2 days
 * (nothing open yet: progress rows with estimates), `empty` nothing logged.
 */

const SCENARIOS = ['rich', 'partial', 'short', 'empty'] as const;
type Scenario = (typeof SCENARIOS)[number];
const DAYS: Record<Scenario, number> = { rich: 14, partial: 5, short: 2, empty: 0 };

function at(day: Date, hour: number, minute = 0, dayOffset = 0): string {
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate() + dayOffset,
    hour,
    minute,
  ).toISOString();
}

function make(
  key: string,
  start: string,
  end: string | null,
  payload: EventPayload = {},
): BabyEvent {
  return {
    id: `dev-insights-${key}-${start}`,
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
  };
}

/** A small deterministic wobble so the days are not identical. */
const wobble = (index: number, spread: number) => ((index * 37) % (2 * spread + 1)) - spread;

/** One day of a 3-month-old, `back` days before today (0 = today, logged until mid-afternoon). */
function dayOf(today: Date, back: number): BabyEvent[] {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
  const w = (spread: number, salt = 0) => wobble(back + salt, spread);
  const events: BabyEvent[] = [
    make('sleep', at(day, 8, 40 + w(10)), at(day, 9, 50 + w(15, 1)), { kind: 'nap' }),
    make('sleep', at(day, 12, 20 + w(15, 2)), at(day, 13, 45 + w(20, 3)), {
      kind: 'nap',
      ...(back % 3 === 0 ? { pause_count: 1, paused_seconds: 420 } : {}),
    }),
    make('sleep', at(day, 16, 10 + w(10, 4)), at(day, 16, 50 + w(10, 5)), { kind: 'nap' }),
    make('feeding', at(day, 6, 30 + w(10, 6)), at(day, 6, 50 + w(5, 7)), { method: 'breast' }),
    make('feeding', at(day, 10, 5 + w(10, 8)), at(day, 10, 20 + w(5, 9)), {
      method: 'bottle',
      amount_ml: 120 + w(2, 10) * 10,
      bottle_feeding_type: 'formula',
    }),
    make('feeding', at(day, 13, 55 + w(5, 11)), at(day, 14, 10 + w(5, 12)), { method: 'breast' }),
    make('feeding', at(day, 17, 10 + w(10, 13)), at(day, 17, 25), {
      method: 'bottle',
      amount_ml: 150,
      bottle_feeding_type: 'breast_milk',
    }),
    make('feeding', at(day, 19, 15 + w(5, 14)), at(day, 19, 35), { method: 'breast' }),
    make('feeding', at(day, 23, 30 + w(15, 15)), at(day, 23, 50 + w(5, 15)), {
      method: 'bottle',
      amount_ml: 120,
      bottle_feeding_type: 'formula',
    }),
    make('diaper', at(day, 7, 0), at(day, 7, 0), { content: 'WET' }),
    make('diaper', at(day, 10, 30), at(day, 10, 30), { content: back % 2 ? 'DIRTY' : 'MIXED' }),
    make('diaper', at(day, 14, 20), at(day, 14, 20), { content: 'WET' }),
    make('diaper', at(day, 18, 0), at(day, 18, 0), { content: back % 3 ? 'WET' : 'DIRTY' }),
    make('diaper', at(day, 21, 45), at(day, 21, 45), { content: 'WET' }),
    make('sleep', at(day, 19, 30 + w(10, 16)), at(day, 19, 30 + w(10, 16)), { kind: 'bed_time' }),
    // The night crosses midnight; a waking around 02:00 on most nights.
    make('sleep', at(day, 19, 50 + w(15, 17)), at(day, 6, 10 + w(20, 18), 1), { kind: 'night' }),
    ...(back % 4 !== 1
      ? [
          make('sleep', at(day, 2, 5 + w(20, 19), 1), at(day, 2, 35 + w(10, 20), 1), {
            kind: 'night_waking',
          }),
        ]
      : []),
  ];
  // Today is not over: only what already happened.
  const now = Date.now();
  return events
    .filter((event) => Date.parse(event.startedAt) <= now)
    .map((event) =>
      event.endedAt !== null && Date.parse(event.endedAt) > now
        ? { ...event, endedAt: null }
        : event,
    );
}

async function seed(db: BabyRoutineDb, scenario: Scenario): Promise<Baby> {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const baby: Baby = { id: PREVIEW_BABY_ID, name: 'Lia', birthDate: '2026-07-20', role: 'Owner' };
  await Promise.all([db.babies.clear(), db.eventTypes.clear(), db.events.clear()]);
  await db.babies.put(baby);
  await db.eventTypes.bulkPut(PREVIEW_TYPES);
  const days = DAYS[scenario];
  // The rich baby logs today too; the others stopped yesterday.
  const offset = scenario === 'rich' ? 0 : 1;
  const events: BabyEvent[] = [];
  for (let back = offset; back < days + offset; back++) events.push(...dayOf(today, back));
  if (scenario !== 'rich') {
    // Nothing logged today yet: only the days before.
    const startOfToday = today.toISOString();
    await db.events.bulkPut(events.filter((event) => event.startedAt < startOfToday));
  } else {
    await db.events.bulkPut(events);
  }
  return baby;
}

/** Developer-only: the Insights section with seeded local data (route `/dev/insights?state=rich`). */
export default function InsightsPreview() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const requested = params.get('state');
  const scenario: Scenario = SCENARIOS.find((s) => s === requested) ?? 'rich';
  const [db] = useState(() => createDatabase('dev-insights-preview'));
  const [ready, setReady] = useState<{ scenario: Scenario; baby: Baby } | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      const baby = await seed(db, scenario);
      if (live) setReady({ scenario, baby });
    })();
    return () => {
      live = false;
    };
  }, [db, scenario]);

  return (
    <DatabaseProvider db={db}>
      <AddSheetProvider enabled={false}>
        <Box sx={{ bgcolor: 'background.default', color: 'text.primary', minHeight: '100dvh' }}>
          <Box
            sx={{
              maxWidth: 480,
              mx: 'auto',
              px: 2,
              pt: 1,
              pb: 14,
              display: 'grid',
              gap: 3,
              gridTemplateColumns: 'minmax(0, 1fr)',
            }}
          >
            <Typography variant="h4" component="h1" sx={{ pt: 1 }}>
              {t('nav.insights')}
            </Typography>
            {ready?.scenario === scenario && <InsightsSection key={scenario} baby={ready.baby} />}
            <PreviewToolbar
              scenarios={SCENARIOS}
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
