import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, Skeleton, Stack, Typography } from '@mui/material';
import { DateBar } from '../day/DateBar';
import { DayFilterSheet } from '../day/DayFilterSheet';
import { DayRibbon } from '../day/DayRibbon';
import { DayRow, SessionSeparatorRow } from '../day/DayRow';
import { DaySummary } from '../day/DaySummary';
import {
  addDays,
  categoriesOf,
  dayBounds,
  dayValue,
  eventsOfDay,
  filterByCategory,
  isSameDay,
  parseDayValue,
  startOfDay,
  summarizeDay,
  withSessionSeparators,
} from '../day/dayModel';
import { ribbonLabel } from '../day/ribbonLabel';
import { ribbonModel } from '../day/ribbonModel';
import { useDayLabel } from '../day/useDayLabel';
import { useSwipe } from '../day/useSwipe';
import { useAllPrescriptions, useMedications } from '../db/hooks';
import type { BabyEvent, EventType } from '../db/models';
import { useNow } from '../events/time';
import { ErrorBoundary } from '../layout/ErrorBoundary';
import type { CategoryName } from '../theme/tokens';
import { usePatientBaby } from './DoctorDashboardContext';
import { WhenShared } from './PatientRoute';
import { usePatientEventTypes, useTimelineDay } from './useDoctorData';

function TimelineSkeleton() {
  const { t } = useTranslation();
  return (
    <Stack spacing={1.5} role="status" aria-busy="true" aria-label={t('common.loading')}>
      <Skeleton variant="rounded" height={72} />
      {[0, 1, 2].map((index) => (
        <Skeleton key={index} variant="rounded" height={64} />
      ))}
    </Stack>
  );
}

