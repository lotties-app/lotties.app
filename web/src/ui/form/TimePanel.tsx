import {
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Box, type Theme } from '@mui/material';
import { currentLocale } from '../../i18n/i18n';
import { formatDate, formatRelative, formatTime } from '../../i18n/format';
import { useControlAttributes } from './fieldContext';
import { SwitchRow } from './SwitchRow';
import { filledSurface, focusRing, optionBase, palette, selectedOption } from './styles';
import {
  QUICK_MINUTES_AGO,
  MINUTE_MS,
  addMinutes,
  clampDate,
  dateAtRatio,
  daysBeforeToday,
  hourMarks,
  ratioOf,
  resolveTypedTime,
  rulerRange,
  shiftLocalDays,
  startOfMinute,
  type TimeProblem,
} from './timeMath';

export type HourCycle = 'h23' | 'h12';

export interface TimePanelProps {
  /** The chosen instant; `null` = still running (only with `allowRunning`). */
  value: Date | null;
  onChange: (value: Date | null) => void;
  /** "Now" for the chips and the ruler (defaults to the time the panel mounted). */
  now?: Date;
  /** Earliest accepted instant (an end time must not precede its start). */
  min?: Date | null;
  /** Latest accepted instant; defaults to `now` (events are never in the future). */
  max?: Date | null;
  /** Adds a "Still running" switch; while on, `value` is `null`. For the end of an event. */
  allowRunning?: boolean;
  /** `h23` (default, like the rest of the app) or `h12` with am/pm. */
  hourCycle?: HourCycle;
  'aria-label'?: string;
  disabled?: boolean;
}

/** Digits typed into the pill: a 24 h clock or `h12` text such as "2:30 pm". */
function clockText(date: Date, hourCycle: HourCycle): string {
  if (hourCycle === 'h23') return formatTime(date);
  return new Intl.DateTimeFormat(currentLocale(), {
    hour: 'numeric',
    minute: '2-digit',
    hourCycle: 'h12',
  }).format(date);
}

const chipSx = (selected: boolean) => (theme: Theme) => ({
  ...optionBase(theme),
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 40,
  px: 1.5,
  borderRadius: '999px',
  backgroundColor: palette(theme).surfaceRaised,
  fontSize: '0.875rem',
  whiteSpace: 'nowrap' as const,
  ...(selected && selectedOption(theme)),
});

/**
 * Inline time entry for the start or end of an event: quick chips (Now, 5, 15, 30 min ago), a big
 * pill with the chosen local time you can also type into, Today/Yesterday (and the date when it
 * is older), and a ruler that snaps to 5 minutes across the 12 hours before now. Never in the
 * future, never before `min`. Pure maths lives in `timeMath.ts`.
 */
