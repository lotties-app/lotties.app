import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { Alert, Box, Button, Skeleton, Stack, Typography } from '@mui/material';
import { isCaregiver } from '../baby/permissions';
import { useAppointments } from '../db/hooks';
import type { Baby } from '../db/models';
import { useNow } from '../events/time';
import { formatDate } from '../i18n/format';
import { currentLocale } from '../i18n/i18n';
import { useNotificationLink } from '../notifications/notificationLinkContext';
import { CategoryIcon } from '../ui/CategoryIcon';
import { Icon } from '../ui/Icon';
import { AppointmentList } from './AgendaList';
import { agendaOf } from './appointmentModel';
import {
  appointmentsByDay,
  dayKeyOf,
  firstDayOfWeek,
  monthOfKey,
  type DayKey,
  type MonthRef,
} from './calendarModel';
import { MonthCalendar } from './MonthCalendar';
import { useAppointmentSheets } from './useAppointmentSheets';

/** Router state the Now card and the Day strip pass to open one appointment's detail. */
export interface AppointmentsLocationState {
  appointmentId?: string;
}

function EmptyAgenda({ writable, onAdd }: { writable: boolean; onAdd: () => void }) {
  const { t } = useTranslation();
  return (
    <Box sx={{ display: 'grid', justifyItems: 'center', gap: 1.5, py: 4, textAlign: 'center' }}>
      <CategoryIcon name="calendar" category="health" size={32} />
      <Typography variant="h6" component="h2">
        {t('appointments.empty.title')}
      </Typography>
      <Typography color="text.secondary">{t('appointments.empty.body')}</Typography>
      {writable && (
        <Button
          variant="contained"
          startIcon={<Icon name="add" size={20} />}
          onClick={onAdd}
          sx={{ minHeight: 48, borderRadius: '999px', px: 3 }}
        >
          {t('appointments.add')}
        </Button>
      )}
    </Box>
  );
}

/**
 * Opens the detail an appointment reminder points at (its deep link, once the baby is selected and
 * a short sync ran) or that the Now card / Day strip asked for (router state), once it is loaded.
 */
function useRequestedDetail(babyId: string, ready: boolean, openDetail: (id: string) => void) {
  const links = useNotificationLink();
  const location = useLocation();
  const requested = (location.state as AppointmentsLocationState | null)?.appointmentId;
  const [handledState, setHandledState] = useState<string | undefined>();
  // Adjusted while rendering (not in an effect): the detail opens in the same render pass.
  if (ready && requested && requested !== handledState) {
    setHandledState(requested);
    openDetail(requested);
  }
  const link = links?.link;
  useEffect(() => {
    if (!ready || !link || link.kind !== 'appt' || link.babyId !== babyId) return;
    openDetail(link.appointmentId);
    links?.consume();
  }, [ready, link, links, babyId, openDetail]);
}

/**
 * The appointments of one baby (docs/design/15-appointments.md): the month calendar (tap a day to
 * filter the agenda to it), then the agenda: upcoming soonest first, then past ones newest first
 * with their status. Owners and Parents add, edit, mark done and cancel; Caregivers and Viewers
 * read. Offline first: everything comes from the device.
 */
export function AppointmentsScreen({
  baby,
  initialNow,
  initialSelected = null,
}: {
  baby: Baby;
  /** A fixed clock (tests). */
  initialNow?: number;
  /** A day chosen at once (previews). */
  initialSelected?: DayKey | null;
}) {
  const { t } = useTranslation();
  const clock = useNow(60_000);
  const now = initialNow ?? clock;
  const today = dayKeyOf(now);
  const appointments = useAppointments(baby.id);
  const [month, setMonth] = useState<MonthRef>(() => monthOfKey(initialSelected ?? today));
  const [selected, setSelected] = useState<DayKey | null>(initialSelected);
  const sheets = useAppointmentSheets(baby, appointments, now);
  const weekStartsOn = firstDayOfWeek(currentLocale(), globalThis.navigator?.languages ?? []);
  useRequestedDetail(baby.id, appointments !== undefined, sheets.openDetail);

  if (!appointments) {
    return (
      <Stack spacing={2} role="status" aria-busy="true" aria-label={t('common.loading')}>
        <Skeleton variant="rounded" height={44} />
        <Skeleton variant="rounded" height={300} />
      </Stack>
    );
  }

  const byDay = appointmentsByDay(appointments);
  const counts = new Map(
    [...byDay].map(([day, list]) => [day, list.filter((a) => a.status !== 'cancelled').length]),
  );
  const { upcoming, past } = agendaOf(appointments, now);
  const ofDay = selected ? (byDay.get(selected) ?? []) : [];
  const selectedLabel = selected ? formatDate(selected, 'weekdayLong') : '';

  return (
    <Stack spacing={2.5}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Typography variant="h4" component="h1" sx={{ flex: 1 }}>
          {t('appointments.title')}
        </Typography>
        {sheets.writable && (
          <Button
            variant="contained"
            startIcon={<Icon name="add" size={20} />}
            onClick={() => sheets.openNew(selected ?? undefined)}
            sx={{ minHeight: 48, borderRadius: '999px' }}
          >
            {t('appointments.add')}
          </Button>
        )}
      </Box>
      {!sheets.writable && (
        <Alert severity="info">
          {t(isCaregiver(baby) ? 'appointments.caregiverNotice' : 'appointments.viewerNotice')}
        </Alert>
      )}
      <MonthCalendar
        month={month}
        onMonthChange={setMonth}
        selected={selected}
        onSelect={setSelected}
        today={today}
        counts={counts}
        weekStartsOn={weekStartsOn}
      />
      {selected ? (
        <Stack spacing={1}>
          {ofDay.length > 0 ? (
            <AppointmentList
              title={selectedLabel}
              appointments={ofDay}
              now={now}
              onOpen={(a) => sheets.openDetail(a.id)}
            />
          ) : (
            <Typography color="text.secondary">
              {t('appointments.agenda.noneOnDay', { date: selectedLabel })}
            </Typography>
          )}
          <Box>
            <Button onClick={() => setSelected(null)} sx={{ minHeight: 44 }}>
              {t('appointments.agenda.showAll')}
            </Button>
          </Box>
        </Stack>
      ) : appointments.length === 0 ? (
        <EmptyAgenda writable={sheets.writable} onAdd={() => sheets.openNew()} />
      ) : (
        <Stack spacing={2.5}>
          {upcoming.length > 0 ? (
            <AppointmentList
              title={t('appointments.agenda.upcoming')}
              appointments={upcoming}
              now={now}
              onOpen={(a) => sheets.openDetail(a.id)}
            />
          ) : (
            <Typography color="text.secondary">{t('appointments.agenda.noneUpcoming')}</Typography>
          )}
          {past.length > 0 && (
            <AppointmentList
              title={t('appointments.agenda.past')}
              heading="h3"
              appointments={past}
              now={now}
              onOpen={(a) => sheets.openDetail(a.id)}
            />
          )}
        </Stack>
      )}
      {sheets.elements}
    </Stack>
  );
}
