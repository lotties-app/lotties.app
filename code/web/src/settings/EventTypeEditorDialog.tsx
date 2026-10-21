import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
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
import { createEventType, updateEventType } from '../api/managementApi';
import { useApiClient } from '../api/ApiClientContext';
import { useDatabase } from '../db/DatabaseContext';
import type { EventType } from '../db/models';
import { EventTypeIcon } from '../events/eventIcons';
import { EVENT_ICON_NAMES } from '../events/iconRegistry';
import { useEventTypeText } from '../i18n/eventTypeText';
import { catalogText } from '../i18n/catalog';
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
import { Icon } from '../ui/Icon';

/** Localized icon name; icons without a catalog entry keep their identifier. */
const iconLabel = (name: string) => catalogText('settings', 'icons', name) ?? name;

interface Props {
  babyId: string;
  /** Omit to create a custom type. */
  type?: EventType;
  onClose: () => void;
}

function IconPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  const { t } = useTranslation();
  return (
    <Box>
      <FormLabel id="icon-picker-label">{t('settings.eventTypes.icon')}</FormLabel>
      <ToggleButtonGroup
        exclusive
        value={value}
        aria-labelledby="icon-picker-label"
        onChange={(_, next: string | null) => next && onChange(next)}
        sx={{ flexWrap: 'wrap', gap: 0.5, display: 'flex' }}
      >
        {EVENT_ICON_NAMES.map((name) => (
          <ToggleButton
            key={name}
            value={name}
            aria-label={iconLabel(name)}
            sx={{ width: 48, height: 48 }}
          >
            <EventTypeIcon name={name} size={24} />
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Box>
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  const { t } = useTranslation();
  return (
    <Box role="radiogroup" aria-label={t('settings.eventTypes.colour')}>
      <FormLabel>{t('settings.eventTypes.colour')}</FormLabel>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 1, pt: 0.5 }}>
        {COLOR_PALETTE.map((color) => (
          <IconButton
            key={color}
            role="radio"
            aria-checked={color === value}
            aria-label={t('settings.eventTypes.colourOption', { color })}
            onClick={() => onChange(color)}
            sx={{
              bgcolor: color,
              color: '#fff',
              width: 40,
              height: 40,
              '&:hover': { bgcolor: color },
            }}
          >
            {color === value && <Icon name="check" size={20} />}
          </IconButton>
        ))}
      </Stack>
    </Box>
  );
}

/** Create/edit form for a custom event type: identity, look, duration and field definitions. */
export function EventTypeEditorDialog({ babyId, type, onClose }: Props) {
  const { t } = useTranslation();
  const names = useEventTypeText();
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
      <DialogTitle>
        {type
          ? t('settings.eventTypes.editNamed', { name: names.typeName(type) })
          : t('settings.eventTypes.add')}
      </DialogTitle>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {!online && <Alert severity="warning">{t('settings.eventTypes.offlineSave')}</Alert>}
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
              label={t('common.name')}
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              required
              autoComplete="off"
              helperText={creating ? t('settings.eventTypes.nameHelp') : null}
            />
            <IconPicker value={draft.icon} onChange={(icon) => patch({ icon })} />
            <ColorPicker value={draft.color} onChange={(color) => patch({ color })} />
            <FormControlLabel
              label={t('settings.eventTypes.durationSwitch')}
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
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={pending || !online}>
            {t('common.save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