export function TimePanel({
  value,
  onChange,
  now: nowProp,
  min = null,
  max: maxProp,
  allowRunning = false,
  hourCycle = 'h23',
  disabled: disabledProp = false,
  'aria-label': ariaLabel,
}: TimePanelProps) {
  const { t } = useTranslation();
  const { disabled: fieldDisabled, ...control } = useControlAttributes();
  const disabled = disabledProp || fieldDisabled;
  const [mountedAt] = useState(() => new Date());
  const now = startOfMinute(nowProp ?? mountedAt);
  const max = maxProp ?? now;
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<TimeProblem | null>(null);

  const running = allowRunning && value === null;
  const shown = value ?? max;
  const pick = (date: Date) => {
    setProblem(null);
    setDraft(null);
    onChange(clampDate(startOfMinute(date), min, max));
  };

  const commitDraft = () => {
    if (draft === null) return;
    const result = resolveTypedTime(draft, shown, { min, max });
    if (result.ok) pick(result.value);
    else {
      setDraft(null);
      setProblem(result.problem);
    }
  };

  const messageId = `${control.id ?? 'time'}-problem`;
  const describedBy =
    [control['aria-describedby'], problem ? messageId : null].filter(Boolean).join(' ') ||
    undefined;
  const invalid = problem !== null || !!control['aria-invalid'];

  const days = daysBeforeToday(shown, max);
  const dateLabel = formatDate(shown, 'weekdayDayMonth');
  const quick = [
    { key: 'now', label: t('ui.time.now'), target: now },
    ...QUICK_MINUTES_AGO.map((minutes) => ({
      key: `ago-${minutes}`,
      label: t('ui.time.minutesAgo', { count: minutes }),
      target: addMinutes(now, -minutes),
    })),
  ];

  const problemText = (kind: TimeProblem) =>
    kind === 'invalid'
      ? t('ui.time.invalid')
      : kind === 'future'
        ? t('ui.time.future')
        : t('ui.time.beforeMin', { time: min ? clockText(min, hourCycle) : '' });

  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      {allowRunning && (
        <SwitchRow
          checked={running}
          onChange={(on) => {
            setProblem(null);
            onChange(on ? null : clampDate(now, min, max));
          }}
          label={t('ui.time.stillRunning')}
          disabled={disabled}
        />
      )}
      {!running && (
        <>
          <Box
            role="group"
            aria-label={t('ui.time.quick')}
            sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}
          >
            {quick.map(({ key, label, target }) => {
              const selected = value !== null && value.getTime() === target.getTime();
              const unavailable = (min && target < min) || target > max;
              return (
                <Box
                  key={key}
                  component="button"
                  type="button"
                  aria-pressed={selected}
                  disabled={disabled || !!unavailable}
                  onClick={() => pick(target)}
                  sx={chipSx(selected)}
                >
                  {label}
                </Box>
              );
            })}
          </Box>

          <Box
            sx={(theme) => ({
              ...filledSurface(theme, invalid),
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 72,
              '&:focus-within': { outline: focusRing(theme), outlineOffset: 0 },
            })}
          >
            <Box
              component="input"
              type="text"
              inputMode={hourCycle === 'h23' ? 'numeric' : 'text'}
              autoComplete="off"
              spellCheck={false}
              dir="ltr"
              id={control.id}
              aria-label={control.id ? undefined : ariaLabel}
              aria-describedby={describedBy}
              aria-invalid={invalid ? true : undefined}
              aria-required={control['aria-required']}
              disabled={disabled}
              value={draft ?? clockText(shown, hourCycle)}
              onFocus={(e: { target: HTMLInputElement }) => e.target.select()}
              onChange={(e: { target: { value: string } }) => {
                setDraft(e.target.value);
                setProblem(null);
              }}
              onBlur={commitDraft}
              onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  commitDraft();
                } else if (e.key === 'Escape') {
                  setDraft(null);
                  setProblem(null);
                }
              }}
              sx={(theme) => ({
                width: '100%',
                maxWidth: 220,
                textAlign: 'center',
                border: 0,
                outline: 0,
                background: 'none',
                color: palette(theme).text.primary,
                fontFamily: theme.typography.fontFamilyDisplay,
                fontSize: '2.5rem',
                fontVariantNumeric: 'tabular-nums lining-nums',
                letterSpacing: '0.02em',
              })}
            />
          </Box>
          {problem && (
            <Box
              id={messageId}
              role="status"
              sx={(theme) => ({ fontSize: '0.8125rem', color: palette(theme).error.main })}
            >
              {problemText(problem)}
            </Box>
          )}

          <Box
            role="group"
            aria-label={t('ui.time.day')}
            sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}
          >
            <Box
              component="button"
              type="button"
              aria-pressed={days === 0}
              disabled={disabled}
              onClick={() => pick(shiftLocalDays(shown, days))}
              sx={chipSx(days === 0)}
            >
              {t('ui.time.today')}
            </Box>
            <Box
              component="button"
              type="button"
              aria-pressed={days === 1}
              disabled={disabled}
              onClick={() => pick(shiftLocalDays(shown, days - 1))}
              sx={chipSx(days === 1)}
            >
              {t('ui.time.yesterday')}
            </Box>
            {days > 1 && (
              <Box component="span" sx={chipSx(true)}>
                {dateLabel}
              </Box>
            )}
          </Box>

          <TimeRuler
            value={shown}
            now={max}
            min={min}
            hourCycle={hourCycle}
            disabled={disabled}
            onPick={pick}
          />
        </>
      )}
    </Box>
  );
}

interface RulerProps {
  value: Date;
  /** The right end of the ruler. */
  now: Date;
  min: Date | null;
  hourCycle: HourCycle;
  disabled: boolean;
  onPick: (date: Date) => void;
}

