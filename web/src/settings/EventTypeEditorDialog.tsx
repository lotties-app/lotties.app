import { useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormLabel,
  IconButton,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import CheckIcon from '@mui/icons-material/Check';
import { createEventType, updateEventType } from '../api/managementApi';
import { useApiClient } from '../api/ApiClientContext';
import { useDatabase } from '../db/DatabaseContext';
import type { EventType } from '../db/models';
import { EventTypeIcon } from '../events/eventIcons';
import { EVENT_ICON_NAMES } from '../events/iconRegistry';
import { useSyncEngine } from '../sync/SyncEngineContext';
import { FieldsEditor } from './FieldsEditor';
import {
  COLOR_PALETTE,
  draftFromType,
  emptyDraft,
  toCreateRequest,
  toTypeRequest,
  validateDraft,
  type EventTypeDraft,
} from './eventTypeModel';
import { ErrorNotice } from './ErrorNotice';
import { useServerAction } from './useServerAction';

interface Props {
  babyId: string;
  /** Omit to create a custom type. */
  type?: EventType;
  onClose: () => void;
}

function IconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  return (
    <Box>
      <FormLabel id="icon-picker-label">Icon</FormLabel>
      <ToggleButtonGroup
        exclusive
        value={value}
        aria-labelledby="icon-picker-label"
        onChange={(_, next: string | null) => next && onChange(next)}
        sx={{ flexWrap: 'wrap', gap: 0.5, display: 'flex' }}
      >
        {EVENT_ICON_NAMES.map((name) => (
          <ToggleButton key={name} value={name} aria-label={name} sx={{ width: 48, height: 48 }}>
            <EventTypeIcon name={name} fontSize={24} />
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Box>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <Box role="radiogroup" aria-label="Colour">
      <FormLabel>Colour</FormLabel>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, pt: 0.5 }}>
        {COLOR_PALETTE.map((color) => (
          <IconButton
            key={color}
            role="radio"
            aria-checked={color === value}
            aria-label={`Colour ${color}`}
            onClick={() => onChange(color)}
            sx={{
              bgcolor: color,
              color: '#fff',
              width: 40,
              height: 40,
              '&:hover': { bgcolor: color },
            }}
          >
            {color === value && <CheckIcon fontSize="small" />}
          </IconButton>
        ))}
      </Stack>
    </Box>
  );
}

/** Create/edit form for a custom event type: identity, look, duration and field definitions. */
export function EventTypeEditorDialog({ babyId, type, onClose }: Props) {
  const api = useApiClient();
  const db = useDatabase();
  const engine = useSyncEngine();
  const { run, pending, error, online } = useServerAction();
  const fullScreen = !useMediaQuery(useTheme().breakpoints.up('md'));
  const creating = !type;
  const [draft, setDraft] = useState<EventTypeDraft>(() =>
    type ? draftFromType(type) : emptyDraft(EVENT_ICON_NAMES[0]),
  );
  const [problems, setProblems] = useState<string[]>([]);

  const patch = (changes: Partial<EventTypeDraft>) => setDraft((d) => ({ ...d, ...changes }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const found = validateDraft(draft, creating);
    setProblems(found);
    if (found.length > 0) return;
    const saved = await run(async () => {
      const stored = type
        ? await updateEventType(api, babyId, type.id, toTypeRequest(draft))
        : await createEventType(api, babyId, toCreateRequest(draft));
      await db.eventTypes.put(stored);
      await engine.syncNow();
    });
    if (saved) onClose();
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm" fullScreen={fullScreen}>
      <DialogTitle>{type ? `Edit ${type.name}` : 'Add event type'}</DialogTitle>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {!online && (
              <Alert severity="warning">You are offline. Saving needs a connection.</Alert>
            )}
            <ErrorNotice message={error} />
            {problems.length > 0 && (
              <Alert severity="error">
                <Box component="ul" sx={{ m: 0, pl: 2 }}>
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </Box>
              </Alert>
            )}
            <TextField
              label="Name"
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              required
              autoComplete="off"
              helperText={
                creating ? 'The internal key is made from the name and cannot change.' : null
              }
            />
            <IconPicker value={draft.icon} onChange={(icon) => patch({ icon })} />
            <ColorPicker value={draft.color} onChange={(color) => patch({ color })} />
            <FormControlLabel
              label="Has duration (start and stop timer)"
              control={
                <Switch
                  checked={draft.hasDuration}
                  onChange={(_, on) => patch({ hasDuration: on })}
                />
              }
            />
            <FieldsEditor fields={draft.fields} onChange={(fields) => patch({ fields })} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={pending || !online}>
            Save
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
