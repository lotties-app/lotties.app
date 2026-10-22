import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button } from '@mui/material';
import { InvalidAppointmentError } from '../db/appointmentCommands';
import { useAppointmentCommands } from '../db/hooks';
import type { Appointment, AppointmentType, ReminderOffset } from '../db/models';
import { SheetFrame } from '../now/ui/SheetFrame';
import { CategoryIcon } from '../ui/CategoryIcon';
import {
  ChipGroup,
  ClockTimeField,
  DateField,
  Field,
  NotesRow,
  NumberStepper,
  TextInput,
} from '../ui/form';
import {
  APPOINTMENT_LIMITS,
  APPOINTMENT_TYPES,
  DEFAULT_REMINDERS,
  REMINDER_OFFSETS,
} from './appointmentModel';
import { TYPE_ICON } from './appointmentText';
import { FieldContext } from '../ui/form/fieldContext';
import { dayKeyOf, instantOf, timeOfDayOf, type DayKey } from './calendarModel';

interface Props {
  babyId: string;
  /** Omit to add a new appointment. */
  appointment?: Appointment;
  /** The day a new appointment starts on (the chosen calendar day, else today). */
  initialDay?: DayKey;
  /** The clock (tests and previews); defaults to now. */
  now?: number;
  onClose: () => void;
  onSaved?: (appointment: Appointment) => void;
}

interface FormState {
  title: string;
  type: AppointmentType;
  day: DayKey;
  time: string;
  duration: number | null;
  location: string;
  doctorName: string;
  notes: string;
  outcome: string;
  reminders: ReminderOffset[];
}

type FormError = 'title' | 'when' | 'notStarted' | 'failed';

/** Usual lengths offered beside the duration stepper (named in words, unlike the reminder chips). */
const DURATION_CHOICES = [15, 30, 60] as const;

/** A new appointment today starts at the next whole hour; on another day at 09:00. */
function defaultTime(day: DayKey, now: number): string {
  if (day !== dayKeyOf(now)) return '09:00';
  const hour = Math.min(23, Number(timeOfDayOf(now).slice(0, 2)) + 1);
  return `${String(hour).padStart(2, '0')}:00`;
}

function initialState(appointment: Appointment | undefined, day: DayKey, now: number): FormState {
  if (!appointment) {
    return {
      title: '',
      type: 'consultation',
      day,
      time: defaultTime(day, now),
      duration: null,
      location: '',
      doctorName: '',
      notes: '',
      outcome: '',
      reminders: [...DEFAULT_REMINDERS],
    };
  }
  return {
    title: appointment.title,
    type: appointment.type,
    day: dayKeyOf(appointment.startsAt),
    time: timeOfDayOf(appointment.startsAt),
    duration: appointment.durationMinutes,
    location: appointment.location ?? '',
    doctorName: appointment.doctorName ?? '',
    notes: appointment.notes ?? '',
    outcome: appointment.outcome ?? '',
    reminders: [...appointment.reminderOffsetsMinutes],
  };
}

/**
 * Add or edit an appointment of the baby: title, type chips, date and time (the app's date field
 * and the native time picker), an optional duration, place, doctor, notes, the outcome of a visit
 * marked done, and the reminder chips (1 day and 2 hours before by default). Saved on the device
 * and queued for sync.
 */
