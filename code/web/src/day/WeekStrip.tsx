import { useTranslation } from 'react-i18next';
import { Box, ButtonBase, Typography } from '@mui/material';
import { formatDate } from '../i18n/format';
import { currentLocale } from '../i18n/i18n';
import { RADIUS } from '../theme/tokens';
import { palette } from '../ui/form/styles';
import { isSameDay, startOfDay } from './dayModel';
import { useSwipe } from './useSwipe';
import { firstWeekday, jumpWeek, weekDays } from './weekModel';

/** How a day reads in the strip: the initial, the number and the full spoken name. */
function dayTexts(day: Date) {
  return {
    longLabel: formatDate(day, 'weekdayLong'),
    initial: formatDate(day, 'weekdayNarrow'),
    dayNumber: formatDate(day, 'dayNumber'),
  };
}

interface Props {
  day: Date;
  today: Date;
  onChange: (day: Date) => void;
}

/**
 * Seven days with the weekday initial and the date: today is outlined, the selected day filled.
 * A day after today cannot be chosen (nothing to look at). Swiping the strip moves a week;
 * the chevrons of the header do the same for pointer and keyboard users.
 */
export function WeekStrip({ day, today, onChange }: Props) {
  const { t } = useTranslation();
  const days = weekDays(day, firstWeekday(currentLocale()));
  const swipe = useSwipe(
    () => onChange(jumpWeek(day, 1, today)),
    () => onChange(jumpWeek(day, -1, today)),
  );
  const todayStart = startOfDay(today).getTime();

  return (
    <Box
      role="group"
      aria-label={t('day.week')}
      // The strip's own swipe is a week; it must not also count as a day swipe of the screen.
      onTouchStart={(event) => {
        event.stopPropagation();
        swipe.onTouchStart(event);
      }}
      onTouchEnd={(event) => {
        event.stopPropagation();
        swipe.onTouchEnd(event);
      }}
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
        gap: 0.5,
        touchAction: 'pan-y pinch-zoom',
      }}
    >
      {days.map((candidate) => {
        const { longLabel, initial, dayNumber } = dayTexts(candidate);
        const selected = isSameDay(candidate, day);
        const isToday = isSameDay(candidate, today);
        const future = candidate.getTime() > todayStart;
        return (
          <ButtonBase
            key={candidate.getTime()}
            disabled={future}
            aria-pressed={selected}
            aria-current={isToday ? 'date' : undefined}
            aria-label={longLabel}
            onClick={() => onChange(candidate)}
            data-selected={selected ? 'true' : undefined}
            data-today={isToday ? 'true' : undefined}
            sx={(theme) => ({
              flexDirection: 'column',
              gap: 0.25,
              minHeight: 64,
              minWidth: 0,
              py: 0.75,
              borderRadius: `${RADIUS.pill}px`,
              backgroundColor: selected ? palette(theme).primary.main : 'transparent',
              color: selected ? palette(theme).primary.contrastText : palette(theme).text.primary,
              boxShadow:
                isToday && !selected ? `inset 0 0 0 1.5px ${palette(theme).primary.main}` : 'none',
              '&.Mui-disabled': { opacity: 0.4 },
              '@media (forced-colors: active)': {
                border: selected ? '2px solid Highlight' : '1px solid',
              },
            })}
          >
            <Typography
              component="span"
              variant="caption"
              sx={{ color: 'inherit', opacity: selected ? 0.9 : 0.75, textTransform: 'uppercase' }}
            >
              {initial}
            </Typography>
            <Typography
              component="span"
              sx={{
                color: 'inherit',
                fontFamily: (theme) => theme.typography.h5.fontFamily,
                fontSize: '1.125rem',
                fontWeight: selected || isToday ? 700 : 500,
                fontVariantNumeric: 'lining-nums tabular-nums',
                lineHeight: 1.2,
              }}
            >
              {dayNumber}
            </Typography>
          </ButtonBase>
        );
      })}
    </Box>
  );
}