function Timeline() {
  const { t } = useTranslation();
  const baby = usePatientBaby();
  const clock = useNow(60_000);
  const today = useMemo(() => startOfDay(new Date(clock)), [clock]);
  const [params, setParams] = useSearchParams();
  const requested = parseDayValue(params.get('day') ?? '');
  const day = requested && requested <= today ? requested : today;
  const bounds = useMemo(() => dayBounds(day), [day]);
  const [selected, setSelected] = useState<ReadonlySet<CategoryName>>(() => new Set());
  const [filtering, setFiltering] = useState(false);
  const typesQuery = usePatientEventTypes(baby);
  const eventsQuery = useTimelineDay(baby, day);
  const medications = useMedications(baby.id) ?? [];
  const prescriptions = useAllPrescriptions(baby.id);
  const label = useDayLabel(day, today);

  const go = (next: Date) =>
    setParams(isSameDay(next, today) ? {} : { day: dayValue(next) }, { replace: true });
  const swipe = useSwipe(
    () => {
      if (!isSameDay(day, today)) go(addDays(day, 1));
    },
    () => go(addDays(day, -1)),
  );

  const header = (
    <>
      <Typography variant="h4" component="h1">
        {t('doctorDashboard.sections.timeline')}
      </Typography>
      <Typography color="text.secondary">{t('doctorDashboard.timeline.readOnly')}</Typography>
      <DateBar
        day={day}
        today={today}
        onChange={go}
        filterCount={selected.size}
        onOpenFilter={() => setFiltering(true)}
        showAppointments={false}
      />
    </>
  );

  const types = typesQuery.data;
  const events = eventsQuery.data;
  if (eventsQuery.isError || typesQuery.isError) {
    return (
      <Stack spacing={2}>
        {header}
        <Alert
          severity="warning"
          action={
            <Button
              color="inherit"
              size="small"
              onClick={() => {
                void typesQuery.refetch();
                void eventsQuery.refetch();
              }}
            >
              {t('doctorDashboard.patients.retry')}
            </Button>
          }
        >
          {t('doctorDashboard.timeline.loadFailed')}
        </Alert>
      </Stack>
    );
  }
  if (!types || !events) {
    const offline = eventsQuery.fetchStatus === 'idle' && !events;
    return (
      <Stack spacing={2}>
        {header}
        {offline ? (
          <Alert severity="info">{t('doctorDashboard.timeline.offline')}</Alert>
        ) : (
          <TimelineSkeleton />
        )}
      </Stack>
    );
  }

  const now = new Date(clock);
  const summary = summarizeDay(events, types, bounds, now);
  const ribbon = ribbonModel(events, types, bounds, now);
  const isToday = isSameDay(day, today);
  const dayLength = bounds.end.getTime() - bounds.start.getTime();
  const nowAt = Math.min(1, Math.max(0, (clock - bounds.start.getTime()) / dayLength));
  const dayEvents = eventsOfDay(events, bounds);
  const rows = filterByCategory(dayEvents, types, selected);
  const items = withSessionSeparators(rows, types);
  const categories = categoriesOf(types);
  const typeOf = (event: BabyEvent): EventType | undefined =>
    types.find((candidate) => candidate.id === event.typeId);

  return (
    <Box
      {...swipe}
      sx={{ display: 'grid', gap: 2, touchAction: 'pan-y pinch-zoom', alignContent: 'start' }}
    >
      <Stack spacing={0.5}>{header}</Stack>
      <DaySummary summary={summary}>
        <DayRibbon
          model={ribbon}
          label={ribbonLabel(summary, t)}
          types={types}
          medications={medications}
          {...(prescriptions ? { prescriptions } : {})}
          categories={categories}
          selected={selected}
          onSelectedChange={setSelected}
          now={now}
          isToday={isToday}
          nowAt={nowAt}
          listedIds={new Set(rows.map((row) => row.id))}
          onShowInList={() => {}}
        />
      </DaySummary>
      {dayEvents.length === 0 && (
        <Typography color="text.secondary" sx={{ textAlign: 'center', py: 3 }}>
          {t('doctorDashboard.timeline.empty')}
        </Typography>
      )}
      {dayEvents.length > 0 && rows.length === 0 && (
        <Box sx={{ display: 'grid', justifyItems: 'center', gap: 1, py: 3 }}>
          <Typography color="text.secondary">{t('day.noMatches')}</Typography>
          <Button onClick={() => setSelected(new Set())} sx={{ minHeight: 44 }}>
            {t('day.clear')}
          </Button>
        </Box>
      )}
      {rows.length > 0 && (
        <Box component="ul" aria-label={label} sx={{ m: 0, p: 0 }}>
          {items.map((item, index) =>
            item.kind === 'separator' ? (
              <SessionSeparatorRow
                key={`sep-${item.id}`}
                endedAt={item.endedAt}
                durationMs={item.durationMs}
              />
            ) : (
              <ErrorBoundary key={item.event.id}>
                <DayRow
                  event={item.event}
                  type={typeOf(item.event)}
                  medications={medications}
                  {...(prescriptions ? { prescriptions } : {})}
                  syncState={undefined}
                  hasNext={index < items.length - 1}
                  onEdit={() => {}}
                  readOnly
                />
              </ErrorBoundary>
            ),
          )}
        </Box>
      )}
      <DayFilterSheet
        open={filtering}
        onClose={() => setFiltering(false)}
        categories={categories}
        selected={selected}
        onChange={setSelected}
      />
    </Box>
  );
}

/**
 * `/doctor/:babyId/timeline` (docs/design/19-doctor-dashboard.md section 5.3): the family's entries
 * of one day, read-only, fetched for that day from the server (`?day=yyyy-mm-dd`, bookmarkable).
 * The Day screen's date bar, summary strip, ribbon, filter and rows, without logging controls.
 */
export function PatientTimeline() {
  const { t } = useTranslation();
  const baby = usePatientBaby();
  return (
    <WhenShared baby={baby} scope="daily_log" title={t('doctorDashboard.sections.timeline')}>
      <Timeline key={baby.id} />
    </WhenShared>
  );
}
