import { Button, Card, CardActionArea, Stack, Typography } from '@mui/material';
import StopIcon from '@mui/icons-material/Stop';
import type { BabyEvent, EventType } from '../db/models';
import { EventTypeIcon } from '../events/eventIcons';
import { safeColor } from '../events/safeColor';
import { formatElapsed, useNow } from '../events/time';

interface Props {
  events: BabyEvent[];
  types: EventType[];
  onStop: (event: BabyEvent) => void;
  onEdit: (event: BabyEvent) => void;
  /** Viewers cannot stop or edit timers. */
  readOnly?: boolean;
}

interface TimerProps {
  event: BabyEvent;
  type: EventType | undefined;
  now: number;
  onStop: (event: BabyEvent) => void;
  onEdit: (event: BabyEvent) => void;
  readOnly: boolean;
}

function Timer({ event, type, now, onStop, onEdit, readOnly }: TimerProps) {
  const name = type?.name ?? 'Event';
  return (
    <Card variant="outlined" sx={{ display: 'flex', alignItems: 'stretch' }}>
      <CardActionArea
        onClick={() => onEdit(event)}
        disabled={readOnly}
        aria-label={readOnly ? name : `Edit ${name}`}
        sx={{ display: 'flex', flexGrow: 1, justifyContent: 'flex-start', gap: 2, p: 2 }}
      >
        <EventTypeIcon name={type?.icon ?? ''} color={safeColor(type?.color ?? '')} fontSize={32} />
        <Stack>
          <Typography variant="subtitle1">{name}</Typography>
          <Typography
            variant="h5"
            component="time"
            sx={{ fontVariantNumeric: 'tabular-nums' }}
            dateTime={event.startedAt}
          >
            {formatElapsed(now - Date.parse(event.startedAt))}
          </Typography>
        </Stack>
      </CardActionArea>
      <Button
        color="error"
        startIcon={<StopIcon />}
        onClick={() => onStop(event)}
        disabled={readOnly}
        aria-label={`Stop ${name}`}
        sx={{ minWidth: 96, borderRadius: 0 }}
      >
        Stop
      </Button>
    </Card>
  );
}

export function RunningTimers({ events, types, onStop, onEdit, readOnly = false }: Props) {
  const now = useNow();
  if (events.length === 0) return null;
  return (
    <Stack spacing={1} component="section" aria-label="Running timers">
      {events.map((event) => (
        <Timer
          key={event.id}
          event={event}
          type={types.find((t) => t.id === event.typeId)}
          now={now}
          onStop={onStop}
          onEdit={onEdit}
          readOnly={readOnly}
        />
      ))}
    </Stack>
  );
}
