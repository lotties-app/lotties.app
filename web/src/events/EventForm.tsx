import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Button, MenuItem, Stack, TextField } from '@mui/material';
import { describeApiError } from '../api/errorMessages';
import { useEventCommands } from '../db/hooks';
import type { BabyEvent, EventType } from '../db/models';
import { useLocale } from '../i18n/useLocale';
import {
  buildPayload,
  buildTimes,
  initialForm,
  isMedicationType,
  pruneHiddenValues,
  validateForm,
  type EventFormState,
  type FormPrefill,
} from './formModel';
import { recordLastUsed } from './lastUsedValues';
import { MedicationChecklist } from './MedicationChecklist';
import { ConditionalFields } from './ConditionalFields';
import { ConfirmDeleteDialog } from './ConfirmDeleteDialog';
import { useEventTypeText } from '../i18n/eventTypeText';
import { withOwn } from '../util/ownProperty';

/** Compact mode: only these fields (and the ones they reveal); saving completes the event. */
export interface FinishMode {
  fields: readonly string[];
  /** Values to pre-select (remembered last-used values), by field key. */
  initialValues?: EventFormState['values'];
}

export interface EventFormProps {
  babyId: string;
  types: EventType[];
  /** Existing event to edit; omit to create. */
  event?: BabyEvent;
  initialTypeId?: string;
  /** Starting values of a new event (a `sheet` preset). */
  prefill?: FormPrefill;
  /** With `event`: the "Finish this ..." form of a timer stopped without its required fields. */
  finish?: FinishMode;
  onDone: () => void;
}

const dateTimeSlots = (lang: string) => ({
  inputLabel: { shrink: true },
  htmlInput: { lang },
});

function startForm({ types, event, initialTypeId, prefill, finish }: EventFormProps) {
  const form = initialForm(types, event ?? prefill, initialTypeId, new Date());
  if (!finish?.initialValues) return form;
  const values = { ...finish.initialValues, ...form.values };
  const type = types.find((candidate) => candidate.id === form.typeId);
  return { ...form, values: pruneHiddenValues(values, type) };
}

export function EventForm(props: EventFormProps) {
  const { babyId, types, event, finish, onDone } = props;
  const { t } = useTranslation();
  const { locale } = useLocale();
  const names = useEventTypeText();
  const commands = useEventCommands();
  const [form, setForm] = useState<EventFormState>(() => startForm(props));
  const [errors, setErrors] = useState<string[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const type = types.find((candidate) => candidate.id === form.typeId);
  const patch = (changes: Partial<EventFormState>) => setForm((f) => ({ ...f, ...changes }));
  const setValue = (key: string, value: string | boolean) =>
    setForm((f) => ({ ...f, values: pruneHiddenValues(withOwn(f.values, key, value), type) }));

  const save = async (selected: EventType) => {
    if (event && finish) {
      const payload = buildPayload(form, selected, event.payload);
      await commands.finish(event.id, payload);
      return payload;
    }
    const times = buildTimes(form, selected);
    const payload = buildPayload(form, selected);
    const data = { typeId: selected.id, ...times, payload, notes: form.notes.trim() || null };
    await (event ? commands.edit(event.id, data) : commands.create({ babyId, ...data }));
    return payload;
  };

  const submit = async () => {
    const problems = validateForm(form, type, names);
    setErrors(problems);
    if (problems.length > 0 || !type) return;
    try {
      recordLastUsed(babyId, type, await save(type));
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
      {!finish && (
        <>
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
            slotProps={dateTimeSlots(locale)}
          />
          {type?.hasDuration && (
            <TextField
              type="datetime-local"
              label={t('events.end')}
              helperText={t('events.endHelp')}
              value={form.endedAt}
              onChange={(e) => patch({ endedAt: e.target.value })}
              slotProps={dateTimeSlots(locale)}
            />
          )}
        </>
      )}
      {isMedicationType(type) ? (
        <MedicationChecklist
          babyId={babyId}
          selected={form.medications}
          onChange={(medications) => patch({ medications })}
        />
      ) : (
        type && (
          <ConditionalFields
            type={type}
            values={form.values}
            only={finish?.fields}
            onChange={setValue}
          />
        )
      )}
      {!finish && (
        <TextField
          label={t('common.notes')}
          multiline
          minRows={2}
          value={form.notes}
          onChange={(e) => patch({ notes: e.target.value })}
        />
      )}
      {errors.length > 0 && (
        <Alert severity="error">
          {errors.map((message) => (
            <div key={message}>{message}</div>
          ))}
        </Alert>
      )}
      <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
        {event && !finish && (
          <Button color="error" onClick={() => setConfirmingDelete(true)} sx={{ mr: 'auto' }}>
            {t('common.delete')}
          </Button>
        )}
        <Button onClick={onDone}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={submit} sx={{ minHeight: 48 }}>
          {finish && event?.endedAt === null ? t('events.saveAndStop') : t('common.save')}
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
