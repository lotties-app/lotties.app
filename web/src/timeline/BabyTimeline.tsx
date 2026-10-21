import { useState } from 'react';
import { Button, List, ListSubheader, Stack, Typography } from '@mui/material';
import {
  useEntitySyncStates,
  useEventsStartedSince,
  useEventTypes,
  useMedications,
  useOldestEventStart,
} from '../db/hooks';
import type { Baby, BabyEvent } from '../db/models';
import { EventSheet } from '../events/EventSheet';
import { SyncStatusIndicator } from '../layout/SyncStatusIndicator';
import { TimelineFilters } from './TimelineFilters';
import { TimelineRow } from './TimelineRow';
import { DAYS_PER_PAGE, filterByTypes, groupByDay, windowStart } from './timelineModel';

/** Day-grouped events of one baby, newest first, loaded `DAYS_PER_PAGE` days at a time. */
export function BabyTimeline({ baby }: { baby: Baby }) {
  const [days, setDays] = useState(DAYS_PER_PAGE);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [editing, setEditing] = useState<BabyEvent | null>(null);
  // Fixed per mount and page count, so the live query is not re-created on every render.
  const [now] = useState(() => new Date());
  const from = windowStart(days, now);

  const types = useEventTypes(baby.id);
  const medications = useMedications(baby.id);
  const events = useEventsStartedSince(baby.id, from);
  const oldest = useOldestEventStart(baby.id);
  const syncStates = useEntitySyncStates(baby.id);

  if (!types || !medications || !events) return null;

  const grouped = groupByDay(filterByTypes(events, selected), new Date());
  const hasOlder = !!oldest && oldest < from;
  const typeOf = (event: BabyEvent) => types.find((t) => t.id === event.typeId);

  return (
    <Stack spacing={2}>
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="h6" component="h1">
          Timeline
        </Typography>
        <SyncStatusIndicator />
      </Stack>
      <TimelineFilters types={types} selected={selected} onChange={setSelected} />
      {grouped.length === 0 && (
        <Typography color="text.secondary">No events in the last {days} days.</Typography>
      )}
      {grouped.map((day) => (
        <List key={day.key} aria-label={day.label} disablePadding>
          <ListSubheader disableGutters sx={{ bgcolor: 'background.default' }}>
            {day.label}
          </ListSubheader>
          {day.events.map((event) => (
            <TimelineRow
              key={event.id}
              event={event}
              type={typeOf(event)}
              medications={medications}
              syncState={syncStates?.get(event.id)}
              onEdit={setEditing}
            />
          ))}
        </List>
      ))}
      {hasOlder && (
        <Button onClick={() => setDays((d) => d + DAYS_PER_PAGE)} sx={{ minHeight: 48 }}>
          Load older
        </Button>
      )}
      {editing && (
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
