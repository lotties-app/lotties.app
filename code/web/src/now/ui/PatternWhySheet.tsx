import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Typography } from '@mui/material';
import { formatDate, formatList, formatTime } from '../../i18n/format';
import type { TimeOfDayPatternDto } from '../../sync/contract';
import { clockMinutes, type PatternWindow } from '../bellyPattern';
import { SheetFrame } from './SheetFrame';

/** The catalog section of a pattern suggestion (`now.bellyPattern`, `now.fussyPattern`). */
export type PatternTextSection = 'bellyPattern' | 'fussyPattern';

export interface PatternWhySheetProps {
  open: boolean;
  onClose: () => void;
  pattern: TimeOfDayPatternDto;
  window: PatternWindow;
}

/** An `HH:mm` clock in the viewer's locale (`18:05`). */
function clockText(clock: string): string {
  const minutes = clockMinutes(clock) ?? 0;
  return formatTime(new Date(2000, 0, 1, Math.floor(minutes / 60), minutes % 60));
}

/**
 * "Why?" of a recurring pattern suggestion (belly pain, fussiness): the usual window, the rule in
 * plain words, the days and times it comes from (newest first), and that it is a pattern from the
 * log, not medical advice (the only place the pediatrician is mentioned).
 */
export function PatternWhySheet({
  section,
  open,
  onClose,
  pattern,
  window,
}: PatternWhySheetProps & { section: PatternTextSection }) {
  const { t } = useTranslation();
  const daysId = useId();
  const days = [...pattern.days].reverse();
  return (
    <SheetFrame open={open} onClose={onClose} title={t(`now.${section}.whyTitle`)}>
      <Typography>
        {t(`now.${section}.window`, {
          start: formatTime(window.start),
          end: formatTime(window.end),
        })}
      </Typography>
      <Typography>
        {t(`now.${section}.count`, {
          count: pattern.recentDayCount,
          recent: pattern.rule.recentDays,
        })}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t(`now.${section}.rule`, {
          minimum: pattern.rule.minimumRecentDays,
          recent: pattern.rule.recentDays,
          coverage: pattern.rule.minimumCoveragePercent,
          lookBack: pattern.rule.lookBackDays,
        })}
      </Typography>
      <Box component="section" aria-labelledby={daysId}>
        <Typography variant="subtitle2" component="h3" id={daysId}>
          {t(`now.${section}.daysTitle`)}
        </Typography>
        <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
          {days.map((day) => (
            <Typography component="li" variant="body2" key={`${day.date} ${day.times.join()}`}>
              {t(`now.${section}.day`, {
                date: formatDate(day.date, 'weekdayDayMonth'),
                times: formatList(day.times.map(clockText)),
              })}
            </Typography>
          ))}
        </Box>
      </Box>
      <Typography variant="body2" color="text.secondary">
        {t(`now.${section}.disclaimer`)}
      </Typography>
    </SheetFrame>
  );
}
