import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Badge, CircularProgress, IconButton, Tooltip } from '@mui/material';
import { useSyncStatus } from '../sync/SyncEngineContext';
import type { SyncStatus } from '../sync/syncStatus';
import { syncKind, syncLabel } from './syncPresentation';
import { Icon } from '../ui/Icon';

function SyncIcon({ status }: { status: SyncStatus }) {
  const kind = syncKind(status);
  switch (kind) {
    case 'synced':
      return status.deadLetterCount > 0 ? (
        <Icon name="warning" sx={{ color: 'error.main' }} />
      ) : (
        <Icon name="cloud-done" />
      );
    case 'syncing':
      return <CircularProgress size={20} color="inherit" aria-hidden />;
    case 'waiting':
      return <Icon name="cloud-waiting" />;
    case 'pending':
      return (
        <Badge badgeContent={status.pendingCount} color="primary" max={99}>
          <Icon name="cloud-upload" />
        </Badge>
      );
    case 'offline':
      return <Icon name="cloud-off" />;
    case 'auth':
    case 'error':
      return (
        <Icon name="warning" sx={{ color: kind === 'error' ? 'error.main' : 'warning.main' }} />
      );
  }
}

/**
 * Header icon button: sync state at a glance, opens Settings > Sync (`to`: the doctor's dashboard
 * has its own Settings page). Changes that need the user's attention (rejected event details) add
 * a count badge whatever the state.
 */
export function SyncIconButton({ to = '/settings#sync' }: { to?: string }) {
  const { t } = useTranslation();
  const status = useSyncStatus();
  const label = syncLabel(status);
  return (
    <Tooltip title={status.lastError ?? label}>
      <IconButton
        component={Link}
        to={to}
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
