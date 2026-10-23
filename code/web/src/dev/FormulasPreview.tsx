import { useEffect, useState } from 'react';
import { Box, Typography } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { createDatabase, type BabyRoutineDb } from '../db/database';
import { DatabaseProvider } from '../db/DatabaseProvider';
import type { Baby, BabyEvent, BabyRole, EventPayload, EventType, Formula } from '../db/models';
import { EventSheet } from '../events/EventSheet';
import { FormulaSheet } from '../formulas/FormulaSheet';
import type { WeightPoint } from '../insights/formulaComparison';
import { InsightsSection } from '../insights/InsightsSection';
import { FormulasSection } from '../settings/FormulasSection';
import { FUSSY_TYPE } from '../test/builtInTypes';
import { UndoSnackbar } from '../ui/UndoSnackbar';
import { PREVIEW_BABY_ID, PREVIEW_TYPES } from './previewData';
import { PreviewToolbar } from './PreviewToolbar';

/*
 * Developer-only (route `/dev/formulas`, never in production builds): the formula screens over a
 * throw-away local database (docs/design/14-formulas.md). `?state=settings` (Settings > Formulas),
 * `caregiver` (the same, read-only), `sheet` (add a formula), `chips` (a bottle of formula in the
 * event sheet), `insights` (two formulas over three weeks, side by side) and `single` (one formula
 * shown, a newer one still collecting days). No sign-in, no server.
 */

const SCENARIOS = ['settings', 'caregiver', 'sheet', 'chips', 'insights', 'single'] as const;
type Scenario = (typeof SCENARIOS)[number];

const TYPES: EventType[] = [...PREVIEW_TYPES, FUSSY_TYPE];
const typeId = (key: string) => TYPES.find((type) => type.key === key)?.id ?? key;
const babyOf = (role: BabyRole): Baby => ({
  id: PREVIEW_BABY_ID,
  name: 'Lia',
  birthDate: '2026-07-20',
  role,
});

const formula = (id: string, name: string, extra: Partial<Formula> = {}): Formula => ({
  id,
  babyId: PREVIEW_BABY_ID,
  name,
  brand: null,
  stage: null,
  notes: null,
  startedOn: null,
  isCurrent: false,
  archived: false,
  createdBy: null,
  createdAt: '2026-09-25T10:00:00.000Z',
  updatedAt: '2026-09-25T10:00:00.000Z',
  ...extra,
});

const FORMULAS: Formula[] = [
  formula('dev-f-nan', 'Nan 1', { brand: 'Nestlé', stage: '1', startedOn: '2026-09-25' }),
  formula('dev-f-apt', 'Aptamil 2', {
    brand: 'Aptamil',
    stage: '2',
    startedOn: '2026-10-11',
    isCurrent: true,
    notes: 'Bought at the pharmacy',
  }),
  formula('dev-f-sim', 'Similac 1', { archived: true }),
];

const dateOf = (back: number, hour: number, minute = 0) => {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - back, hour, minute);
};

function make(key: string, start: Date, payload: EventPayload, minutes = 0): BabyEvent {
  const startedAt = start.toISOString();
  return {
    id: `dev-formulas-${key}-${startedAt}`,
    babyId: PREVIEW_BABY_ID,
    typeId: typeId(key),
    startedAt,
    endedAt: new Date(start.getTime() + minutes * 60_000).toISOString(),
    payload,
    notes: null,
    createdBy: null,
    createdAt: startedAt,
    updatedAt: startedAt,
    deletedAt: null,
  };
}

const bottle = (back: number, hour: number, f: Formula, ml: number) =>
  make(
    'feeding',
    dateOf(back, hour, (back * 7) % 20),
    {
      method: 'bottle',
      amount_ml: ml,
      bottle_feeding_type: 'formula',
      formula_id: f.id,
      formula_name: f.name,
    },
    15,
  );