/** Horizontal slider over the 12 hours before now: drag or use the arrow keys. */
function TimeRuler({ value, now, min, hourCycle, disabled, onPick }: RulerProps) {
  const { t } = useTranslation();
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const range = rulerRange(now, min);
  const span = range.to.getTime() - range.from.getTime();
  const ratio = ratioOf(value, range);
  if (span < 5 * MINUTE_MS) return null;

  const pickAt = (clientX: number) => {
    const box = track.current?.getBoundingClientRect();
    if (!box || box.width === 0) return;
    onPick(dateAtRatio((clientX - box.left) / box.width, range));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    dragging.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.focus();
    pickAt(event.clientX);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const big = event.shiftKey || event.key === 'PageUp' || event.key === 'PageDown';
    const step = big ? 15 : 1;
    let next: Date | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown' || event.key === 'PageDown') {
      next = addMinutes(value, -step);
    } else if (event.key === 'ArrowRight' || event.key === 'ArrowUp' || event.key === 'PageUp') {
      next = addMinutes(value, step);
    } else if (event.key === 'Home') next = range.to;
    else if (event.key === 'End') next = range.from;
    if (!next) return;
    event.preventDefault();
    onPick(clampDate(next, range.from, range.to));
  };

  const marks = hourMarks(range);
  const labelEvery = span > 6 * 60 * MINUTE_MS ? 3 : 1;
  const offsetMinutes = (value.getTime() - range.to.getTime()) / MINUTE_MS;

  return (
    <Box
      ref={track}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      dir="ltr"
      aria-label={t('ui.time.ruler')}
      aria-orientation="horizontal"
      aria-disabled={disabled || undefined}
      aria-valuemin={-span / MINUTE_MS}
      aria-valuemax={0}
      aria-valuenow={offsetMinutes}
      aria-valuetext={t('ui.time.rulerValue', {
        time: clockText(value, hourCycle),
        relative: formatRelative(value.getTime(), range.to.getTime()),
      })}
      onPointerDown={onPointerDown}
      onPointerMove={(e: ReactPointerEvent<HTMLDivElement>) =>
        dragging.current && pickAt(e.clientX)
      }
      onPointerUp={() => {
        dragging.current = false;
      }}
      onPointerCancel={() => {
        dragging.current = false;
      }}
      onKeyDown={onKeyDown}
      sx={(theme) => ({
        position: 'relative',
        height: 64,
        borderRadius: '12px',
        backgroundColor: palette(theme).background.paper,
        boxShadow: `inset 0 0 0 1px ${palette(theme).hairline}`,
        touchAction: 'none',
        cursor: disabled ? 'not-allowed' : 'ew-resize',
        overflow: 'hidden',
        opacity: disabled ? 0.5 : 1,
        '&:focus-visible': { outline: focusRing(theme), outlineOffset: 2 },
      })}
    >
      {marks.map((mark) => {
        const left = ratioOf(mark, range) * 100;
        // Labels near either end would be clipped by the rounded track.
        const labelled = mark.getHours() % labelEvery === 0 && left > 7 && left < 93;
        return (
          <Box key={mark.getTime()} aria-hidden>
            <Box
              sx={(theme) => ({
                position: 'absolute',
                bottom: 10,
                left: `${left}%`,
                width: '1px',
                height: labelled ? 18 : 8,
                backgroundColor: palette(theme).text.secondary,
                opacity: labelled ? 0.7 : 0.4,
              })}
            />
            {labelled && (
              <Box
                sx={(theme) => ({
                  position: 'absolute',
                  top: 6,
                  left: `${left}%`,
                  transform: 'translateX(-50%)',
                  fontSize: '0.6875rem',
                  color: palette(theme).text.secondary,
                  whiteSpace: 'nowrap',
                })}
              >
                {clockText(mark, hourCycle)}
              </Box>
            )}
          </Box>
        );
      })}
      <Box
        aria-hidden
        sx={(theme) => ({
          position: 'absolute',
          top: 6,
          bottom: 6,
          left: `calc(${ratio * 100}% - 1.5px)`,
          width: 3,
          borderRadius: 2,
          backgroundColor: palette(theme).primary.main,
        })}
      />
    </Box>
  );
}
