import { Chip, CircularProgress, Tooltip } from '@mui/material';
import CloudDoneIcon from '@mui/icons-material/CloudDone';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlined';
import type { ReactElement } from 'react';
import { useSyncStatus } from '../sync/SyncEngineContext';
import type { SyncStatus } from '../sync/syncStatus';

type Tone = 'default' | 'warning' | 'error';

interface Presentation {
  label: string;
  tone: Tone;
  icon: ReactElement;
}

function failedSuffix(status: SyncStatus) {
  return status.deadLetterCount > 0 ? ` · ${status.deadLetterCount} failed` : '';
}

/** Label, tone and icon for a sync status. */
function presentSyncStatus(status: SyncStatus): Presentation {
  const failed = failedSuffix(status);
  if (status.authRequired) {
    return { label: 'Sign in to sync', tone: 'warning', icon: <ErrorOutlineIcon /> };
  }
  if (status.state === 'syncing') {
    return { label: 'Syncing…', tone: 'default', icon: <CircularProgress size={14} /> };
  }
  if (status.state === 'offline') {
    return { label: `Offline${failed}`, tone: 'warning', icon: <CloudOffIcon /> };
  }
  if (status.state === 'error') {
    return { label: `Sync error${failed}`, tone: 'error', icon: <ErrorOutlineIcon /> };
  }
  if (status.pendingCount > 0) {
    return {
      label: `${status.pendingCount} pending${failed}`,
      tone: 'default',
      icon: <CloudUploadIcon />,
    };
  }
  const tone: Tone = status.deadLetterCount > 0 ? 'error' : 'default';
  return { label: `Synced${failed}`, tone, icon: <CloudDoneIcon /> };
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