/** One logged day: five bottles of the day's formula, diapers, naps, a night, the odd symptom. */
function dayOf(back: number, f: Formula): BabyEvent[] {
  const nan = f.id === 'dev-f-nan';
  const ml = (base: number) => base + ((back * 3) % 3) * 10;
  const events = [
    bottle(back, 6, f, ml(120)),
    bottle(back, 10, f, ml(130)),
    bottle(back, 14, f, ml(120)),
    bottle(back, 18, f, ml(140)),
    bottle(back, 22, f, ml(120)),
    make('diaper', dateOf(back, 7, 10), { content: 'WET' }),
    make('diaper', dateOf(back, 11, 30), { content: back % 2 ? 'DIRTY' : 'WET' }),
    make('diaper', dateOf(back, 15, 20), { content: 'WET' }),
    make('diaper', dateOf(back, 19, 40), { content: back % 3 ? 'WET' : 'MIXED' }),
    make('sleep', dateOf(back, 8, 30), { kind: 'nap' }, 70),
    make('sleep', dateOf(back, 12, 30), { kind: 'nap' }, 80),
    make('sleep', dateOf(back, 20, 0), { kind: 'night' }, 9 * 60),
  ];
  const pain = nan ? back % 2 === 0 : back % 4 === 0;
  if (pain) events.push(make('belly_pain', dateOf(back, 19, 15), { intensity: 2 }));
  if (back % 3 === 0) events.push(make('fussy', dateOf(back, 18, 50), { intensity: 'mild' }, 25));
  return events;
}

function history(scenario: Scenario): BabyEvent[] {
  const [nan, apt] = FORMULAS;
  const events: BabyEvent[] = [];
  const nanFrom = scenario === 'single' ? 14 : 21;
  const switchAt = scenario === 'single' ? 3 : 10;
  for (let back = nanFrom; back > switchAt; back--) events.push(...dayOf(back, nan));
  for (let back = switchAt; back >= 0; back--) events.push(...dayOf(back, apt));
  // The switch day had a bottle of each.
  events.push(bottle(switchAt, 12, nan, 120));
  const now = Date.now();
  return events.filter((event) => Date.parse(event.startedAt) <= now);
}

const WEIGHTS: WeightPoint[] = [
  { date: dateKey(dateOf(24, 9)), kg: 4.8 },
  { date: dateKey(dateOf(12, 9)), kg: 5.2 },
];

function dateKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function seed(db: BabyRoutineDb, scenario: Scenario): Promise<void> {
  await Promise.all([
    db.babies.clear(),
    db.eventTypes.clear(),
    db.events.clear(),
    db.formulas.clear(),
    db.outbox.clear(),
  ]);
  await db.babies.put(babyOf(scenario === 'caregiver' ? 'Caregiver' : 'Owner'));
  await db.eventTypes.bulkPut(TYPES);
  await db.formulas.bulkPut(FORMULAS);
  if (scenario === 'insights' || scenario === 'single' || scenario === 'chips') {
    await db.events.bulkPut(history(scenario));
  }
}

function Body({ scenario }: { scenario: Scenario }) {
  const [closed, setClosed] = useState(false);
  const done = () => setClosed(true);
  if (scenario === 'settings') return <FormulasSection baby={babyOf('Owner')} />;
  if (scenario === 'caregiver') return <FormulasSection baby={babyOf('Caregiver')} />;
  if (scenario === 'insights' || scenario === 'single') {
    return <InsightsSection baby={babyOf('Owner')} weights={WEIGHTS} />;
  }
  if (closed) return null;
  if (scenario === 'sheet') {
    return <FormulaSheet babyId={PREVIEW_BABY_ID} formulas={FORMULAS} onClose={done} />;
  }
  const now = new Date().toISOString();
  return (
    <EventSheet
      babyId={PREVIEW_BABY_ID}
      types={TYPES}
      prefill={{
        typeId: typeId('feeding'),
        startedAt: now,
        endedAt: now,
        payload: { method: 'bottle', amount_ml: 130, bottle_feeding_type: 'formula' },
      }}
      onDone={done}
    />
  );
}

/** Developer-only: the formula screens with seeded local data (`/dev/formulas?state=settings`). */
export default function FormulasPreview() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('state');
  const scenario: Scenario = SCENARIOS.find((s) => s === requested) ?? 'settings';
  const [db] = useState(() => createDatabase('dev-formulas-preview'));
  const [ready, setReady] = useState<Scenario | null>(null);

  useEffect(() => {
    let live = true;
    void seed(db, scenario).then(() => live && setReady(scenario));
    return () => {
      live = false;
    };
  }, [db, scenario]);

  return (
    <DatabaseProvider db={db}>
      <Box sx={{ bgcolor: 'background.default', color: 'text.primary', minHeight: '100dvh' }}>
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
          <Typography variant="h5" component="h1" sx={{ py: 1 }}>
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
    </DatabaseProvider>
  );
}
