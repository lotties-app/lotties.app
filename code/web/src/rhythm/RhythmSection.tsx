import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Box, Button, Card, Collapse, Skeleton, Stack, Typography } from '@mui/material';
import { RADIUS } from '../theme/tokens';
import type { ClockMetric, MinutesRange, Rhythm } from './rhythmApi';
import {
  aroundText,
  associationSentences,
  comparisonState,
  countRangeText,
  factorCounts,
  minutesRangeText,
  missingForClock,
  missingForFeeds,
  missingForGap,
  missingForNaps,
  missingForNights,
  missingText,
  ruleLines,
  variesText,
  type RangeText,
} from './rhythmModel';
import { useRhythm } from './useRhythm';

/*
 * Her rhythm (docs/design/48-baby-rhythm.md): the baby's own pattern from the last 28 days of her
 * log, as plain facts the server worked out. Online only, memory cache only. A 403/404 (a Doctor
 * without the daily-log scope, an older server) hides the section; an error or no connection is a
 * muted line, never a broken screen. Nothing judges: no colours, no scores, no advice.
 */

interface MetricValue {
  value: string;
  detail?: string;
  /** Not a value: what is missing, or that nothing can be shown yet. */
  muted?: boolean;
}

function MetricRows({
  rows,
}: {
  rows: readonly { key: string; label: string; metric: MetricValue }[];
}) {
  return (
    <Box component="dl" sx={{ m: 0, display: 'grid', gap: 1.25 }}>
      {rows.map(({ key, label, metric }) => (
        <Box key={key} sx={{ minWidth: 0 }}>
          <Typography component="dt" variant="body2" color="text.secondary">
            {label}
          </Typography>
          <Typography
            component="dd"
            variant={metric.muted ? 'body2' : 'body1'}
            color={metric.muted ? 'text.secondary' : 'text.primary'}
            sx={{ m: 0, fontWeight: metric.muted ? 400 : 500 }}
          >
            {metric.value}
            {metric.detail && (
              <Typography
                component="span"
                variant="body2"
                color="text.secondary"
                sx={{ display: 'block' }}
              >
                {metric.detail}
              </Typography>
            )}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

const fromRange = (range: RangeText): MetricValue => ({ value: range.range, detail: range.median });
const mutedValue = (value: string): MetricValue => ({ value, muted: true });

function clockValue(t: TFunction, metric: ClockMetric, rhythm: Rhythm): MetricValue {
  if (metric.status === 'ok' && metric.usual) return { value: aroundText(t, metric.usual) };
  if (metric.status === 'varies')
    return { value: t('rhythm.varies'), detail: variesText(t, metric) };
  const missing = missingForClock(metric, rhythm.rule);
  return mutedValue(missing ? missingText(t, missing) : t('rhythm.notAvailable'));
}

function nightsValue(t: TFunction, metric: MinutesRange, rhythm: Rhythm): MetricValue {
  const range = minutesRangeText(t, metric);
  if (range) return fromRange(range);
  const missing = missingForNights(metric, rhythm.rule);
  return mutedValue(missing ? missingText(t, missing) : t('rhythm.notAvailable'));
}

function SubCard({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <Card component="section" aria-labelledby={id} sx={{ p: 2.5 }}>
      <Typography id={id} variant="subtitle1" component="h3" sx={{ fontWeight: 600, mb: 1.25 }}>
        {title}
      </Typography>
      {children}
    </Card>
  );
}

function SleepCard({ rhythm, id }: { rhythm: Rhythm; id: string }) {
  const { t } = useTranslation();
  return (
    <SubCard id={id} title={t('rhythm.sleep.title')}>
      <MetricRows
        rows={[
          {
            key: 'bed',
            label: t('rhythm.sleep.bedTime'),
            metric: clockValue(t, rhythm.bedTime, rhythm),
          },
          {
            key: 'wake',
            label: t('rhythm.sleep.wakeUp'),
            metric: clockValue(t, rhythm.wakeUp, rhythm),
          },
          {
            key: 'length',
            label: t('rhythm.sleep.nightLength'),
            metric: nightsValue(t, rhythm.nightLength, rhythm),
          },
          {
            key: 'longest',
            label: t('rhythm.sleep.longestStretch'),
            metric: nightsValue(t, rhythm.longestStretch, rhythm),
          },
          {
            key: 'first',
            label: t('rhythm.sleep.firstStretch'),
            metric: nightsValue(t, rhythm.firstStretch, rhythm),
          },
        ]}
      />
    </SubCard>
  );
}

function NapsCard({ rhythm, id }: { rhythm: Rhythm; id: string }) {
  const { t } = useTranslation();
  const range = countRangeText(t, rhythm.naps);
  const missing = missingForNaps(rhythm.naps, rhythm.rule);
  let perDay: MetricValue;
  if (range) perDay = fromRange(range);
  else if (missing === 'noNaps') perDay = mutedValue(t('rhythm.naps.noNaps'));
  else perDay = mutedValue(missing ? missingText(t, missing) : t('rhythm.notAvailable'));
  const starts = rhythm.naps.usualStarts;
  return (
    <SubCard id={id} title={t('rhythm.naps.title')}>
      <MetricRows rows={[{ key: 'perDay', label: t('rhythm.naps.perDay'), metric: perDay }]} />
      <Typography variant="body2" color="text.secondary" sx={{ mt: 1.25 }}>
        {t('rhythm.naps.usualStarts')}
      </Typography>
      {starts.length > 0 ? (
        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
          {starts.map((start) => (
            <Typography key={start.usual} component="li" sx={{ fontWeight: 500 }}>
              {aroundText(t, start.usual)}
            </Typography>
          ))}
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {t('rhythm.naps.noUsualStarts')}
        </Typography>
      )}
    </SubCard>
  );
}

function FeedsCard({ rhythm, id }: { rhythm: Rhythm; id: string }) {
  const { t } = useTranslation();
  const perDayRange = countRangeText(t, rhythm.feeds);
  const perDayMissing = missingForFeeds(rhythm.feeds, rhythm.rule);
  const gapRange = minutesRangeText(t, rhythm.feeds.gap);
  const gapMissing = missingForGap(rhythm.feeds.gap, rhythm.rule);
  const perDay = perDayRange
    ? fromRange(perDayRange)
    : mutedValue(perDayMissing ? missingText(t, perDayMissing) : t('rhythm.notAvailable'));
  const gap = gapRange
    ? fromRange(gapRange)
    : mutedValue(gapMissing ? missingText(t, gapMissing) : t('rhythm.notAvailable'));
  return (
    <SubCard id={id} title={t('rhythm.feeds.title')}>
      <MetricRows
        rows={[
          { key: 'perDay', label: t('rhythm.feeds.perDay'), metric: perDay },
          { key: 'gap', label: t('rhythm.feeds.gap'), metric: gap },
        ]}
      />
    </SubCard>
  );
}

function LogCard({ rhythm, id }: { rhythm: Rhythm; id: string }) {
  const { t } = useTranslation();
  const state = comparisonState(rhythm);
  let body: ReactNode;
  if (state === 'sentences') {
    body = (
      <Stack component="ul" spacing={1} sx={{ m: 0, pl: 2.5 }}>
        {associationSentences(t, rhythm).map((sentence) => (
          <Typography key={sentence} component="li">
            {sentence}
          </Typography>
        ))}
      </Stack>
    );
  } else if (state === 'noClearDifference') {
    body = <Typography color="text.secondary">{t('rhythm.log.noClearDifference')}</Typography>;
  } else {
    body = (
      <Stack spacing={0.75}>
        <Typography color="text.secondary">{t('rhythm.log.notEnough')}</Typography>
        <Typography variant="body2" color="text.secondary">
          {t('rhythm.log.pendingIntro', { count: rhythm.rule.minimumGroupNights })}
        </Typography>
        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
          {rhythm.associations.map((association) => {
            const raw = factorCounts(association);
            const counts = {
              with: t('rhythm.log.nights', { count: raw.with }),
              without: raw.without,
            };
            const text =
              association.factor === 'evening_feeds'
                ? t('rhythm.log.pending.evening_feeds', counts)
                : t('rhythm.log.pending.dirty_diaper_day', counts);
            return (
              <Typography
                key={association.factor}
                component="li"
                variant="body2"
                color="text.secondary"
              >
                {text}
              </Typography>
            );
          })}
        </Box>
      </Stack>
    );
  }
  return (
    <SubCard id={id} title={t('rhythm.log.title')}>
      {body}
    </SubCard>
  );
}

function HowItWorks({ rhythm }: { rhythm: Rhythm }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const panel = useId();
  return (
    <Box>
      <Typography variant="body2" color="text.secondary">
        {t('rhythm.footer', { count: rhythm.rule.lookBackDays })}
      </Typography>
      <Button
        size="small"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((v) => !v)}
        sx={{ mt: 0.5, minHeight: 44, px: 1, ml: -1 }}
      >
        {t('rhythm.how.title')}
      </Button>
      <Collapse in={open} id={panel}>
        <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
          {ruleLines(t, rhythm.rule).map((line) => (
            <Typography key={line} component="li" variant="body2" color="text.secondary">
              {line}
            </Typography>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}

function RhythmBody({ rhythm }: { rhythm: Rhythm }) {
  const ids = useId();
  return (
    <Stack spacing={2}>
      <SleepCard rhythm={rhythm} id={`${ids}-sleep`} />
      <NapsCard rhythm={rhythm} id={`${ids}-naps`} />
      <FeedsCard rhythm={rhythm} id={`${ids}-feeds`} />
      <LogCard rhythm={rhythm} id={`${ids}-log`} />
      <HowItWorks rhythm={rhythm} />
    </Stack>
  );
}

/** The "Her rhythm" section of Insights for `babyId`. */
export function RhythmSection({ babyId, babyName }: { babyId: string; babyName: string }) {
  const { t } = useTranslation();
  const titleId = useId();
  const { query, online } = useRhythm(babyId);
  const rhythm = query.data;

  // 403/404 or an older server: no section at all.
  if (rhythm === null) return null;

  let body: ReactNode;
  if (rhythm) {
    body = <RhythmBody rhythm={rhythm} />;
  } else if (query.isError) {
    body = (
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Typography variant="body2" color="text.secondary">
          {t('rhythm.error')}
        </Typography>
        <Button size="small" onClick={() => void query.refetch()} sx={{ minHeight: 44 }}>
          {t('common.reload')}
        </Button>
      </Stack>
    );
  } else if (!online) {
    body = (
      <Typography variant="body2" color="text.secondary">
        {t('rhythm.offline')}
      </Typography>
    );
  } else {
    body = (
      <Box
        role="status"
        aria-busy="true"
        aria-label={t('common.loading')}
        sx={{ display: 'grid', gap: 2 }}
      >
        <Skeleton variant="rounded" height={220} sx={{ borderRadius: `${RADIUS.card}px` }} />
        <Skeleton variant="rounded" height={120} sx={{ borderRadius: `${RADIUS.card}px` }} />
      </Box>
    );
  }

  return (
    <Box component="section" aria-labelledby={titleId}>
      <Typography id={titleId} variant="h6" component="h2">
        {t('rhythm.title', { name: babyName })}
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
        {t('rhythm.intro', { name: babyName })}
      </Typography>
      {!online && rhythm && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {t('rhythm.offlineLast')}
        </Typography>
      )}
      {body}
    </Box>
  );
}
