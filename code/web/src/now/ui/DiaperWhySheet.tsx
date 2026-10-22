import { useTranslation } from 'react-i18next';
import { Typography } from '@mui/material';
import type { DiaperGapDto, PredictionConfidence } from '../../sync/contract';
import { formatDate, formatDuration, formatNumber, formatTime } from '../../i18n/format';
import { localDateKey } from '../bellyPattern';
import type { DiaperSuggestion } from '../diaperPredictions';
import { MINUTE_MS } from '../eventFacts';
import { SheetFrame } from './SheetFrame';

interface Props {
  open: boolean;
  onClose: () => void;
  suggestion: DiaperSuggestion;
  now: Date;
}

function Confidence({ level }: { level: PredictionConfidence }) {
  const { t } = useTranslation();
  return (
    <Typography variant="body2" color="text.secondary">
      {t('now.diaper.confidence', { level: t(`now.diaper.confidenceLevel.${level}`) })}
    </Typography>
  );
}

/** The window, the latest diaper of the kind and the typical gap of a gap estimate. */
function GapLines({
  suggestion,
  gap,
  now,
}: {
  suggestion: DiaperSuggestion;
  gap: DiaperGapDto;
  now: Date;
}) {
  const { t } = useTranslation();
  const { kind, window, diaper } = suggestion;
  const sameDay = localDateKey(window.anchor) === localDateKey(now);
  const when = sameDay
    ? formatTime(window.anchor)
    : t('now.diaper.dayTime', {
        date: formatDate(window.anchor, 'weekdayDayMonth'),
        time: formatTime(window.anchor),
      });
  return (
    <>
      <Typography>
        {t(`now.diaper.${kind}Expected`, {
          time: formatTime(window.expected),
          start: formatTime(window.earliest),
          end: formatTime(window.latest),
        })}
      </Typography>
      <Typography>{t(`now.diaper.${kind}Last`, { when })}</Typography>
      <Typography>
        {t(`now.diaper.${kind}Gap`, {
          duration: formatDuration(gap.medianGapMinutes * MINUTE_MS),
          count: gap.eventCount,
          days: kind === 'wet' ? diaper.rule.wetLookBackDays : diaper.rule.dirtyLookBackDays,
        })}
      </Typography>
    </>
  );
}

/** The latest feed, the window after it and the usual lag. */
function AfterFeedLines({ suggestion }: { suggestion: DiaperSuggestion }) {
  const { t } = useTranslation();
  const { window, diaper } = suggestion;
  const lag = diaper.dirty?.afterFeed;
  if (!lag) return null;
  return (
    <>
      <Typography>
        {t('now.diaper.afterFeedExpected', {
          time: formatTime(window.anchor),
          start: formatTime(window.earliest),
          end: formatTime(window.latest),
        })}
      </Typography>
      <Typography>
        {t('now.diaper.afterFeedLag', {
          median: lag.medianLagMinutes,
          lower: lag.lowerLagMinutes,
          upper: lag.upperLagMinutes,
          count: lag.pairCount,
          hours: Math.round(diaper.rule.feedWindowMinutes / 60),
        })}
      </Typography>
    </>
  );
}

/** The rule of the card's kind in plain words. */
function RuleLine({ suggestion }: { suggestion: DiaperSuggestion }) {
  const { t } = useTranslation();
  const { rule } = suggestion.diaper;
  const wet = suggestion.kind === 'wet';
  return (
    <Typography variant="body2" color="text.secondary">
      {t(wet ? 'now.diaper.wetRule' : 'now.diaper.dirtyRule', {
        minimum: wet ? rule.minimumWetEvents : rule.minimumDirtyEvents,
        days: wet ? rule.wetLookBackDays : rule.dirtyLookBackDays,
        lower: rule.lowerPercentile,
        upper: rule.upperPercentile,
        pairs: rule.minimumFeedPairs,
        hours: Math.round(rule.feedWindowMinutes / 60),
        spread: rule.maximumLagSpreadMinutes,
        lead: rule.leadMinutes,
        grace: rule.graceMinutes,
      })}
    </Typography>
  );
}

/**
 * "Why?" of a diaper card: when the diaper is expected and from what (the gaps between diapers of
 * the kind, or the usual lag after feeds), the rule in plain words, the confidence, a gentle note
 * when wet diapers dropped sharply (the only mention of the pediatrician) and "This is a pattern
 * from what you logged, not medical advice."
 */
export function DiaperWhySheet({ open, onClose, suggestion, now }: Props) {
  const { t } = useTranslation();
  const { diaper, kind, signal } = suggestion;
  const gap = kind === 'wet' ? diaper.wet : diaper.dirty?.gap;
  const confidence = signal === 'afterFeed' ? diaper.dirty?.afterFeed?.confidence : gap?.confidence;
  const trend = kind === 'wet' ? diaper.wet?.trend : null;
  return (
    <SheetFrame open={open} onClose={onClose} title={t('now.diaper.whyTitle')}>
      {signal === 'afterFeed' ? (
        <AfterFeedLines suggestion={suggestion} />
      ) : (
        gap && <GapLines suggestion={suggestion} gap={gap} now={now} />
      )}
      <RuleLine suggestion={suggestion} />
      {confidence && <Confidence level={confidence} />}
      {trend?.droppedSharply && (
        <Typography>
          {t('now.diaper.wetDrop', {
            recent: trend.last24Hours,
            usual: formatNumber(trend.usualPer24Hours, { maximumFractionDigits: 1 }),
          })}
        </Typography>
      )}
      <Typography variant="body2" color="text.secondary">
        {t('now.diaper.disclaimer')}
      </Typography>
    </SheetFrame>
  );
}
