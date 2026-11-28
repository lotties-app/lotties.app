import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Card, Skeleton, Stack, Typography } from '@mui/material';
import { addDays, dayValue, startOfDay } from '../day/dayModel';
import { useEventsStartedSince, useEventTypes, useOldestEventStart } from '../db/hooks';
import type { Baby } from '../db/models';
import { useNow } from '../events/time';
import { RADIUS } from '../theme/tokens';
import { CategoryIcon } from '../ui/CategoryIcon';
import { DayNavigator } from './DayNavigator';
import {
  CryingDayCard,
  DiaperDayCard,
  FeedingDayCard,
  HealthDayCard,
  SleepDayCard,
} from './DaySummaryCards';
import { daySummary, earliestDay, hasDaySummaryData, queryFrom } from './daySummaryModel';

/*
 * Insights > Day (docs/DESIGN.md "Day summary"): how one local day of the selected baby is going,
 * from the local events only (offline-first, no API), updated once a minute like the Insights
 * cards. The day is kept as "days before today", so at midnight "today" moves on by itself; the
 * parent remounts this view per baby (`key`), which brings it back to today.
 */

/** Whole local calendar days from `from` to `to` (DST days are 23 or 25 hours long). */
const daysBetween = (from: Date, to: Date) =>
  Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000);

function DaySkeleton() {
  const { t } = useTranslation();
  return (
    <Box
      role="status"
      aria-busy="true"
      aria-label={t('daySummary.loading')}
      sx={{ display: 'grid', gap: 2 }}
    >
      <Skeleton variant="rounded" height={48} sx={{ borderRadius: `${RADIUS.input + 4}px` }} />
      <Skeleton variant="rounded" height={160} sx={{ borderRadius: `${RADIUS.card}px` }} />
      <Skeleton variant="rounded" height={160} sx={{ borderRadius: `${RADIUS.card}px` }} />
    </Box>
  );
}

function EmptyDay({ isToday }: { isToday: boolean }) {
  const { t } = useTranslation();
  return (
    <Card component="section" aria-labelledby="day-summary-empty" sx={{ p: 2.5 }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
        <CategoryIcon name="calendar" category="care" size={24} />
        <Stack spacing={0.5} sx={{ minWidth: 0 }}>
          <Typography id="day-summary-empty" variant="h6" component="h3">
            {isToday ? t('daySummary.empty.todayTitle') : t('daySummary.empty.pastTitle')}
          </Typography>
          <Typography color="text.secondary">
            {isToday ? t('daySummary.empty.todayBody') : t('daySummary.empty.pastBody')}
          </Typography>
        </Stack>
      </Stack>
    </Card>
  );
}

export function DaySummaryView({ baby }: { baby: Baby }) {
  const { t } = useTranslation();
  const clock = useNow(60_000);
  const todayKey = dayValue(new Date(clock));
  const from = useMemo(
    () => queryFrom(new Date(clock)),
    // Recomputed when the day changes, not every minute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todayKey],
  );
  const types = useEventTypes(baby.id);
  const events = useEventsStartedSince(baby.id, from);
  const oldest = useOldestEventStart(baby.id);
  const [back, setBack] = useState(0);

  if (!types || !events || oldest === undefined) return <DaySkeleton />;

  const now = new Date(clock);
  const maxBack = daysBetween(earliestDay(now, oldest), now);
  const shownBack = Math.min(back, maxBack);
  const day = addDays(startOfDay(now), -shownBack);
  const summary = daySummary(events, types, day, now);
  const { isToday } = summary;
  const pair = [
    summary.diapers && <DiaperDayCard key="diapers" diapers={summary.diapers} isToday={isToday} />,
    summary.crying && <CryingDayCard key="crying" crying={summary.crying} isToday={isToday} />,
  ].filter(Boolean);

  return (
    <Stack spacing={2}>
      <DayNavigator
        day={day}
        now={now}
        canGoBack={shownBack < maxBack}
        onChange={(step) => setBack(Math.max(0, Math.min(maxBack, shownBack - step)))}
      />
      {!hasDaySummaryData(summary) ? (
        <EmptyDay isToday={isToday} />
      ) : (
        <>
          {summary.sleep && <SleepDayCard sleep={summary.sleep} isToday={isToday} />}
          {summary.feeding && <FeedingDayCard feeding={summary.feeding} isToday={isToday} />}
          {pair.length > 0 && (
            // Side by side, half width each; a lone one takes the whole row.
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: `repeat(${pair.length}, minmax(0, 1fr))`,
                gap: 1.5,
              }}
            >
              {pair}
            </Box>
          )}
          {summary.health && <HealthDayCard health={summary.health} types={types} />}
        </>
      )}
      <Typography variant="caption" color="text.secondary" component="p">
        {t('daySummary.footnote')}
      </Typography>
    </Stack>
  );
}
