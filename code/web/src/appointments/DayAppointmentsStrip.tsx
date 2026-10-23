import { useTranslation } from 'react-i18next';
import { Box, ButtonBase, Typography } from '@mui/material';
import type { Appointment } from '../db/models';
import { formatTime } from '../i18n/format';
import { RADIUS } from '../theme/tokens';
import { CategoryIcon } from '../ui/CategoryIcon';
import { palette } from '../ui/form/styles';
import { StatusChip } from './AgendaList';
import { TYPE_ICON } from './appointmentText';

interface Props {
  appointments: readonly Appointment[];
  now: number;
  onOpen: (appointment: Appointment) => void;
}

/**
 * The day's appointments above the Day ribbon, compact: time, title and status; tapping one opens
 * its detail. Nothing when the day has none.
 */
export function DayAppointmentsStrip({ appointments, now, onOpen }: Props) {
  const { t } = useTranslation();
  if (appointments.length === 0) return null;
  return (
    <Box
      component="section"
      aria-label={t('appointments.day.label')}
      sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 0.75 }}
    >
      <Box
        component="ul"
        sx={{ m: 0, p: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 0.75 }}
      >
        {appointments.map((appointment) => (
          <Box component="li" key={appointment.id} sx={{ listStyle: 'none' }}>
            <ButtonBase
              onClick={() => onOpen(appointment)}
              sx={(theme) => ({
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 1.25,
                px: 1.5,
                py: 1,
                minHeight: 48,
                textAlign: 'start',
                borderRadius: `${RADIUS.tile}px`,
                backgroundColor: palette(theme).background.paper,
                opacity: appointment.status === 'cancelled' ? 0.72 : 1,
              })}
            >
              <CategoryIcon name={TYPE_ICON[appointment.type]} category="health" size={16} />
              <Typography
                variant="body2"
                sx={{ fontVariantNumeric: 'tabular-nums', color: 'text.secondary', flex: 'none' }}
              >
                {formatTime(appointment.startsAt)}
              </Typography>
              <Typography
                variant="body2"
                sx={{
                  flex: 1,
                  minWidth: 0,
                  fontWeight: 500,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  textDecoration: appointment.status === 'cancelled' ? 'line-through' : 'none',
                }}
              >
                {appointment.title}
              </Typography>
              <StatusChip appointment={appointment} now={now} />
            </ButtonBase>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
