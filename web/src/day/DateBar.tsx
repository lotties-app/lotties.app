import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Box, Button, ButtonBase, IconButton } from '@mui/material';
import { formatDate } from '../i18n/format';
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

/**
 * Day navigation: the month (tap it to pick any day) between the week-jump chevrons, the filter
 * button with the number of active categories as a badge, a "Today" shortcut when another day is
 * shown, and the week strip. Swiping the list changes the day, swiping the strip the week (see
 * `DayScreen` and `WeekStrip`).
 */
export function DateBar({ day, today, onChange, filterCount, onOpenFilter }: Props) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);
  const label = useDayLabel(day, today);
  const isToday = isSameDay(day, today);
  const month = formatDate(day, 'monthYear');
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
            flex: '1 1 auto',
            minWidth: 0,
            minHeight: 44,
            px: 1,
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
          <span>{month}</span>
          <Icon name="expand" size={16} />
        </ButtonBase>
        <IconButton
          aria-label={t('day.nextWeek')}
          disabled={atLatestWeek}
          onClick={() => onChange(jumpWeek(day, 1, today))}
          sx={(theme) => roundButton(theme)}
        >
          <Icon name="chevron-right" size={20} />
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
