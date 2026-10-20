import { useState } from 'react';
import { Alert, Button, MenuItem, Stack, TextField } from '@mui/material';
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
  const commands = useEventCommands();
  const [form, setForm] = useState<EventFormState>(() =>
    initialForm(types, event, initialTypeId, new Date()),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const type = types.find((t) => t.id === form.typeId);
  const patch = (changes: Partial<EventFormState>) => setForm((f) => ({ ...f, ...changes }));

  const submit = async () => {
    const problems = validateForm(form, type);
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
      setErrors([error instanceof Error ? error.message : 'Could not save the event.']);
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
        label="Type"
        value={form.typeId}
        onChange={(e) => patch({ typeId: e.target.value, values: {}, medications: {} })}
      >
        {types.map((t) => (
          <MenuItem key={t.id} value={t.id} sx={{ minHeight: 48 }}>
            {t.name}
          </MenuItem>
        ))}
      </TextField>
      <TextField
        type="datetime-local"
        label={type?.hasDuration === false ? 'Time' : 'Start'}
        value={form.startedAt}
        onChange={(e) => patch({ startedAt: e.target.value })}
        slotProps={dateTimeSlots}
      />
      {type?.hasDuration && (
        <TextField
          type="datetime-local"
          label="End"
          helperText="Leave empty while it is still running."
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
            field={field}
            value={form.values[field.key]}
            onChange={(value) => patch({ values: { ...form.values, [field.key]: value } })}
          />
        ))
      )}
      <TextField
        label="Notes"
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
            Delete
          </Button>
        )}
        <Button onClick={onDone}>Cancel</Button>
        <Button variant="contained" onClick={submit} sx={{ minHeight: 48 }}>
          Save
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
