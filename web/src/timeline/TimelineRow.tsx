import { useTranslation } from 'react-i18next';
import { Chip, ListItemButton, ListItemIcon, ListItemText, Stack, Tooltip } from '@mui/material';
import type { BabyEvent, EventType, Medication } from '../db/models';
import type { EntitySyncState } from '../db/queries';
import { EventTypeIcon } from '../events/eventIcons';
import { safeColor } from '../events/safeColor';
import { useEventTypeText } from '../i18n/eventTypeText';
import { payloadSummary } from './payloadSummary';
import { describeTimes } from './timelineModel';
import { Icon } from '../ui/Icon';

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
  const { t } = useTranslation();
  if (!state) return null;
  const dead = state === 'dead';
  const label = dead ? t('timeline.syncFailed') : t('timeline.notSynced');
  return (
    <Tooltip title={label}>
      {dead ? (
        <Icon name="error" size={20} label={label} sx={{ color: 'error.main' }} />
      ) : (
        <Icon name="cloud-upload" size={20} label={label} sx={{ color: 'action.active' }} />
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
  const { t } = useTranslation();
  const names = useEventTypeText();
  const name = type ? names.typeName(type) : t('common.event');
  const summary = payloadSummary(event.payload, type, medications, names);
  const running = event.endedAt === null;
  return (
    <ListItemButton
      onClick={() => onEdit(event)}
      disabled={readOnly}
      aria-label={readOnly ? name : t('home.editNamed', { name })}
      sx={{ gap: 1, '&.Mui-disabled': { opacity: 1 } }}
    >
      <ListItemIcon sx={{ minWidth: 40 }}>
        <EventTypeIcon name={type?.icon ?? ''} color={safeColor(type?.color ?? '')} size={24} />
      </ListItemIcon>
      <ListItemText
        primary={name}
        secondary={
          summary
            ? t('timeline.rowSummary', { times: describeTimes(event, type), summary })
            : describeTimes(event, type)
        }
        slotProps={{ secondary: { noWrap: true } }}
      />
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexShrink: 0 }}>
        {running && <Chip size="small" color="success" label={t('common.running')} />}
        <SyncBadge state={syncState} />
      </Stack>
    </ListItemButton>
  );
}
