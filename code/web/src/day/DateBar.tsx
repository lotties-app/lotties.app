import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { Badge, Box, Button, ButtonBase, IconButton } from '@mui/material';
import { formatDate } from '../i18n/format';
import { currentLocale } from '../i18n/i18n';
import { SheetFrame } from '../now/ui/SheetFrame';
import { RADIUS } from '../theme/tokens';
import { Icon } from '../ui/Icon';
import { DateField, Field } from '../ui/form';
import { palette } from '../ui/form/styles';
import { dayValue, isSameDay, parseDayValue } from './dayModel';
import { useDayLabel } from './useDayLabel';
import { WeekStrip } from './WeekStrip';
import { jumpWeek } from './weekModel';

interface Props {
  day: Date;
  today: Date;
  onChange: (day: Date) => void;
  /** Categories selected in the filter. */
  filterCount: number;
  onOpenFilter: () => void;
}

const roundButton = (theme: Parameters<typeof palette>[0]) => ({
  width: 44,
  height: 44,
  borderRadius: '50%',
  boxShadow: `inset 0 0 0 1px ${palette(theme).hairline}`,
  flexShrink: 0,
});

/** "Oct 2026" / "out. 2026": the abbreviated month and the year, for a narrow header. */
function shortMonthYear(day: Date): string {
  const parts = new Intl.DateTimeFormat(currentLocale(), { month: 'short', year: 'numeric' })
    .formatToParts(day)
    .filter((part) => part.type === 'month' || part.type === 'year')
    .map((part) => part.value);
  return parts.join(' ');
}

/**
 * The month label keeps one line: the full month ("October 2026") while the button is wide, the
 * abbreviated one ("Oct 2026") when it is narrow, and without the chevron when it is narrower still
 * (large text on a small phone). Measured in `em`, so a larger text size switches earlier.
 */
const MONTH_LABEL = {
  '& .month-short': { display: 'none' },
  '@container (max-width: 11em)': {
    '& .month-long': { display: 'none' },
    '& .month-short': { display: 'inline-block' },
  },
  '@container (max-width: 6.75em)': {
    '& .month-expand': { display: 'none' },
  },
} as const;

/**
 * Day navigation: the month (tap it to pick any day) between the week-jump chevrons, the
 * appointments calendar button, the filter button with the number of active categories as a
 * badge, a "Today" shortcut when another day is shown, and the week strip. Swiping the list
 * changes the day, swiping the strip the week (see `DayScreen` and `WeekStrip`).
 */
export function DateBar({ day, today, onChange, filterCount, onOpenFilter }: Props) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);
  const label = useDayLabel(day, today);
  const isToday = isSameDay(day, today);
  const month = formatDate(day, 'monthYear');
  const shortMonth = shortMonthYear(day);
  const atLatestWeek = isSameDay(jumpWeek(day, 1, today), day);

  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <IconButton
          aria-label={t('day.previousWeek')}
          onClick={() => onChange(jumpWeek(day, -1, today))}
          sx={(theme) => roundButton(theme)}
        >
          <Icon name="chevron-left" size={20} />
        </IconButton>
        <ButtonBase
          onClick={() => setPicking(true)}
          aria-label={t('day.chooseMonth', { month, date: label })}
          aria-haspopup="dialog"
          sx={{
            ...MONTH_LABEL,
            containerType: 'inline-size',
            flex: '1 1 auto',
            minWidth: 0,
            minHeight: 44,
            px: 0.5,
            borderRadius: `${RADIUS.input}px`,
            justifyContent: 'center',
            gap: 0.75,
            font: 'inherit',
            fontFamily: (theme) => theme.typography.h5.fontFamily,
            fontSize: '1.125rem',
            lineHeight: 1.2,
            textAlign: 'center',
          }}
        >
          <Box component="span" className="month-long" sx={oneLine}>
            {month}
          </Box>
          <Box component="span" className="month-short" sx={oneLine}>
            {shortMonth}
          </Box>
          <Box component="span" className="month-expand" sx={{ display: 'inline-flex' }}>
            <Icon name="expand" size={16} />
          </Box>
        </ButtonBase>
        <IconButton
          aria-label={t('day.nextWeek')}
          disabled={atLatestWeek}
          onClick={() => onChange(jumpWeek(day, 1, today))}
          sx={(theme) => roundButton(theme)}
        >
          <Icon name="chevron-right" size={20} />
        </IconButton>
        <IconButton
          component={RouterLink}
          to="/appointments"
          aria-label={t('appointments.open')}
          sx={(theme) => ({ ...roundButton(theme), borderRadius: `${RADIUS.input}px` })}
        >
          <Icon name="calendar" size={20} />
        </IconButton>
        <Badge
          badgeContent={filterCount}
          color="primary"
          invisible={filterCount === 0}
          overlap="circular"
        >
          <IconButton
            aria-label={
              filterCount > 0 ? t('day.filterActive', { count: filterCount }) : t('day.filter')
            }
            aria-haspopup="dialog"
            onClick={onOpenFilter}
            sx={(theme) => ({ ...roundButton(theme), borderRadius: `${RADIUS.input}px` })}
          >
            <Icon name="filter" size={20} />
          </IconButton>
        </Badge>
      </Box>
      <WeekStrip day={day} today={today} onChange={onChange} />
      {!isToday && (
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <Button
            onClick={() => onChange(today)}
            startIcon={<Icon name="calendar" size={16} />}
            sx={{ minHeight: 44 }}
          >
            {t('timeline.today')}
          </Button>
        </Box>
      )}
      <SheetFrame open={picking} onClose={() => setPicking(false)} title={t('day.pickTitle')}>
        <Field label={t('day.pickLabel')}>
          <DateField
            value={dayValue(day)}
            max={dayValue(today)}
            onChange={(value) => {
              const next = parseDayValue(value);
              if (!next) return;
              onChange(next);
              setPicking(false);
            }}
          />
        </Field>
      </SheetFrame>
    </Box>
  );
}

/** Never wraps; ellipsis only as the last resort. */
const oneLine = {
  display: 'inline-block',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  minWidth: 0,
} as const;
