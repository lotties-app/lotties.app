import { lazy, Suspense, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { OFFLINE_MESSAGE } from '../api/errorMessages';
import { deleteEventType } from '../api/managementApi';
import { useApiClient } from '../api/ApiClientContext';
import { canWrite } from '../baby/permissions';
import { useDatabase } from '../db/DatabaseContext';
import { useEventTypes } from '../db/hooks';
import type { Baby, EventType } from '../db/models';
import { EventTypeIcon } from '../events/eventIcons';
import { safeColor } from '../events/safeColor';
import { useSyncEngine } from '../sync/SyncEngineContext';
import { ConfirmDialog } from './ConfirmDialog';
import { useServerAction } from './useServerAction';

const EventTypeEditorDialog = lazy(() =>
  import('./EventTypeEditorDialog').then((m) => ({ default: m.EventTypeEditorDialog })),
);

type Editing = { type: EventType } | 'new' | null;

function TypeRow({
  type,
  writable,
  onEdit,
  onDelete,
}: {
  type: EventType;
  writable: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const custom = type.babyId !== null;
  return (
    <ListItem
      divider
      secondaryAction={
        custom &&
        writable && (
          <Stack direction="row">
            <IconButton aria-label={`Edit ${type.name}`} onClick={onEdit}>
              <EditIcon />
            </IconButton>
            <IconButton aria-label={`Delete ${type.name}`} onClick={onDelete}>
              <DeleteIcon />
            </IconButton>
          </Stack>
        )
      }
    >
      <ListItemIcon>
        <EventTypeIcon name={type.icon} color={safeColor(type.color)} fontSize={28} />
      </ListItemIcon>
      <ListItemText
        primary={
          <>
            {type.name}
            {!custom && <Chip size="small" label="Built-in" sx={{ ml: 1 }} />}
          </>
        }
        secondary={`${type.hasDuration ? 'Has duration' : 'Instant'} · ${type.fields.length} fields`}
      />
    </ListItem>
  );
}

/** Built-in (read-only) and custom event types; custom ones are managed online. */
export function EventTypesSection({ baby }: { baby: Baby }) {
  const types = useEventTypes(baby.id);
  const api = useApiClient();
  const db = useDatabase();
  const engine = useSyncEngine();
  const { run, pending, error, online, clearError } = useServerAction();
  const writable = canWrite(baby);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<EventType | null>(null);

  if (!types) return null;
  const builtIn = types.filter((t) => t.babyId === null);
  const custom = types.filter((t) => t.babyId !== null);

  const confirmDelete = async (type: EventType) => {
    const ok = await run(async () => {
      await deleteEventType(api, baby.id, type.id);
      await db.eventTypes.delete(type.id);
      await engine.syncNow();
    });
    if (ok) setDeleting(null);
  };

  const closeDeleting = () => {
    clearError();
    setDeleting(null);
  };

  return (
    <Stack spacing={2}>
      {writable && !online && <Alert severity="warning">{OFFLINE_MESSAGE}</Alert>}
      {!writable && (
        <Typography color="text.secondary">
          You can view event types but not change them.
        </Typography>
      )}
      <Typography variant="subtitle1" component="h3">
        Custom
      </Typography>
      {custom.length === 0 && (
        <Typography color="text.secondary">No custom event types.</Typography>
      )}
      <List aria-label="Custom event types" disablePadding>
        {custom.map((t) => (
          <TypeRow
            key={t.id}
            type={t}
            writable={writable}
            onEdit={() => setEditing({ type: t })}
            onDelete={() => setDeleting(t)}
          />
        ))}
      </List>
      {writable && (
        <Button
          startIcon={<AddIcon />}
          variant="outlined"
          disabled={!online}
          onClick={() => setEditing('new')}
          sx={{ minHeight: 48, alignSelf: 'flex-start' }}
        >
          Add event type
        </Button>
      )}
      <Typography variant="subtitle1" component="h3">
        Built-in
      </Typography>
      <List aria-label="Built-in event types" disablePadding>
        {builtIn.map((t) => (
          <TypeRow key={t.id} type={t} writable={false} onEdit={() => {}} onDelete={() => {}} />
        ))}
      </List>
      {editing && (
        <Suspense fallback={<CircularProgress aria-label="Loading editor" />}>
          <EventTypeEditorDialog
            babyId={baby.id}
            type={editing === 'new' ? undefined : editing.type}
            onClose={() => setEditing(null)}
          />
        </Suspense>
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          body="The event type is removed for everyone who follows this baby."
          confirmLabel="Delete event type"
          pending={pending}
          error={error}
          onCancel={closeDeleting}
          onConfirm={() => void confirmDelete(deleting)}
        />
      )}
    </Stack>
  );
}
