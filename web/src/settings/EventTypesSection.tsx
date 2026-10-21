import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { deleteEventType } from '../api/managementApi';
import { useApiClient } from '../api/ApiClientContext';
import { canWrite } from '../baby/permissions';
import { useDatabase } from '../db/DatabaseContext';
import { useEventTypes } from '../db/hooks';
import type { Baby, EventType } from '../db/models';
import { EventTypeIcon } from '../events/eventIcons';
import { safeColor } from '../events/safeColor';
import { useEventTypeText } from '../i18n/eventTypeText';
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
  const { t } = useTranslation();
  const names = useEventTypeText();
  const name = names.typeName(type);
  const custom = type.babyId !== null;
  return (
    <ListItem
      divider
      secondaryAction={
        custom &&
        writable && (
          <Stack direction="row">
            <IconButton aria-label={t('settings.eventTypes.editNamed', { name })} onClick={onEdit}>
              <EditIcon />
            </IconButton>
            <IconButton
              aria-label={t('settings.eventTypes.deleteNamed', { name })}
              onClick={onDelete}
            >
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
            {name}
            {!custom && (
              <Chip size="small" label={t('settings.eventTypes.builtIn')} sx={{ ml: 1 }} />
            )}
          </>
        }
        secondary={t('settings.eventTypes.details', {
          kind: type.hasDuration
            ? t('settings.eventTypes.hasDuration')
            : t('settings.eventTypes.instant'),
          fields: t('settings.eventTypes.fieldCount', { count: type.fields.length }),
        })}
      />
    </ListItem>
  );
}

/** Built-in (read-only) and custom event types; custom ones are managed online. */
export function EventTypesSection({ baby }: { baby: Baby }) {
  const { t } = useTranslation();
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
      {writable && !online && <Alert severity="warning">{t('errors.offline')}</Alert>}
      {!writable && (
        <Typography color="text.secondary">{t('settings.eventTypes.viewOnly')}</Typography>
      )}
      <Typography variant="subtitle1" component="h3">
        {t('settings.eventTypes.custom')}
      </Typography>
      {custom.length === 0 && (
        <Typography color="text.secondary">{t('settings.eventTypes.noCustom')}</Typography>
      )}
      <List aria-label={t('settings.eventTypes.customList')} disablePadding>
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
          {t('settings.eventTypes.add')}
        </Button>
      )}
      <Typography variant="subtitle1" component="h3">
        {t('settings.eventTypes.builtIn')}
      </Typography>
      <List aria-label={t('settings.eventTypes.builtInList')} disablePadding>
        {builtIn.map((t) => (
          <TypeRow key={t.id} type={t} writable={false} onEdit={() => {}} onDelete={() => {}} />
        ))}
      </List>
      {editing && (
        <Suspense
          fallback={<CircularProgress aria-label={t('settings.eventTypes.loadingEditor')} />}
        >
          <EventTypeEditorDialog
            babyId={baby.id}
            type={editing === 'new' ? undefined : editing.type}
            onClose={() => setEditing(null)}
          />
        </Suspense>
      )}
      {deleting && (
        <ConfirmDialog
          title={t('settings.eventTypes.deleteTitle', { name: deleting.name })}
          body={t('settings.eventTypes.deleteBody')}
          confirmLabel={t('settings.eventTypes.deleteConfirm')}
          pending={pending}
          error={error}
          onCancel={closeDeleting}
          onConfirm={() => void confirmDelete(deleting)}
        />
      )}
    </Stack>
  );
}
