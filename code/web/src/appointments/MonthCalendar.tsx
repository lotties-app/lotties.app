import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Box, Button, IconButton, Typography } from '@mui/material';
import { formatDate } from '../i18n/format';
import { currentLocale } from '../i18n/i18n';
import { Icon } from '../ui/Icon';
import { focusRing, palette } from '../ui/form/styles';
import {
  addDays,
  monthGrid,
  monthOfKey,
  sameMonth,
  shiftMonth,
  weekdayOf,
  type DayKey,
  type MonthRef,
} from './calendarModel';

export interface MonthCalendarProps {
  month: MonthRef;
  onMonthChange: (month: MonthRef) => void;
  /** The day the agenda is filtered to, or none. */
  selected: DayKey | null;
  /** A day was chosen; choosing the selected day again clears the filter (`null`). */
  onSelect: (day: DayKey | null) => void;
  today: DayKey;
  /** Appointments per day (cancelled ones left out): up to three dots. */
  counts: ReadonlyMap<DayKey, number>;
  /** 0 = Sunday, 1 = Monday. */
  weekStartsOn: number;
}

/** 2023-01-01 was a Sunday: weekday `d` of a week is that date plus `d` days. */
const weekdayDate = (weekday: number) => new Date(Date.UTC(2023, 0, 1 + weekday));
const MAX_DOTS = 3;

function weekdayNames(weekStartsOn: number) {
  const locale = currentLocale();
  const narrow = new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: 'UTC' });
  const long = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, index) => {
    const date = weekdayDate((weekStartsOn + index) % 7);
    return { narrow: narrow.format(date), long: long.format(date) };
  });
}

/** Where the keyboard focus sits in the grid: the selected day, today, or the 1st of the month. */
function anchorDay(month: MonthRef, selected: DayKey | null, today: DayKey): DayKey {
  if (selected && sameMonth(monthOfKey(selected), month)) return selected;
  if (sameMonth(monthOfKey(today), month)) return today;
  return `${month.year}-${String(month.month).padStart(2, '0')}-01`;
}

/** The day a navigation key moves to, or `null` for other keys. */
function targetOf(key: string, from: DayKey, weekStartsOn: number): DayKey | null {
  const column = (weekdayOf(from) - weekStartsOn + 7) % 7;
  switch (key) {
    case 'ArrowLeft':
      return addDays(from, -1);
    case 'ArrowRight':
      return addDays(from, 1);
    case 'ArrowUp':
      return addDays(from, -7);
    case 'ArrowDown':
      return addDays(from, 7);
    case 'Home':
      return addDays(from, -column);
    case 'End':
      return addDays(from, 6 - column);
    case 'PageUp':
    case 'PageDown': {
      const { year, month } = shiftMonth(monthOfKey(from), key === 'PageUp' ? -1 : 1);
      const day = Math.min(Number(from.slice(8)), 28);
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
    default:
      return null;
  }
}

/**
 * The month calendar of the appointments page: a grid (table with labelled cells) of the month's
 * days in the device's local time, the week starting as the locale does, today ringed, up to three
 * dots on days with appointments and the chosen day filled. Arrow keys, Home/End and Page Up/Down
 * move between days (crossing into the next or previous month), Enter or Space chooses one.
 */
export function MonthCalendar({
  month,
  onMonthChange,
  selected,
  onSelect,
  today,
  counts,
  weekStartsOn,
}: MonthCalendarProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const weekdays = weekdayNames(weekStartsOn);
  const [focusDay, setFocusDay] = useState<DayKey>(() => anchorDay(month, selected, today));
  const moved = useRef(false);
  const cells = useRef(new Map<DayKey, HTMLButtonElement>());
  const weeks = monthGrid(month, weekStartsOn);
  const tabDay = sameMonth(monthOfKey(focusDay), month)
    ? focusDay
    : anchorDay(month, selected, today);

  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    cells.current.get(focusDay)?.focus();
  }, [focusDay, month]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, day: DayKey) => {
    const target = targetOf(event.key, day, weekStartsOn);
    if (!target) return;
    event.preventDefault();
    setFocusDay(target);
    const targetMonth = monthOfKey(target);
    if (sameMonth(targetMonth, month)) {
      cells.current.get(target)?.focus();
      return;
    }
    // The cell of another month exists only after the month changed: focus it then.
    moved.current = true;
    onMonthChange(targetMonth);
  };

  const go = (delta: number) => {
    const next = shiftMonth(month, delta);
    onMonthChange(next);
    setFocusDay(anchorDay(next, selected, today));
  };
  const monthTitle = formatDate(
    `${month.year}-${String(month.month).padStart(2, '0')}-01`,
    'monthYear',
  );
  const onCurrentMonth = sameMonth(month, monthOfKey(today));

  return (
    <Box component="section" aria-labelledby={titleId} sx={{ display: 'grid', gap: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <IconButton aria-label={t('appointments.calendar.previousMonth')} onClick={() => go(-1)}>
          <Icon name="chevron-left" size={20} />
        </IconButton>
        <Typography
          id={titleId}
          variant="h6"
          component="h2"
          aria-live="polite"
          sx={{ flex: 1, textAlign: 'center' }}
        >
          {monthTitle}
        </Typography>
        <IconButton aria-label={t('appointments.calendar.nextMonth')} onClick={() => go(1)}>
          <Icon name="chevron-right" size={20} />
        </IconButton>
      </Box>
      {!onCurrentMonth && (
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <Button
            onClick={() => {
              onMonthChange(monthOfKey(today));
              setFocusDay(today);
            }}
            startIcon={<Icon name="calendar" size={16} />}
            sx={{ minHeight: 44 }}
          >
            {t('appointments.calendar.today')}
          </Button>
        </Box>
      )}
      <Box
        component="table"
        role="grid"
        aria-labelledby={titleId}
        sx={{ width: '100%', tableLayout: 'fixed', borderCollapse: 'collapse' }}
      >
        <thead>
          <tr>
            {weekdays.map((weekday) => (
              <Box
                component="th"
                scope="col"
                key={weekday.long}
                abbr={weekday.long}
                sx={(theme) => ({
                  pb: 0.5,
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  color: palette(theme).text.secondary,
                })}
              >
                <span aria-hidden>{weekday.narrow}</span>
                <Box component="span" sx={visuallyHidden}>
                  {weekday.long}
                </Box>
              </Box>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]!.key}>
              {week.map((cell) =>
                cell.inMonth ? (
                  <Box
                    component="td"
                    key={cell.key}
                    aria-selected={cell.key === selected}
                    sx={{ p: 0.25, textAlign: 'center' }}
                  >
                    <DayButton
                      day={cell.day}
                      dayKey={cell.key}
                      count={counts.get(cell.key) ?? 0}
                      isToday={cell.key === today}
                      isSelected={cell.key === selected}
                      tabbable={cell.key === tabDay}
                      label={dayLabel(t, cell.key, counts.get(cell.key) ?? 0, cell.key === today)}
                      register={(element) => {
                        if (element) cells.current.set(cell.key, element);
                        else cells.current.delete(cell.key);
                      }}
                      onFocus={() => setFocusDay(cell.key)}
                      onClick={() => onSelect(cell.key === selected ? null : cell.key)}
                      onKeyDown={(event) => onKeyDown(event, cell.key)}
                    />
                  </Box>
                ) : (
                  <td key={cell.key} />
                ),
              )}
            </tr>
          ))}
        </tbody>
      </Box>
    </Box>
  );
}

