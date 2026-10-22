import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Card, Skeleton, Stack, Typography } from '@mui/material';
import { addDays, dayValue, startOfDay } from '../day/dayModel';
import { useEventsStartedSince, useEventTypes } from '../db/hooks';
import type { Baby } from '../db/models';
import { useNow } from '../events/time';
import { RADIUS } from '../theme/tokens';
import { CategoryIcon } from '../ui/CategoryIcon';
import { SegmentedControl } from '../ui/form';
import { INSIGHTS, relevantEvents, type InsightId } from './catalogue';
import { lastDays } from './days';
import { DiaperCard, FeedingCard, RhythmCard, SleepCard, type CardProps } from './InsightCards';
import { LOOK_BACK_DAYS, readiness, type Readiness } from './readiness';
import { ReadinessRows } from './ReadinessRows';

/*
 * Insights v1 (docs/DESIGN.md "Insights v1"), offline-first from the selected baby's local events:
 * the readiness of every insight in the catalogue, the open ones as cards over a 7 / 14 / 30-day
 * range, the others as progress rows with an estimate. Nothing here talks to the server.
 */

const RANGES = [7, 14, 30] as const;
type RangeDays = (typeof RANGES)[number];
const RANGE_VALUES = RANGES.map(String) as readonly `${RangeDays}`[];

const CARDS: Record<InsightId, (props: CardProps) => ReactNode> = {
  sleep: SleepCard,
  sleepRhythm: RhythmCard,
  feeding: FeedingCard,
  diapers: DiaperCard,
};

function InsightsSkeleton() {
  const { t } = useTranslation();
  return (
    <Box
      role="status"
      aria-busy="true"
      aria-label={t('common.loading')}
      sx={{ display: 'grid', gap: 2 }}
    >
      <Skeleton variant="rounded" height={52} sx={{ borderRadius: `${RADIUS.input + 4}px` }} />
      <Skeleton variant="rounded" height={280} sx={{ borderRadius: `${RADIUS.card}px` }} />
    </Box>
  );
}

/**
 * The calm "more is coming" card. With readiness it lists every insight with its progress and
 * estimate; without a baby it only says what will appear.
 */
export function InsightsComingCard({ items }: { items?: readonly Readiness[] }) {
  const { t } = useTranslation();
  return (
    <Card component="section" aria-labelledby="insights-soon-title" sx={{ p: 2.5 }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
        <CategoryIcon name="seedling" category="care" size={24} />
        <Stack spacing={0.5} sx={{ minWidth: 0 }}>
          <Typography id="insights-soon-title" variant="h6" component="h2">
            {t('insights.soonTitle')}
          </Typography>
          <Typography color="text.secondary">
            {items ? t('insights.readyBody') : t('insights.soonBody')}
          </Typography>
        </Stack>
      </Stack>
      {items && items.length > 0 && (
        <Box sx={{ mt: 1.5 }}>
          <ReadinessRows items={items} />
        </Box>
      )}
    </Card>
  );
}

function OnTheWay({ items }: { items: readonly Readiness[] }) {
  const { t } = useTranslation();
  return (
    <Box component="section" aria-labelledby="insights-on-the-way">
      <Typography
        id="insights-on-the-way"
        variant="overline"
        component="h2"
        color="text.secondary"
        sx={{ display: 'block', mb: 1 }}
      >
        {t('insights.onTheWay')}
      </Typography>
      <Card sx={{ px: 2.5, py: 0.5 }}>
        <ReadinessRows items={items} />
      </Card>
    </Box>
  );
}

/** Insights of `baby`: readiness, the open cards and the ones on their way. */
export function InsightsSection({ baby }: { baby: Baby }) {
  const { t } = useTranslation();
  const clock = useNow(60_000);
  const todayKey = dayValue(new Date(clock));
  // Days with data look back 30 days; one more day catches a night that crossed into the window.
  const from = useMemo(
    () => addDays(startOfDay(new Date(clock)), -LOOK_BACK_DAYS).toISOString(),
    // Recomputed when the day changes, not every minute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todayKey],
  );
  const types = useEventTypes(baby.id);
  const events = useEventsStartedSince(baby.id, from);
  const [range, setRange] = useState<RangeDays>(14);

  if (!types || !events) return <InsightsSkeleton />;

  const now = new Date(clock);
  const states = INSIGHTS.map((insight) =>
    readiness(
      insight,
      relevantEvents(insight, events, types, now).map((event) => event.startedAt),
      now,
    ),
  );
  const open = states.filter((state) => state.state === 'unlocked');
  const waiting = states.filter((state) => state.state !== 'unlocked');
  if (open.length === 0) return <InsightsComingCard items={states} />;

  const props: CardProps = { events, types, days: lastDays(now, range), now, todayKey };
  return (
    <Stack spacing={2}>
      <SegmentedControl<`${RangeDays}`>
        aria-label={t('insights.rangeLabel')}
        value={String(range) as `${RangeDays}`}
        onChange={(value) => value && setRange(Number(value) as RangeDays)}
        options={RANGE_VALUES.map((value) => ({
          value,
          label: t('insights.range', { count: Number(value) }),
        }))}
      />
      {open.map((state) => {
        const View = CARDS[state.id];
        return <View key={state.id} {...props} />;
      })}
      {waiting.length > 0 && <OnTheWay items={waiting} />}
      <Typography variant="caption" color="text.secondary" component="p">
        {t('insights.footnote')}
      </Typography>
    </Stack>
  );
}
