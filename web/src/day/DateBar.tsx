import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Box, Button, ButtonBase, IconButton } from '@mui/material';
import { SheetFrame } from '../now/ui/SheetFrame';
import { RADIUS } from '../theme/tokens';
import { Icon } from '../ui/Icon';
import { DateField, Field } from '../ui/form';
import { palette } from '../ui/form/styles';
import { dayValue, isSameDay, parseDayValue, addDays } from './dayModel';
import { useDayLabel } from './useDayLabel';

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
 * Day navigation: previous and next day buttons around the date (tap it to pick any day), a
 * "Today" shortcut when another day is shown, and the filter button with the number of active
 * categories as a badge. Swiping the list changes the day too (see `DayScreen`).
 */
export function DateBar({ day, today, onChange, filterCount, onOpenFilter }: Props) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);
  const label = useDayLabel(day, today);
  const isToday = isSameDay(day, today);

  return (
    <Box sx={{ display: 'grid', gap: 0.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <IconButton
          aria-label={t('day.previous')}
          onClick={() => onChange(addDays(day, -1))}
          sx={(theme) => roundButton(theme)}
        >
          <Icon name="chevron-left" size={20} />
        </IconButton>
        <ButtonBase
          onClick={() => setPicking(true)}
          aria-label={t('day.chooseDate', { date: label })}
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
          <span>{label}</span>
          <Icon name="expand" size={16} />
        </ButtonBase>
        <IconButton
          aria-label={t('day.next')}
          disabled={isToday}
          onClick={() => onChange(addDays(day, 1))}
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
