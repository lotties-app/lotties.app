import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, MenuItem, Stack, TextField } from '@mui/material';
import { describeApiError } from '../api/errorMessages';
import { useEventCommands } from '../db/hooks';
import type { BabyEvent, EventType } from '../db/models';
import {
  buildPayload,
  buildTimes,
  initialForm,
  isMedicationType,
  validateForm,
  type EventFormState,
} from './formModel';
import { MedicationChecklist } from './MedicationChecklist';
import { TypeField } from './TypeFields';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import { useEventTypeText } from '../i18n/eventTypeText';
import { getOwn, withOwn } from '../util/ownProperty';

export interface EventFormProps {
  babyId: string;
  types: EventType[];
  /** Existing event to edit; omit to create. */
  event?: BabyEvent;
  initialTypeId?: string;
  onDone: () => void;
}

const dateTimeSlots = { inputLabel: { shrink: true } };

export function EventForm({ babyId, types, event, initialTypeId, onDone }: EventFormProps) {
  const { t } = useTranslation();
  const names = useEventTypeText();
  const commands = useEventCommands();
  const [form, setForm] = useState<EventFormState>(() =>
    initialForm(types, event, initialTypeId, new Date()),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const type = types.find((candidate) => candidate.id === form.typeId);
  const patch = (changes: Partial<EventFormState>) => setForm((f) => ({ ...f, ...changes }));

  const submit = async () => {
    const problems = validateForm(form, type, names);
    setErrors(problems);
    if (problems.length > 0 || !type) return;
    const times = buildTimes(form, type);
    const data = {
      typeId: type.id,
      ...times,
      payload: buildPayload(form, type),
      notes: form.notes.trim() || null,
    };
    try {
      await (event ? commands.edit(event.id, data) : commands.create({ babyId, ...data }));
      onDone();
    } catch (error) {
      setErrors([error instanceof Error ? describeApiError(error) : t('events.saveFailed')]);
    }
  };

  const remove = async () => {
    if (!event) return;
    await commands.remove(event.id);
    onDone();
  };

  return (
    <Stack spacing={2} component="form" noValidate onSubmit={(e) => e.preventDefault()}>
      <TextField
        select
        label={t('common.type')}
        value={form.typeId}
        onChange={(e) => patch({ typeId: e.target.value, values: {}, medications: {} })}
      >
        {types.map((candidate) => (
          <MenuItem key={candidate.id} value={candidate.id} sx={{ minHeight: 48 }}>
            {names.typeName(candidate)}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        type="datetime-local"
        label={type?.hasDuration === false ? t('events.time') : t('events.start')}
        value={form.startedAt}
        onChange={(e) => patch({ startedAt: e.target.value })}
        slotProps={dateTimeSlots}
      />
      {type?.hasDuration && (
        <TextField
          type="datetime-local"
          label={t('events.end')}
          helperText={t('events.endHelp')}
          value={form.endedAt}
          onChange={(e) => patch({ endedAt: e.target.value })}
          slotProps={dateTimeSlots}
        />
      )}
      {isMedicationType(type) ? (
        <MedicationChecklist
          babyId={babyId}
          selected={form.medications}
          onChange={(medications) => patch({ medications })}
        />
      ) : (
        type?.fields.map((field) => (
          <TypeField
            key={field.key}
            type={type}
            field={field}
            value={getOwn(form.values, field.key)}
            onChange={(value) => patch({ values: withOwn(form.values, field.key, value) })}
          />
        ))
      )}
      <TextField
        label={t('common.notes')}
        multiline
        minRows={2}
        value={form.notes}
        onChange={(e) => patch({ notes: e.target.value })}
      />
      {errors.length > 0 && (
        <Alert severity="error">
          {errors.map((message) => (
            <div key={message}>{message}</div>
          ))}
        </Alert>
      )}
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
        {event && (
          <Button color="error" onClick={() => setConfirmingDelete(true)} sx={{ mr: 'auto' }}>
            {t('common.delete')}
          </Button>
        )}
        <Button onClick={onDone}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={submit} sx={{ minHeight: 48 }}>
          {t('common.save')}
        </Button>
      </Stack>
      <ConfirmDeleteDialog
        open={confirmingDelete}
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={remove}
      />
    </Stack>
  );
}
