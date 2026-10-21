import { useEffect, useState } from 'react';
import { Box, Button, Typography } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { createDatabase, type BabyRoutineDb } from '../db/database';
import { DatabaseProvider } from '../db/DatabaseProvider';
import type { Baby, BabyEvent, EventPayload } from '../db/models';
import { DeletedEventSnackbar } from '../events/DeletedEventSnackbar';
import { EventSheet, type FinishMode } from '../events/EventSheet';
import { clearAllLastUsed, recordLastUsed } from '../events/lastUsedValues';
import { PREVIEW_BABY_ID, PREVIEW_MEDICATIONS, PREVIEW_TYPES, typeIdOf } from './previewData';
import { PreviewToolbar } from './PreviewToolbar';

/*
 * Developer-only (route `/dev/sheet`, never in production builds): the event sheet over a
 * throw-away local database, one scenario at a time (`?state=bottle`). No sign-in, no server.
 */

const SCENARIOS = [
  'bottle',
  'breast',
  'solid',
  'diaper',
  'sleep',
  'medication',
  'belly',
  'edit',
  'running',
  'finish',
] as const;
type Scenario = (typeof SCENARIOS)[number];
const MIN = 60_000;

const baby: Baby = { id: PREVIEW_BABY_ID, name: 'Lia', birthDate: '2026-08-01', role: 'Owner' };

function stored(
  id: string,
  key: string,
  startAgo: number,
  endAgo: number | null,
  payload: EventPayload,
): BabyEvent {
  const startedAt = new Date(Date.now() - startAgo * MIN).toISOString();
  return {
    id,
    babyId: PREVIEW_BABY_ID,
    typeId: typeIdOf(key),
    startedAt,
    endedAt: endAgo === null ? null : new Date(Date.now() - endAgo * MIN).toISOString(),
    payload,
    notes: null,
    createdBy: null,
    createdAt: startedAt,
    updatedAt: startedAt,
    deletedAt: null,
  };
}

interface Opened {
  initialTypeId?: string;
  event?: BabyEvent;
  finish?: FinishMode;
}

function opened(scenario: Scenario): Opened {
  switch (scenario) {
    case 'bottle':
    case 'breast':
    case 'solid':
      return { initialTypeId: typeIdOf('feeding') };
    case 'diaper':
      return { initialTypeId: typeIdOf('diaper') };
    case 'sleep':
      return { initialTypeId: typeIdOf('sleep') };
    case 'medication':
      return { initialTypeId: typeIdOf('medication') };
    case 'belly':
      return { initialTypeId: typeIdOf('belly_pain') };
    case 'edit':
      return {
        event: stored('dev-sheet-edit', 'feeding', 95, 80, {
          method: 'bottle',
          amount_ml: 120,
          bottle_feeding_type: 'formula',
        }),
      };
    case 'running':
      return { event: stored('dev-sheet-run', 'tummy_time', 12, null, {}) };
    case 'finish':
      return {
        event: stored('dev-sheet-finish', 'feeding', 14, null, {}),
        finish: { fields: ['method'], initialValues: {} },
      };
  }
}

async function seed(db: BabyRoutineDb, scenario: Scenario) {
  await Promise.all([
    db.babies.clear(),
    db.eventTypes.clear(),
    db.events.clear(),
    db.medications.clear(),
    db.outbox.clear(),
  ]);
  clearAllLastUsed();
  await db.babies.put(baby);
  await db.eventTypes.bulkPut(PREVIEW_TYPES);
  await db.medications.bulkPut(PREVIEW_MEDICATIONS);
  const feeding = PREVIEW_TYPES.find((type) => type.key === 'feeding')!;
  recordLastUsed(PREVIEW_BABY_ID, feeding, {
    method: scenario === 'breast' ? 'breast' : 'bottle',
    amount_ml: 120,
    bottle_feeding_type: 'formula',
  });
  const { event } = opened(scenario);
  if (event) await db.events.put(event);
}

/** Developer-only: the event sheet on seeded local data (route `/dev/sheet?state=bottle`). */
export default function SheetPreview() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('state');
  const scenario: Scenario = SCENARIOS.find((s) => s === requested) ?? 'bottle';
  const [db] = useState(() => createDatabase('dev-sheet-preview'));
  const [ready, setReady] = useState<Scenario | null>(null);
  const [open, setOpen] = useState(true);

  useEffect(() => {
    let live = true;
    void (async () => {
      await seed(db, scenario);
      if (live) {
        setReady(scenario);
        setOpen(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [db, scenario]);

  return (
    <DatabaseProvider db={db}>
      <Box sx={{ bgcolor: 'background.default', color: 'text.primary', minHeight: '100dvh' }}>
        <Box sx={{ maxWidth: 480, mx: 'auto', px: 2, pt: 1 }}>
          <Typography variant="h5" component="p" sx={{ py: 1 }}>
            Lia
          </Typography>
          {!open && <Button onClick={() => setOpen(true)}>Open the sheet</Button>}
          <PreviewToolbar
            scenarios={SCENARIOS}
            scenario={scenario}
            onScenario={(next) => setParams({ state: next }, { replace: true })}
          />
        </Box>
        {ready === scenario && open && (
          <EventSheet
            key={scenario}
            babyId={PREVIEW_BABY_ID}
            types={PREVIEW_TYPES}
            {...opened(scenario)}
            onDone={() => setOpen(false)}
          />
        )}
        <DeletedEventSnackbar />
      </Box>
    </DatabaseProvider>
  );
}
