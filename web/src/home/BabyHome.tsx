import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Stack, Typography } from '@mui/material';
import { canWrite } from '../baby/permissions';
import { useEventTypes, useRunningEvents } from '../db/hooks';
import type { Baby, BabyEvent, EventType } from '../db/models';
import { EventSheet } from '../events/EventSheet';
import { loadPinned } from '../presets/pinnedStorage';
import { pinnedPresets, presetsForBaby } from '../presets/resolve';
import { usePresetActions } from '../presets/usePresetActions';
import { usePresetEvents } from '../presets/usePresetEvents';
import { PredictionsSection } from '../predictions/PredictionsSection';
import { QuickActions } from './QuickActions';
import { RunningTimers } from './RunningTimers';

/** Home content for one baby: running timers on top, the pinned presets, then predictions. */
export function BabyHome({ baby }: { baby: Baby }) {
  const types = useEventTypes(baby.id);
  const running = useRunningEvents(baby.id);
  const events = usePresetEvents(baby.id);
  if (!types || !running || !events) return null;
  return <BabyHomeContent baby={baby} types={types} running={running} events={events} />;
}

function BabyHomeContent({
  baby,
  types,
  running,
  events,
}: {
  baby: Baby;
  types: EventType[];
  running: BabyEvent[];
  events: BabyEvent[];
}) {
  const { t } = useTranslation();
  const actions = usePresetActions(baby.id, types);
  const [editing, setEditing] = useState<BabyEvent | null>(null);
  const [pinned] = useState(() => loadPinned(baby.id));
  const writable = canWrite(baby);
  const shortcuts = pinnedPresets(presetsForBaby(types), pinned);

  return (
    <Stack spacing={2}>
      {!writable && <Alert severity="info">{t('baby.viewerNotice')}</Alert>}
      <RunningTimers
        events={running}
        types={types}
        onStop={(event) => void actions.stop(event)}
        onEdit={setEditing}
        readOnly={!writable}
      />
      {types.length === 0 ? (
        <Typography color="text.secondary">{t('home.noTypes')}</Typography>
      ) : (
        <QuickActions
          presets={shortcuts}
          events={events}
          onSelect={(preset, timer) => void actions.run(preset, timer)}
          readOnly={!writable}
        />
      )}
      <PredictionsSection baby={baby} types={types} />
      {writable && actions.elements}
      {editing && writable && (
        <EventSheet
          babyId={baby.id}
          types={types}
          event={editing}
          onDone={() => setEditing(null)}
        />
      )}
    </Stack>
  );
}