function dayLabel(t: TFunction, key: DayKey, count: number, isToday: boolean) {
  const date = formatDate(key, 'weekdayLong');
  const parts = [date, isToday ? t('appointments.calendar.todayMark') : null];
  parts.push(count > 0 ? t('appointments.calendar.count', { count }) : null);
  return parts.filter(Boolean).join(', ');
}

interface DayButtonProps {
  day: number;
  dayKey: DayKey;
  count: number;
  isToday: boolean;
  isSelected: boolean;
  tabbable: boolean;
  label: string;
  register: (element: HTMLButtonElement | null) => void;
  onFocus: () => void;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}

function DayButton({
  day,
  dayKey,
  count,
  isToday,
  isSelected,
  tabbable,
  label,
  register,
  onFocus,
  onClick,
  onKeyDown,
}: DayButtonProps) {
  return (
    <Box
      component="button"
      type="button"
      ref={register}
      data-day={dayKey}
      tabIndex={tabbable ? 0 : -1}
      aria-label={label}
      aria-pressed={isSelected}
      aria-current={isToday ? 'date' : undefined}
      onFocus={onFocus}
      onClick={onClick}
      onKeyDown={onKeyDown}
      sx={(theme) => {
        const colors = palette(theme);
        return {
          appearance: 'none',
          border: 0,
          font: 'inherit',
          cursor: 'pointer',
          width: '100%',
          maxWidth: 48,
          minHeight: 44,
          mx: 'auto',
          display: 'grid',
          justifyItems: 'center',
          alignContent: 'center',
          gap: '3px',
          borderRadius: '14px',
          color: isSelected ? colors.primary.contrastText : colors.text.primary,
          backgroundColor: isSelected ? colors.primary.main : 'transparent',
          boxShadow: isToday && !isSelected ? `inset 0 0 0 1.5px ${colors.primary.main}` : 'none',
          fontVariantNumeric: 'tabular-nums',
          fontWeight: isToday || isSelected ? 600 : 400,
          '&:hover': { backgroundColor: isSelected ? colors.primary.main : colors.surfaceRaised },
          '&:focus-visible': { outline: focusRing(theme), outlineOffset: 2 },
        };
      }}
    >
      <span aria-hidden>{day}</span>
      <Box aria-hidden sx={{ display: 'flex', gap: '3px', height: 5 }}>
        {Array.from({ length: Math.min(count, MAX_DOTS) }, (_, index) => (
          <Box
            key={index}
            sx={(theme) => ({
              width: 5,
              height: 5,
              borderRadius: '50%',
              backgroundColor: isSelected
                ? palette(theme).primary.contrastText
                : palette(theme).primary.main,
            })}
          />
        ))}
      </Box>
    </Box>
  );
}

const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const;
