import { useState } from 'react';
import { Alert, Stack, Typography } from '@mui/material';
import { canWrite, VIEWER_NOTICE } from '../baby/permissions';
import { useEventCommands, useEventTypes, useRunningEvents } from '../db/hooks';
import type { Baby, BabyEvent, EventType } from '../db/models';
import { EventSheet } from '../events/EventSheet';
import { PredictionsSection } from '../predictions/PredictionsSection';
import { QuickActions } from './QuickActions';
import { RunningTimers } from './RunningTimers';

type SheetTarget = { event: BabyEvent } | { typeId: string };

/** Home content for one baby: running timers on top, the quick-action grid, then predictions. */
export function BabyHome({ baby }: { baby: Baby }) {
  const types = useEventTypes(baby.id);
  const running = useRunningEvents(baby.id);
  const commands = useEventCommands();
  const [sheet, setSheet] = useState<SheetTarget | null>(null);
  const writable = canWrite(baby);
  const [error, setError] = useState<string | null>(null);

  if (!types || !running) return null;

  const attempt = async (action: () => Promise<unknown>) => {
    try {
      setError(null);
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    }
  };

  const onSelect = (type: EventType) =>
    type.hasDuration
      ? attempt(() => commands.create({ babyId: baby.id, typeId: type.id }))
      : setSheet({ typeId: type.id });

  return (
    <Stack spacing={2}>
      {!writable && <Alert severity="info">{VIEWER_NOTICE}</Alert>}
      {error && <Alert severity="error">{error}</Alert>}
      <RunningTimers
        events={running}
        types={types}
        onStop={(event) => attempt(() => commands.stop(event.id))}
        onEdit={(event) => setSheet({ event })}
        readOnly={!writable}
      />
      {types.length === 0 ? (
        <Typography color="text.secondary">
          No event types yet. They appear here after the first sync.
        </Typography>
      ) : (
        <QuickActions
          types={types}
          runningTypeIds={new Set(running.map((e) => e.typeId))}
          onSelect={onSelect}
          readOnly={!writable}
        />
      )}
      <PredictionsSection baby={baby} types={types} />
      {sheet && writable && (
        <EventSheet
          babyId={baby.id}
          types={types}
          event={'event' in sheet ? sheet.event : undefined}
          initialTypeId={'typeId' in sheet ? sheet.typeId : undefined}
          onDone={() => setSheet(null)}
        />
      )}
    </Stack>
  );
}
