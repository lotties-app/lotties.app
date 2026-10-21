import { useTranslation } from 'react-i18next';
import { Chip, CircularProgress, Tooltip } from '@mui/material';
import type { ReactElement } from 'react';
import { useSyncStatus } from '../sync/SyncEngineContext';
import type { SyncStatus } from '../sync/syncStatus';
import { syncKind, syncLabel } from './syncPresentation';
import { Icon } from '../ui/Icon';

type Tone = 'default' | 'warning' | 'error';

interface Presentation {
  label: string;
  tone: Tone;
  icon: ReactElement;
}

/** Label, tone and icon for a sync status. */
function presentSyncStatus(status: SyncStatus): Presentation {
  const label = syncLabel(status);
  switch (syncKind(status)) {
    case 'auth':
      return { label, tone: 'warning', icon: <Icon name="error" /> };
    case 'syncing':
      return { label, tone: 'default', icon: <CircularProgress size={14} /> };
    case 'waiting':
      return { label, tone: 'default', icon: <Icon name="cloud-waiting" /> };
    case 'offline':
      return { label, tone: 'warning', icon: <Icon name="cloud-off" /> };
    case 'error':
      return { label, tone: 'error', icon: <Icon name="error" /> };
    case 'pending':
      return { label, tone: 'default', icon: <Icon name="cloud-upload" /> };
    case 'synced':
      return {
        label,
        tone: status.deadLetterCount > 0 ? 'error' : 'default',
        icon: <Icon name="cloud-done" />,
      };
  }
}

/** Compact sync state chip; the last error is available as a tooltip. */
export function SyncStatusIndicator() {
  const { t } = useTranslation();
  const status = useSyncStatus();
  const { label, tone, icon } = presentSyncStatus(status);
  return (
    <Tooltip title={status.lastError ?? ''}>
      <Chip
        size="small"
        variant="outlined"
        color={tone}
        icon={icon}
        label={label}
        role="status"
        aria-label={t('sync.statusLabel', { label })}
      />
    </Tooltip>
  );
}
