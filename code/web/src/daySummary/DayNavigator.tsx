import { useTranslation } from 'react-i18next';
import { Box, IconButton, Typography } from '@mui/material';
import { addDays, isSameDay } from '../day/dayModel';
import { formatDate, formatTime } from '../i18n/format';
import { Icon } from '../ui/Icon';
import { palette } from '../ui/form/styles';

const roundButton = (theme: Parameters<typeof palette>[0]) => ({
  width: 48,
  height: 48,
  borderRadius: '50%',
  boxShadow: `inset 0 0 0 1px ${palette(theme).hairline}`,
  flexShrink: 0,
});

/** "Today, up to 15:40", "Yesterday" or the weekday and date. */
function useDayTitle(day: Date, now: Date): string {
  const { t } = useTranslation();
  if (isSameDay(day, now)) return t('daySummary.todayUpTo', { time: formatTime(now) });
  if (isSameDay(day, addDays(now, -1))) return t('daySummary.yesterday');
  return formatDate(day, 'weekdayLong');
}

/**
 * Previous / next day around the shown day's name (48 px round buttons, like the Day screen's
 * week chevrons). Next stops at today, previous at `canGoBack`.
 */
export function DayNavigator({
  day,
  now,
  canGoBack,
  onChange,
}: {
  day: Date;
  now: Date;
  canGoBack: boolean;
  onChange: (step: -1 | 1) => void;
}) {
  const { t } = useTranslation();
  const title = useDayTitle(day, now);
  const isToday = isSameDay(day, now);
  return (
    <Box
      role="group"
      aria-label={t('daySummary.navLabel')}
      sx={{ display: 'flex', alignItems: 'center', gap: 1 }}
    >
      <IconButton
        aria-label={t('daySummary.previous')}
        disabled={!canGoBack}
        onClick={() => onChange(-1)}
        sx={(theme) => roundButton(theme)}
      >
        <Icon name="chevron-left" size={20} />
      </IconButton>
      <Typography
        component="h2"
        aria-live="polite"
        sx={(theme) => ({
          flex: '1 1 auto',
          minWidth: 0,
          textAlign: 'center',
          fontFamily: theme.typography.h5.fontFamily,
          fontSize: '1.125rem',
          lineHeight: 1.25,
          overflowWrap: 'anywhere',
        })}
      >
        {title}
      </Typography>
      <IconButton
        aria-label={t('daySummary.next')}
        disabled={isToday}
        onClick={() => onChange(1)}
        sx={(theme) => roundButton(theme)}
      >
        <Icon name="chevron-right" size={20} />
      </IconButton>
    </Box>
  );
}
