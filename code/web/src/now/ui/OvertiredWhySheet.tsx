import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Typography } from '@mui/material';
import { formatDate, formatDuration, formatTime } from '../../i18n/format';
import { MINUTE_MS } from '../eventFacts';
import { clockMinutes } from '../bellyPattern';
import type { OvertiredSuggestion } from '../overtired';
import { SheetFrame } from './SheetFrame';

interface Props {
  open: boolean;
  onClose: () => void;
  suggestion: OvertiredSuggestion;
}

/** An `HH:mm` clock of the rule in the viewer's locale (`05:00`). */
function clockText(clock: string): string {
  const minutes = clockMinutes(clock) ?? 0;
  return formatTime(new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60));
}

/**
 * "Why?" of the overtired heads-up: how long the baby has been awake, the usual longest
 * comfortable stretch, the percentile rule in plain words, the stretches it comes from (newest
 * first), and that it is a pattern from the log, not medical advice (the only place the
 * pediatrician is mentioned).
 */
export function OvertiredWhySheet({ open, onClose, suggestion }: Props) {
  const { t } = useTranslation();
  const stretchesId = useId();
  const { wakeWindow: wake } = suggestion;
  const stretches = [...wake.stretches].reverse();
  return (
    <SheetFrame open={open} onClose={onClose} title={t('now.overtired.whyTitle')}>
      <Typography>
        {t('now.overtired.awake', {
          time: formatTime(suggestion.since),
          duration: formatDuration(suggestion.awakeMinutes * MINUTE_MS),
        })}
      </Typography>
      <Typography>
        {t('now.overtired.limit', { duration: formatDuration(wake.limitMinutes * MINUTE_MS) })}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('now.overtired.rule', {
          percentile: wake.rule.percentile,
          count: wake.sampleCount,
          dayStart: clockText(wake.rule.dayStartsAt),
          dayEnd: clockText(wake.rule.dayEndsAt),
          lookBack: wake.rule.lookBackDays,
          minimum: wake.rule.minimumStretches,
          lead: wake.rule.leadMinutes,
          grace: wake.rule.graceMinutes,
        })}
      </Typography>
      <Box component="section" aria-labelledby={stretchesId}>
        <Typography variant="subtitle2" component="h3" id={stretchesId}>
          {t('now.overtired.stretchesTitle')}
        </Typography>
        <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
          {stretches.map((stretch) => (
            <Typography component="li" variant="body2" key={stretch.start}>
              {t('now.overtired.stretch', {
                date: formatDate(stretch.start, 'weekdayDayMonth'),
                start: formatTime(stretch.start),
                end: formatTime(stretch.end),
                duration: formatDuration(stretch.minutes * MINUTE_MS),
              })}
            </Typography>
          ))}
        </Box>
      </Box>
      <Typography variant="body2" color="text.secondary">
        {t('now.overtired.disclaimer')}
      </Typography>
    </SheetFrame>
  );
}