export function AppointmentSheet({
  babyId,
  appointment,
  initialDay,
  now,
  onClose,
  onSaved,
}: Props) {
  const { t } = useTranslation();
  const commands = useAppointmentCommands();
  const [clock] = useState(() => now ?? Date.now());
  const [form, setForm] = useState<FormState>(() =>
    initialState(appointment, initialDay ?? dayKeyOf(clock), clock),
  );
  const [error, setError] = useState<FormError | null>(null);
  const [saving, setSaving] = useState(false);
  const change = (patch: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...patch }));
    setError(null);
  };
  const showOutcome = appointment?.status === 'done';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.title.trim()) return setError('title');
    if (!form.day || !/^\d{2}:\d{2}$/.test(form.time)) return setError('when');
    setSaving(true);
    const terms = {
      title: form.title,
      type: form.type,
      startsAt: instantOf(form.day, form.time),
      durationMinutes: form.duration,
      location: form.location,
      doctorName: form.doctorName,
      notes: form.notes,
      outcome: showOutcome ? form.outcome : (appointment?.outcome ?? null),
      status: appointment?.status ?? 'upcoming',
      reminderOffsetsMinutes: form.reminders,
    };
    try {
      const saved = appointment
        ? await commands.update(appointment.id, terms)
        : await commands.create(babyId, terms);
      onSaved?.(saved);
      onClose();
    } catch (e) {
      setError(
        e instanceof InvalidAppointmentError && e.code === 'notStarted' ? 'notStarted' : 'failed',
      );
      setSaving(false);
    }
  };

  return (
    <SheetFrame
      open
      onClose={onClose}
      title={appointment ? t('appointments.sheet.editTitle') : t('appointments.sheet.newTitle')}
      leading={<CategoryIcon name={TYPE_ICON[form.type]} category="health" size={24} />}
    >
      <Box
        component="form"
        noValidate
        onSubmit={(e: FormEvent) => void submit(e)}
        sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 2.5 }}
      >
        <Field
          label={t('appointments.sheet.title')}
          required
          error={error === 'title' ? t('appointments.sheet.titleRequired') : undefined}
        >
          <TextInput
            value={form.title}
            onChange={(title) => change({ title })}
            maxLength={APPOINTMENT_LIMITS.title}
            placeholder={t('appointments.sheet.titlePlaceholder')}
          />
        </Field>
        <Field label={t('appointments.sheet.type')} group>
          <ChipGroup<AppointmentType>
            value={form.type}
            onChange={(type) => type && change({ type })}
            options={APPOINTMENT_TYPES.map((type) => ({
              value: type,
              label: t(`appointments.types.${type}`),
              icon: TYPE_ICON[type],
            }))}
          />
        </Field>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
            gap: 1.5,
          }}
        >
          <Field
            label={t('appointments.sheet.date')}
            required
            error={error === 'when' ? t('appointments.sheet.whenRequired') : undefined}
          >
            <DateField
              value={form.day}
              onChange={(day) => change({ day })}
              min="2000-01-01"
              max="2100-12-31"
            />
          </Field>
          <Field label={t('appointments.sheet.time')} required>
            <ClockTimeField value={form.time} onChange={(time) => change({ time })} />
          </Field>
        </Box>
        <Field label={t('appointments.sheet.duration')} optional>
          <NumberStepper
            value={form.duration}
            onChange={(duration) => change({ duration })}
            step={5}
            min={APPOINTMENT_LIMITS.minDuration}
            max={APPOINTMENT_LIMITS.maxDuration}
            start={30}
            unit={t('appointments.sheet.minutesUnit')}
          />
          {/* Own name ("Usual lengths"), not the field's: the chips are a shortcut beside the stepper. */}
          <FieldContext value={null}>
            <Box sx={{ mt: 1.25 }}>
              <ChipGroup<string>
                clearable
                aria-label={t('appointments.sheet.durationChoices')}
                value={form.duration === null ? null : String(form.duration)}
                onChange={(value) => change({ duration: value === null ? null : Number(value) })}
                options={DURATION_CHOICES.map((minutes) => ({
                  value: String(minutes),
                  label: t(`appointments.sheet.durationChips.${minutes}`),
                }))}
              />
            </Box>
          </FieldContext>
        </Field>
        <Field label={t('appointments.sheet.location')} optional icon="map-pin">
          <TextInput
            value={form.location}
            onChange={(location) => change({ location })}
            maxLength={APPOINTMENT_LIMITS.location}
          />
        </Field>
        <Field label={t('appointments.sheet.doctor')} optional icon="stethoscope">
          <TextInput
            value={form.doctorName}
            onChange={(doctorName) => change({ doctorName })}
            maxLength={APPOINTMENT_LIMITS.doctorName}
          />
        </Field>
        <Field label={t('appointments.sheet.notes')} optional>
          <NotesRow
            value={form.notes}
            onChange={(notes) => change({ notes })}
            maxLength={APPOINTMENT_LIMITS.notes}
          />
        </Field>
        {showOutcome && (
          <Field label={t('appointments.sheet.outcome')} optional>
            <NotesRow
              value={form.outcome}
              onChange={(outcome) => change({ outcome })}
              maxLength={APPOINTMENT_LIMITS.outcome}
            />
          </Field>
        )}
        <Field
          label={t('appointments.sheet.reminders')}
          group
          help={t('appointments.sheet.remindersHelp')}
        >
          <ChipGroup<string>
            multiple
            value={form.reminders.map(String)}
            onChange={(values) =>
              change({
                reminders: REMINDER_OFFSETS.filter((offset) => values.includes(String(offset))),
              })
            }
            options={REMINDER_OFFSETS.map((offset) => ({
              value: String(offset),
              label: t(`appointments.reminders.${offset}`),
              icon: 'bell',
            }))}
          />
        </Field>
        {(error === 'failed' || error === 'notStarted') && (
          <Box role="alert" sx={{ fontSize: '0.875rem', color: 'error.main' }}>
            {t(
              error === 'notStarted'
                ? 'appointments.sheet.notStarted'
                : 'appointments.sheet.saveFailed',
            )}
          </Box>
        )}
        <Button
          type="submit"
          variant="contained"
          disabled={saving}
          sx={{ minHeight: 52, borderRadius: '999px' }}
        >
          {t('common.save')}
        </Button>
      </Box>
    </SheetFrame>
  );
}
