import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Badge, CircularProgress, IconButton, Tooltip } from '@mui/material';
import CloudDoneRoundedIcon from '@mui/icons-material/CloudDoneRounded';
import CloudOffRoundedIcon from '@mui/icons-material/CloudOffRounded';
import CloudSyncRoundedIcon from '@mui/icons-material/CloudSyncRounded';
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import { useSyncStatus } from '../sync/SyncEngineContext';
import type { SyncStatus } from '../sync/syncStatus';
import { syncKind, syncLabel } from './syncPresentation';

function SyncIcon({ status }: { status: SyncStatus }) {
  const kind = syncKind(status);
  switch (kind) {
    case 'synced':
      return status.deadLetterCount > 0 ? (
        <WarningAmberRoundedIcon color="error" />
      ) : (
        <CloudDoneRoundedIcon />
      );
    case 'syncing':
      return <CircularProgress size={20} color="inherit" aria-hidden />;
    case 'waiting':
      return <CloudSyncRoundedIcon />;
    case 'pending':
      return (
        <Badge badgeContent={status.pendingCount} color="primary" max={99}>
          <CloudUploadRoundedIcon />
        </Badge>
      );
    case 'offline':
      return <CloudOffRoundedIcon />;
    case 'auth':
    case 'error':
      return <WarningAmberRoundedIcon color={kind === 'error' ? 'error' : 'warning'} />;
  }
}

/**
 * Header icon button: sync state at a glance, opens Settings > Sync. Changes that need the user's
 * attention (rejected event details) add a count badge whatever the state.
 */
export function SyncIconButton() {
  const { t } = useTranslation();
  const status = useSyncStatus();
  const label = syncLabel(status);
  return (
    <Tooltip title={status.lastError ?? label}>
      <IconButton
        component={Link}
        to="/settings#sync"
        color="inherit"
        aria-label={t('sync.iconLabel', { label })}
      >
        <Badge
          badgeContent={status.attentionCount}
          color="error"
          max={99}
          data-testid="sync-attention-badge"
        >
          <SyncIcon status={status} />
        </Badge>
      </IconButton>
    </Tooltip>
  );
}
