import { useEffect, useState } from 'react';
import { Box } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientContext } from '../api/ApiClientContext';
import { AuthContext, type AuthApi } from '../auth/AuthContext';
import { SelectedBabyProvider } from '../baby/SelectedBabyProvider';
import { createDatabase, type BabyRoutineDb } from '../db/database';
import { DatabaseProvider } from '../db/DatabaseProvider';
import type { Baby, BabyEvent, EventPayload } from '../db/models';
import { AddSheetProvider } from '../layout/AddSheetProvider';
import { BottomNav } from '../layout/BottomNav';
import { InsightsPage } from '../pages/InsightsPage';
import { FUSSY_TYPE, TEMPERATURE_TYPE } from '../test/builtInTypes';
import { fakeApi, httpError } from '../test/fakeApi';
import { PREVIEW_BABY_ID, PREVIEW_TYPES, typeIdOf } from './previewData';
import { PreviewToolbar } from './PreviewToolbar';

/*
 * Developer-only (route `/dev/day-summary`, never in production builds): the real Insights page
 * (its tab bar, Insights first) over a throw-away local database and an in-memory API, for the
 * invented baby Lia. `?state=rich` is ten logged days and today so far (every Day card and its
 * usual line; open the Day tab), `quiet` only today (no usual line yet), `empty` nothing today.
 * No sign-in, no server, no real person.
 */

const SCENARIOS = ['rich', 'quiet', 'empty'] as const;
type Scenario = (typeof SCENARIOS)[number];

