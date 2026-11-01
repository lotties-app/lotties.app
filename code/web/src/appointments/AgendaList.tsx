import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, ButtonBase, Chip, Stack, Typography } from '@mui/material';
import type { Appointment } from '../db/models';
import { RADIUS } from '../theme/tokens';
import { CategoryIcon } from '../ui/CategoryIcon';
import { Icon } from '../ui/Icon';
import { palette } from '../ui/form/styles';
import { needsOutcome } from './appointmentModel';
import { TYPE_ICON, whenLine } from './appointmentText';

/** The status chip of a row: done, cancelled, or the gentle "Did it happen?" after the start. */
export function StatusChip({ appointment, now }: { appointment: Appointment; now: number }) {
  const { t } = useTranslation();
  if (appointment.status === 'done') {
    return (
      <Chip
        size="small"
        color="success"
        variant="outlined"
        icon={<Icon name="check" size={16} />}
        label={t('appointments.status.done')}
      />
    );
  }
  if (appointment.status === 'cancelled') {
    return <Chip size="small" variant="outlined" label={t('appointments.status.cancelled')} />;
  }
  if (needsOutcome(appointment, now)) {
    return (
      <Chip size="small" color="primary" variant="outlined" label={t('appointments.status.ask')} />
    );
  }
  return null;
}

interface RowProps {
  appointment: Appointment;
  now: number;
  onOpen: (appointment: Appointment) => void;
}

/** One appointment: type stamp, title, when and where, and its status chip; tap opens the detail. */
export function AppointmentRow({ appointment, now, onOpen }: RowProps) {
  const cancelled = appointment.status === 'cancelled';
  const where = [whenLine(appointment), appointment.location].filter(Boolean).join(' · ');
  return (
    <Box component="li" sx={{ listStyle: 'none' }}>
      <ButtonBase
        onClick={() => onOpen(appointment)}
        sx={(theme) => ({
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          p: 1.5,
          minHeight: 64,
          textAlign: 'start',
          borderRadius: `${RADIUS.tile}px`,
          backgroundColor: palette(theme).background.paper,
          opacity: cancelled ? 0.72 : 1,
        })}
      >
        <CategoryIcon name={TYPE_ICON[appointment.type]} category="health" size={20} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            sx={{
              fontWeight: 500,
              textDecoration: cancelled ? 'line-through' : 'none',
              overflowWrap: 'anywhere',
            }}
          >
            {appointment.title}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {where}
          </Typography>
        </Box>
        <StatusChip appointment={appointment} now={now} />
      </ButtonBase>
    </Box>
  );
}

interface ListProps {
  title: string;
  appointments: readonly Appointment[];
  now: number;
  onOpen: (appointment: Appointment) => void;
  /** Heading level: `h2` for the agenda, `h3` for the "Past" part under it. */
  heading?: 'h2' | 'h3';
}

/** A titled list of appointment rows. */
export function AppointmentList({ title, appointments, now, onOpen, heading = 'h2' }: ListProps) {
  const titleId = useId();
  return (
    <Stack spacing={1} component="section" aria-labelledby={titleId}>
      <Typography
        id={titleId}
        variant={heading === 'h2' ? 'subtitle1' : 'subtitle2'}
        component={heading}
        color={heading === 'h2' ? 'text.primary' : 'text.secondary'}
        sx={{ fontWeight: 500 }}
      >
        {title}
      </Typography>
      <Box component="ul" sx={{ m: 0, p: 0, display: 'grid', gap: 1 }}>
        {appointments.map((appointment) => (
          <AppointmentRow
            key={appointment.id}
            appointment={appointment}
            now={now}
            onOpen={onOpen}
          />
        ))}
      </Box>
    </Stack>
  );
}
