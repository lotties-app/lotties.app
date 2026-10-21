import { Button, List, ListItem, ListItemText, Stack, Typography, Alert } from '@mui/material';
import { useLiveQuery } from 'dexie-react-hooks';
import { useDatabase } from '../db/DatabaseContext';
import type { OutboxMutation } from '../db/models';
import { discardDeadLetter, listDeadLetters, retryDeadLetter } from '../db/outbox';
import { useSyncEngine, useSyncStatus } from '../sync/SyncEngineContext';

const STATE_LABEL = {
  idle: 'Up to date',
  syncing: 'Syncing',
  offline: 'Offline',
  error: 'Error',
} as const;

function describeMutation(m: OutboxMutation): string {
  const action = m.kind === 'delete' ? 'Delete' : 'Save';
  return `${action} ${m.entityType}`;
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
  const label = describeMutation(mutation);
  return (
    <ListItem divider sx={{ flexWrap: 'wrap', gap: 1 }}>
      <ListItemText primary={label} secondary={mutation.lastError ?? 'Rejected by the server'} />
      <Stack direction="row" spacing={1}>
        <Button size="small" onClick={onRetry} aria-label={`Retry ${label}`}>
          Retry
        </Button>
        <Button size="small" color="error" onClick={onDiscard} aria-label={`Discard ${label}`}>
          Discard
        </Button>
      </Stack>
    </ListItem>
  );
}

/** Sync status, queue size and the dead-letter list (changes the server rejected). */
export function SyncSection() {
  const db = useDatabase();
  const engine = useSyncEngine();
  const status = useSyncStatus();
  const dead = useLiveQuery(() => listDeadLetters(db), [db]) ?? [];

  const retry = async (id: number) => {
    await retryDeadLetter(db, id);
    void engine.syncNow();
  };

  return (
    <Stack spacing={2}>
      <Typography>Status: {STATE_LABEL[status.state]}</Typography>
      <Typography>Waiting to upload: {status.pendingCount}</Typography>
      {status.lastSyncedAt && (
        <Typography color="text.secondary">
          Last synced {new Date(status.lastSyncedAt).toLocaleString()}
        </Typography>
      )}
      {status.lastError && <Alert severity="warning">{status.lastError}</Alert>}
      <Button variant="outlined" onClick={() => void engine.syncNow()} sx={{ minHeight: 48 }}>
        Sync now
      </Button>
      <Typography variant="subtitle1" component="h3">
        Failed changes ({dead.length})
      </Typography>
      {dead.length === 0 ? (
        <Typography color="text.secondary">Nothing failed.</Typography>
      ) : (
        <List aria-label="Failed changes" disablePadding>
          {dead.map((m) => (
            <DeadLetterRow
              key={m.id}
              mutation={m}
              onRetry={() => void retry(m.id)}
              onDiscard={() => void discardDeadLetter(db, m.id)}
            />
          ))}
        </List>
      )}
    </Stack>
  );
}