const AUTH: AuthApi = {
  user: { name: 'Ana' },
  accountId: 'dev|day-summary',
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

const TYPES = [...PREVIEW_TYPES, FUSSY_TYPE, TEMPERATURE_TYPE];
const typeId = (key: string) => TYPES.find((type) => type.key === key)?.id ?? typeIdOf(key);

function at(day: Date, hour: number, minute = 0, dayOffset = 0): string {
  return new Date(
    day.getFullYear(),
    day.getMonth(),
    day.getDate() + dayOffset,
    hour,
    minute,
  ).toISOString();
}

function make(key: string, start: string, end: string | null, payload: EventPayload = {}) {
  return {
    id: `dev-day-summary-${key}-${start}`,
    babyId: PREVIEW_BABY_ID,
    typeId: typeId(key),
    startedAt: start,
    endedAt: end,
    payload,
    notes: null,
    createdBy: null,
    createdAt: start,
    updatedAt: start,
    deletedAt: null,
  } satisfies BabyEvent;
}

/** A small deterministic wobble so the days are not identical. */
const wobble = (index: number, spread: number) => ((index * 37) % (2 * spread + 1)) - spread;

/** One day of a 3-month-old, `back` days before today. */
function dayOf(today: Date, back: number): BabyEvent[] {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
  const w = (spread: number, salt = 0) => wobble(back + salt, spread);
  return [
    make('sleep', at(day, 19, 40 + w(15, 1), -1), at(day, 6, 20 + w(20, 2)), { kind: 'night' }),
    make('sleep', at(day, 8, 50 + w(10, 3)), at(day, 9, 55 + w(15, 4)), { kind: 'nap' }),
    make('sleep', at(day, 12, 30 + w(15, 5)), at(day, 13, 50 + w(20, 6)), { kind: 'nap' }),
    make('sleep', at(day, 16, 20 + w(10, 7)), at(day, 16, 55 + w(10, 8)), { kind: 'nap' }),
    make('feeding', at(day, 6, 30), at(day, 6, 48), {
      method: 'breast',
      side: 'both',
      breast_left_seconds: 540,
      breast_right_seconds: 480,
    }),
    make('feeding', at(day, 10, 5 + w(10, 9)), at(day, 10, 20), {
      method: 'bottle',
      amount_ml: 120,
      amount_drunk_ml: 110 + w(1, 10) * 10,
      bottle_feeding_type: 'formula',
    }),
    make('feeding', at(day, 14, 0 + w(10, 11)), at(day, 14, 15 + w(5, 12)), {
      method: 'breast',
      side: 'left',
      breast_left_seconds: 720,
    }),
    make('feeding', at(day, 17, 10), at(day, 17, 25), {
      method: 'bottle',
      amount_ml: 150,
      bottle_feeding_type: 'breast_milk',
    }),
    make('feeding', at(day, 19, 15 + w(5, 13)), at(day, 19, 35), { method: 'breast' }),
    make('diaper', at(day, 7, 0), at(day, 7, 0), { content: 'WET' }),
    make('diaper', at(day, 10, 30), at(day, 10, 30), { content: back % 2 ? 'DIRTY' : 'MIXED' }),
    make('diaper', at(day, 14, 20), at(day, 14, 20), { content: 'WET' }),
    make('diaper', at(day, 18, 0), at(day, 18, 0), { content: 'WET' }),
    ...(back % 3 !== 2
      ? [make('fussy', at(day, 18, 20 + w(10, 14)), at(day, 18, 40 + w(10, 15)))]
      : []),
    make('tummy_time', at(day, 11, 0), at(day, 11, 10 + w(3, 16))),
    ...(back % 2 === 0 ? [make('bath', at(day, 17, 45), at(day, 17, 45))] : []),
    make('medication', at(day, 9, 30), at(day, 9, 30), {
      medications: [{ medicationId: 'm2', name: 'Vitamin D' }],
    }),
    ...(back === 0
      ? [make('temperature', at(day, 11, 45), at(day, 11, 45), { value_c: 36.8 })]
      : []),
  ];
}

/** Only what already happened: future starts dropped, a sleep not over yet still running. */
function happened(events: BabyEvent[]): BabyEvent[] {
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
  await db.eventTypes.bulkPut(TYPES);
  const days = scenario === 'rich' ? 10 : 0;
  const events: BabyEvent[] = [];
  for (let back = 1; back <= days; back++) events.push(...dayOf(today, back));
  if (scenario !== 'empty') events.push(...dayOf(today, 0));
  await db.events.bulkPut(happened(events));
  return baby;
}

function previewApi() {
  return fakeApi((call) => {
    if (call.path.includes('/measurements')) return [];
    // No rest estimate and no server rhythm: only the local Insights and the Day tab.
    if (call.path.includes('/rest-settings') || call.path.includes('/rhythm')) {
      throw httpError(404);
    }
    return undefined;
  }).api;
}

/** Developer-only: the Insights page with its Day tab over seeded local data. */
export default function DaySummaryPreview() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('state');
  const scenario: Scenario = SCENARIOS.find((s) => s === requested) ?? 'rich';
  const [setup] = useState(() => ({
    db: createDatabase('dev-day-summary-preview'),
    api: previewApi(),
    queries: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  }));
  const [ready, setReady] = useState<Scenario | null>(null);

  useEffect(() => {
    let live = true;
    void seed(setup.db, scenario).then(() => live && setReady(scenario));
    return () => {
      live = false;
    };
  }, [setup, scenario]);

  return (
    <AuthContext value={AUTH}>
      <ApiClientContext value={setup.api}>
        <QueryClientProvider client={setup.queries}>
          <DatabaseProvider db={setup.db}>
            <SelectedBabyProvider>
              <AddSheetProvider enabled={false}>
                <Box
                  sx={{ bgcolor: 'background.default', color: 'text.primary', minHeight: '100dvh' }}
                >
                  <Box
                    component="main"
                    sx={{
                      maxWidth: 480,
                      mx: 'auto',
                      px: 2,
                      pt: 2,
                      pb: 14,
                      display: 'grid',
                      gap: 3,
                      gridTemplateColumns: 'minmax(0, 1fr)',
                    }}
                  >
                    {ready === scenario && <InsightsPage key={scenario} />}
                    <PreviewToolbar
                      scenarios={SCENARIOS}
                      scenario={scenario}
                      onScenario={(next) => setParams({ state: next }, { replace: true })}
                    />
                  </Box>
                  <BottomNav />
                </Box>
              </AddSheetProvider>
            </SelectedBabyProvider>
          </DatabaseProvider>
        </QueryClientProvider>
      </ApiClientContext>
    </AuthContext>
  );
}
