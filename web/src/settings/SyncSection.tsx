import { useTranslation } from 'react-i18next';
import { Button, List, ListItem, ListItemText, Stack, Typography, Alert } from '@mui/material';
import { useLiveQuery } from 'dexie-react-hooks';
import { useDatabase } from '../db/DatabaseContext';
import { useEvent, useEventTypes } from '../db/hooks';
import type { OutboxMutation } from '../db/models';
import { useStopTimer } from '../events/useStopTimer';
import { formatDateTime } from '../i18n/format';
import { t } from '../i18n/i18n';
import { useEventTypeText } from '../i18n/eventTypeText';
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

/**
 * "Fix" of a change the server rejected for its details: opens "Finish this ..." for the local
 * event (pre-filled); saving queues the fixed event and replaces the rejected change.
 */
function FixButton({ mutation, label }: { mutation: OutboxMutation; label: string }) {
  const { t } = useTranslation();
  const types = useEventTypes(mutation.babyId);
  const event = useEvent(mutation.entityId);
  const stopper = useStopTimer(mutation.babyId, types ?? []);
  return (
    <>
      <Button
        size="small"
        variant="contained"
        disabled={!types || !event}
        onClick={() => event && stopper.fix(event, mutation.rejectedField)}
        aria-label={t('settings.sync.fixNamed', { label })}
      >
        {t('settings.sync.fix')}
      </Button>
      {stopper.sheet}
    </>
  );
}

/** "Feeding needs your attention" for a rejected event, else the generic "Save event". */
function useMutationLabel(m: OutboxMutation): string {
  const { t } = useTranslation();
  const names = useEventTypeText();
  const event = useEvent(m.needsAttention ? m.entityId : '');
  const types = useEventTypes(m.babyId);
  if (!m.needsAttention) return describeMutation(m);
  const type = types?.find((candidate) => candidate.id === event?.typeId);
  const name = type ? names.typeName(type) : t('common.event');
  return t('settings.sync.needsAttention', { name });
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
  const label = useMutationLabel(mutation);
  const attention = mutation.needsAttention === true && mutation.entityType === 'event';
  return (
    <ListItem divider sx={{ flexWrap: 'wrap', gap: 1 }}>
      <ListItemText primary={label} secondary={mutation.lastError ?? t('settings.sync.rejected')} />
      <Stack direction="row" spacing={1}>
        {attention ? (
          <FixButton mutation={mutation} label={label} />
        ) : (
          <Button
            size="small"
            onClick={onRetry}
            aria-label={t('settings.sync.retryNamed', { label })}
          >
            {t('common.retry')}
          </Button>
        )}
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
      {status.waitingForToken && <Alert severity="info">{t('sync.waitingForToken')}</Alert>}
      {status.lastError && <Alert severity="warning">{status.lastError}</Alert>}
      <Button variant="outlined" onClick={() => void engine.syncNow()} sx={{ minHeight: 48 }}>
        {t('settings.sync.syncNow')}
      </Button>
      <Typography variant="subtitle1" component="h3">
        {t('settings.sync.failedChanges', { count: dead.length })}
      </Typography>
      {status.attentionCount > 0 && (
        <Alert severity="warning">
          {t('settings.sync.attentionHelp', { count: status.attentionCount })}
        </Alert>
      )}
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
