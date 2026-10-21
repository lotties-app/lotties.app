import { useTranslation } from 'react-i18next';
import { Button, List, ListItem, ListItemText, Stack, Typography, Alert } from '@mui/material';
import { useLiveQuery } from 'dexie-react-hooks';
import { useDatabase } from '../db/DatabaseContext';
import type { OutboxMutation } from '../db/models';
import { formatDateTime } from '../i18n/format';
import { t } from '../i18n/i18n';
import { listDeadLetters, retryDeadLetter } from '../db/outbox';
import { useSyncEngine, useSyncStatus } from '../sync/SyncEngineContext';
import { ErrorNotice } from './ErrorNotice';
import { useServerAction } from './useServerAction';

function describeMutation(m: OutboxMutation): string {
  const entity = t(`settings.sync.entities.${m.entityType}`);
  return m.kind === 'delete'
    ? t('settings.sync.mutation.delete', { entity })
    : t('settings.sync.mutation.save', { entity });
}

function DeadLetterRow({
  mutation,
  onRetry,
  onDiscard,
}: {
  mutation: OutboxMutation;
  onRetry: () => void;
  onDiscard: () => void;
}) {
  const { t } = useTranslation();
  const label = describeMutation(mutation);
  return (
    <ListItem divider sx={{ flexWrap: 'wrap', gap: 1 }}>
      <ListItemText primary={label} secondary={mutation.lastError ?? t('settings.sync.rejected')} />
      <Stack direction="row" spacing={1}>
        <Button
          size="small"
          onClick={onRetry}
          aria-label={t('settings.sync.retryNamed', { label })}
        >
          {t('common.retry')}
        </Button>
        <Button
          size="small"
          color="error"
          onClick={onDiscard}
          aria-label={t('settings.sync.discardNamed', { label })}
        >
          {t('common.discard')}
        </Button>
      </Stack>
    </ListItem>
  );
}

/** Sync status, queue size and the dead-letter list (changes the server rejected). */
export function SyncSection() {
  const { t } = useTranslation();
  const db = useDatabase();
  const engine = useSyncEngine();
  const status = useSyncStatus();
  const dead = useLiveQuery(() => listDeadLetters(db), [db]) ?? [];
  // Discarding restores the server's copy of the record, so it needs the server.
  const discard = useServerAction();

  const retry = async (id: number) => {
    await retryDeadLetter(db, id);
    void engine.syncNow();
  };

  return (
    <Stack spacing={2}>
      <Typography>
        {t('settings.sync.status', { state: t(`settings.sync.states.${status.state}`) })}
      </Typography>
      <Typography>{t('settings.sync.waiting', { count: status.pendingCount })}</Typography>
      {status.lastSyncedAt && (
        <Typography color="text.secondary">
          {t('settings.sync.lastSynced', { when: formatDateTime(status.lastSyncedAt) })}
        </Typography>
      )}
      {status.lastError && <Alert severity="warning">{status.lastError}</Alert>}
      <Button variant="outlined" onClick={() => void engine.syncNow()} sx={{ minHeight: 48 }}>
        {t('settings.sync.syncNow')}
      </Button>
      <Typography variant="subtitle1" component="h3">
        {t('settings.sync.failedChanges', { count: dead.length })}
      </Typography>
      <ErrorNotice message={discard.error} />
      {dead.length === 0 ? (
        <Typography color="text.secondary">{t('settings.sync.nothingFailed')}</Typography>
      ) : (
        <List aria-label={t('settings.sync.failedList')} disablePadding>
          {dead.map((m) => (
            <DeadLetterRow
              key={m.id}
              mutation={m}
              onRetry={() => void retry(m.id)}
              onDiscard={() => void discard.run(() => engine.discardDeadLetter(m.id))}
            />
          ))}
        </List>
      )}
    </Stack>
  );
}
