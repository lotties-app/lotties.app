import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { Box, ButtonBase, Card, Typography } from '@mui/material';
import { useAppointments } from '../db/hooks';
import type { Appointment } from '../db/models';
import { formatRelative } from '../i18n/format';
import { CategoryIcon } from '../ui/CategoryIcon';
import { Icon } from '../ui/Icon';
import { nextAppointment } from './appointmentModel';
import { TYPE_ICON, whenLine } from './appointmentText';
import type { AppointmentsLocationState } from './AppointmentsScreen';

/**
 * "Next appointment" on Now: the soonest upcoming appointment within 14 days, with when and where;
 * tapping it opens its detail on the appointments page.
 */
export function NextAppointmentCard({
  appointment,
  now,
}: {
  appointment: Appointment;
  now: number;
}) {
  const { t } = useTranslation();
  const state: AppointmentsLocationState = { appointmentId: appointment.id };
  const start = Date.parse(appointment.startsAt);
  const when = [whenLine(appointment), start > now ? formatRelative(start, now) : null]
    .filter(Boolean)
    .join(' · ');
  return (
    <Card component="section" aria-label={t('appointments.next.label')} sx={{ p: 0 }}>
      <ButtonBase
        component={RouterLink}
        to="/appointments"
        state={state}
        sx={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 1.5,
          p: 2.5,
          textAlign: 'start',
        }}
      >
        <CategoryIcon name={TYPE_ICON[appointment.type]} category="health" size={20} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" color="text.secondary" component="p">
            {t('appointments.next.label')}
          </Typography>
          <Typography sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>
            {appointment.title}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
            {when}
            {appointment.location ? ` · ${appointment.location}` : ''}
          </Typography>
        </Box>
        <Icon name="chevron-right" size={20} />
      </ButtonBase>
    </Card>
  );
}

/** The card when the selected baby has an upcoming appointment within 14 days; nothing otherwise. */
export function NextAppointment({ babyId, now }: { babyId: string; now: number }) {
  const appointments = useAppointments(babyId);
  const next = appointments ? nextAppointment(appointments, now) : null;
  return next ? <NextAppointmentCard appointment={next} now={now} /> : null;
}
