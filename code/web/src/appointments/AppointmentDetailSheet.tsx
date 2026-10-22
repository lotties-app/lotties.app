import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Box, Button, Card, Stack, Typography } from '@mui/material';
import { useAppointmentCommands } from '../db/hooks';
import type { Appointment } from '../db/models';
import { formatRelative } from '../i18n/format';
import { SheetFrame } from '../now/ui/SheetFrame';
import { CategoryIcon } from '../ui/CategoryIcon';
import { Field, NotesRow } from '../ui/form';
import { Icon } from '../ui/Icon';
import type { IconName } from '../ui/icons';
import { announceUndo } from '../ui/undoNotice';
import { StatusChip } from './AgendaList';
import { APPOINTMENT_LIMITS, needsOutcome } from './appointmentModel';
import { remindersLine, TYPE_ICON, whenLine } from './appointmentText';
import { downloadIcs } from './downloadIcs';
import { appointmentToIcs, icsFileName } from './ics';

interface Props {
  appointment: Appointment;
  /** Owner or Parent: edit, mark done, cancel and restore. Others only read (and export). */
  writable: boolean;
  now: number;
  onClose: () => void;
  onEdit: (appointment: Appointment) => void;
}

function DetailRow({
  icon,
  label,
  children,
}: {
  icon: IconName;
  label: string;
  children: ReactNode;
}) {
  return (
    <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start' }}>
      <Box sx={{ color: 'text.secondary', pt: 0.25, flex: 'none' }}>
        <Icon name={icon} size={20} />
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="caption" color="text.secondary" component="p">
          {label}
        </Typography>
        <Typography sx={{ overflowWrap: 'anywhere', whiteSpace: 'pre-line' }}>
          {children}
        </Typography>
      </Box>
    </Box>
  );
}

