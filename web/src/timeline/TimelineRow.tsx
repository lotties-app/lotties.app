import { Chip, ListItemButton, ListItemIcon, ListItemText, Stack, Tooltip } from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined';
import type { BabyEvent, EventType, Medication } from '../db/models';
import type { EntitySyncState } from '../db/queries';
import { EventTypeIcon } from '../events/eventIcons';
import { safeColor } from '../events/safeColor';
import { payloadSummary } from './payloadSummary';
import { describeTimes } from './timelineModel';

interface Props {
  event: BabyEvent;
  type: EventType | undefined;
  medications: Medication[];
  syncState: EntitySyncState | undefined;
  onEdit: (event: BabyEvent) => void;
  /** Viewers can look but not edit. */
  readOnly?: boolean;
}

function SyncBadge({ state }: { state: EntitySyncState | undefined }) {
  if (!state) return null;
  const dead = state === 'dead';
  const label = dead ? 'Sync failed' : 'Not synced yet';
  return (
    <Tooltip title={label}>
      {dead ? (
        <ErrorOutlineIcon color="error" fontSize="small" titleAccess={label} />
      ) : (
        <CloudUploadIcon color="action" fontSize="small" titleAccess={label} />
      )}
    </Tooltip>
  );
}

export function TimelineRow({
  event,
  type,
  medications,
  syncState,
  onEdit,
  readOnly = false,
}: Props) {
  const name = type?.name ?? 'Event';
  const summary = payloadSummary(event.payload, type, medications);
  const running = event.endedAt === null;
  return (
    <ListItemButton
      onClick={() => onEdit(event)}
      disabled={readOnly}
      aria-label={readOnly ? name : `Edit ${name}`}
      sx={{ gap: 1, '&.Mui-disabled': { opacity: 1 } }}
    >
      <ListItemIcon sx={{ minWidth: 40 }}>
        <EventTypeIcon name={type?.icon ?? ''} color={safeColor(type?.color ?? '')} fontSize={28} />
      </ListItemIcon>
      <ListItemText
        primary={name}
        secondary={
          summary ? `${describeTimes(event, type)} · ${summary}` : describeTimes(event, type)
        }
        slotProps={{ secondary: { noWrap: true } }}
      />
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0 }}>
        {running && <Chip size="small" color="success" label="Running" />}
        <SyncBadge state={syncState} />
      </Stack>
    </ListItemButton>
  );
}
