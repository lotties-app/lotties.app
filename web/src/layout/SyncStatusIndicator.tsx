import { Chip, CircularProgress, Tooltip } from '@mui/material';
import CloudDoneIcon from '@mui/icons-material/CloudDone';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined';
import type { ReactElement } from 'react';
import { useSyncStatus } from '../sync/SyncEngineContext';
import type { SyncStatus } from '../sync/syncStatus';
import { syncKind, syncLabel } from './syncPresentation';

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
      return { label, tone: 'warning', icon: <ErrorOutlineIcon /> };
    case 'syncing':
      return { label, tone: 'default', icon: <CircularProgress size={14} /> };
    case 'offline':
      return { label, tone: 'warning', icon: <CloudOffIcon /> };
    case 'error':
      return { label, tone: 'error', icon: <ErrorOutlineIcon /> };
    case 'pending':
      return { label, tone: 'default', icon: <CloudUploadIcon /> };
    case 'synced':
      return {
        label,
        tone: status.deadLetterCount > 0 ? 'error' : 'default',
        icon: <CloudDoneIcon />,
      };
  }
}

/** Compact sync state chip; the last error is available as a tooltip. */
export function SyncStatusIndicator() {
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
        aria-label={`Sync status: ${label}`}
      />
    </Tooltip>
  );
}