/** "Did it happen?": after the start of a still upcoming visit, the outcome and "Mark as done". */
function MarkDoneCard({ appointment, onDone }: { appointment: Appointment; onDone: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const commands = useAppointmentCommands();
  const [outcome, setOutcome] = useState(appointment.outcome ?? '');
  const [failed, setFailed] = useState(false);
  const save = async () => {
    try {
      await commands.markDone(appointment.id, outcome);
      onDone();
    } catch {
      setFailed(true);
    }
  };
  return (
    <Card variant="outlined" component="section" aria-labelledby="appointment-ask" sx={{ p: 2 }}>
      <Stack spacing={1.5}>
        <Typography id="appointment-ask" sx={{ fontWeight: 500 }}>
          {t('appointments.detail.ask')}
        </Typography>
        <Field label={t('appointments.detail.outcome')} optional>
          <NotesRow value={outcome} onChange={setOutcome} maxLength={APPOINTMENT_LIMITS.outcome} />
        </Field>
        {failed && (
          <Box role="alert" sx={{ fontSize: '0.875rem', color: 'error.main' }}>
            {t('appointments.sheet.saveFailed')}
          </Box>
        )}
        <Stack
          direction="row"
          spacing={1}
          sx={{ justifyContent: 'flex-end', flexWrap: 'wrap', gap: 1 }}
        >
          <Button
            startIcon={<Icon name="ruler" size={20} />}
            onClick={() => navigate('/insights#growth')}
            sx={{ minHeight: 48 }}
          >
            {t('appointments.detail.addMeasurements')}
          </Button>
          <Button
            variant="contained"
            startIcon={<Icon name="calendar-check" size={20} />}
            onClick={() => void save()}
            sx={{ minHeight: 48 }}
          >
            {t('appointments.detail.markDone')}
          </Button>
        </Stack>
      </Stack>
    </Card>
  );
}

/**
 * One appointment: when (with "in 3 days" while ahead), where, the doctor, the reminders, notes
 * and outcome; "Add to calendar" (an .ics file) for everyone; for Owners and Parents also Edit,
 * Cancel appointment (with Undo) or Restore, and, once the visit has started and it is still
 * upcoming, the gentle "Did it happen?" card with the outcome, "Add measurements" and "Mark as
 * done". Caregivers and Viewers see everything read-only, without buttons they cannot use.
 */
export function AppointmentDetailSheet({ appointment, writable, now, onClose, onEdit }: Props) {
  const { t } = useTranslation();
  const commands = useAppointmentCommands();
  const start = Date.parse(appointment.startsAt);
  const ahead = appointment.status === 'upcoming' && start > now;
  const reminders = remindersLine(t, appointment.reminderOffsetsMinutes);
  // "Did it happen?" is asked in its card, so the chip saying it is left out then.
  const asking = writable && needsOutcome(appointment, now);

  const exportIcs = () => {
    const text = appointmentToIcs(appointment, {
      now: new Date(now),
      labels: { doctor: t('appointments.detail.doctor') },
    });
    downloadIcs(text, icsFileName(appointment));
  };
  const cancel = async () => {
    await commands.cancel(appointment.id);
    onClose();
    announceUndo(
      t('appointments.detail.cancelledNotice', { title: appointment.title }),
      async () => {
        await commands.restore(appointment.id);
      },
    );
  };

  return (
    <SheetFrame
      open
      onClose={onClose}
      title={appointment.title}
      subtitle={t(`appointments.types.${appointment.type}`)}
      leading={<CategoryIcon name={TYPE_ICON[appointment.type]} category="health" size={24} />}
    >
      {asking && <MarkDoneCard appointment={appointment} onDone={onClose} />}
      {!asking && (appointment.status !== 'upcoming' || needsOutcome(appointment, now)) && (
        <Box sx={{ display: 'flex' }}>
          <StatusChip appointment={appointment} now={now} />
        </Box>
      )}
      <Stack spacing={1.75}>
        <DetailRow icon="clock" label={t('appointments.detail.when')}>
          {whenLine(appointment)}
          {ahead ? ` · ${formatRelative(start, now)}` : ''}
        </DetailRow>
        {appointment.location && (
          <DetailRow icon="map-pin" label={t('appointments.detail.location')}>
            {appointment.location}
          </DetailRow>
        )}
        {appointment.doctorName && (
          <DetailRow icon="stethoscope" label={t('appointments.detail.doctor')}>
            {appointment.doctorName}
          </DetailRow>
        )}
        <DetailRow icon="bell" label={t('appointments.detail.reminders')}>
          {reminders ?? t('appointments.detail.noReminders')}
        </DetailRow>
        {appointment.notes && (
          <DetailRow icon="note" label={t('appointments.detail.notes')}>
            {appointment.notes}
          </DetailRow>
        )}
        {appointment.outcome && (
          <DetailRow icon="check" label={t('appointments.detail.outcome')}>
            {appointment.outcome}
          </DetailRow>
        )}
      </Stack>
      <Stack spacing={1}>
        <Button
          variant="outlined"
          startIcon={<Icon name="calendar-plus" size={20} />}
          onClick={exportIcs}
          sx={{ minHeight: 48 }}
        >
          {t('appointments.detail.addToCalendar')}
        </Button>
        {writable && (
          <Button
            variant="outlined"
            startIcon={<Icon name="edit" size={20} />}
            onClick={() => onEdit(appointment)}
            sx={{ minHeight: 48 }}
          >
            {t('appointments.detail.edit')}
          </Button>
        )}
        {writable && appointment.status === 'upcoming' && (
          <Button
            color="error"
            startIcon={<Icon name="calendar-x" size={20} />}
            onClick={() => void cancel()}
            sx={{ minHeight: 48 }}
          >
            {t('appointments.detail.cancel')}
          </Button>
        )}
        {writable && appointment.status === 'cancelled' && (
          <Button
            startIcon={<Icon name="undo" size={20} />}
            onClick={() => void commands.restore(appointment.id)}
            sx={{ minHeight: 48 }}
          >
            {t('appointments.detail.restore')}
          </Button>
        )}
        {!writable && (
          <Typography variant="body2" color="text.secondary">
            {t('appointments.viewOnly')}
          </Typography>
        )}
      </Stack>
    </SheetFrame>
  );
}
