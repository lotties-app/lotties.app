import {
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Box, type Theme } from '@mui/material';
import { formatDate, formatRelative, formatTime } from '../../i18n/format';
import { Icon } from '../Icon';
import { NativeTimeInput } from './NativeTimeInput';
import { useControlAttributes } from './fieldContext';
import { SwitchRow } from './SwitchRow';
import { focusRing, optionBase, palette, selectedOption } from './styles';
import {
  QUICK_MINUTES_AGO,
  MINUTE_MS,
  addMinutes,
  clampDate,
  clockValue,
  dateAtRatio,
  daysBeforeToday,
  hourMarks,
  parseClock,
  ratioOf,
  resolveTypedTime,
  rulerRange,
  shiftLocalDays,
  startOfMinute,
  withClock,
  type TimeProblem,
} from './timeMath';

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
  'aria-label'?: string;
  disabled?: boolean;
  /**
   * One row for quick logs: the quick chips beside the time, with the day (Today, Yesterday) and
   * the ruler folded behind two small buttons.
   */
  compact?: boolean;
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
 * pill with the chosen local time (the device's native time picker), Today/Yesterday (and the date when it
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
  disabled: disabledProp = false,
  'aria-label': ariaLabel,
  compact = false,
}: TimePanelProps) {
  const { t } = useTranslation();
  const { disabled: fieldDisabled, ...control } = useControlAttributes();
  const disabled = disabledProp || fieldDisabled;
  const [mountedAt] = useState(() => new Date());
  const now = startOfMinute(nowProp ?? mountedAt);
  const max = maxProp ?? now;
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<TimeProblem | null>(null);
  const [showDay, setShowDay] = useState(false);
  const [showRuler, setShowRuler] = useState(false);

  const running = allowRunning && value === null;
  const shown = value ?? max;
  const pick = (date: Date) => {
    setProblem(null);
    setDraft(null);
    onChange(clampDate(startOfMinute(date), min, max));
  };

  // The native picker fires a change per wheel step on iOS: a time that fits on the chosen day is
  // applied at once; anything else waits as a draft (never fought mid-scroll) until the field is
  // left, where it is resolved like a typed time (later than now today = yesterday evening) or
  // clamped into range with a message.
  const changeTime = (text: string) => {
    setProblem(null);
    const clock = parseClock(text);
    const onDay = clock && withClock(shown, clock.hours, clock.minutes);
    if (onDay && onDay <= max && !(min && onDay < min)) pick(onDay);
    else setDraft(text);
  };

  const leaveTime = () => {
    if (draft === null) return;
    const result = resolveTypedTime(draft, shown, { min, max });
    setDraft(null);
    if (result.ok) return pick(result.value);
    if (result.problem !== 'invalid') onChange(result.nearest);
    setProblem(result.problem);
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
        : t('ui.time.beforeMin', { time: min ? formatTime(min) : '' });

  const chips = (
    <Box
      role="group"
      aria-label={t('ui.time.quick')}
      sx={{ display: 'flex', flexWrap: 'wrap', gap: compact ? 0.75 : 1 }}
    >
      {quick.map(({ key, label, target }) => {
        const selected = value !== null && value.getTime() === target.getTime();
        const unavailable = (min && target < min) || target > max;
        const minutes = key === 'now' ? 0 : Number(key.slice(4));
        const short = compact && minutes > 0;
        return (
          <Box
            key={key}
            component="button"
            type="button"
            aria-pressed={selected}
            aria-label={short ? label : undefined}
            disabled={disabled || !!unavailable}
            onClick={() => pick(target)}
            sx={[chipSx(selected), compact && { px: 1.25, minWidth: 44, justifyContent: 'center' }]}
          >
            {short ? `−${minutes}` : label}
          </Box>
        );
      })}
    </Box>
  );

  const pill = (
    <NativeTimeInput
      value={draft ?? clockValue(shown)}
      size={compact ? 'compact' : 'large'}
      invalid={invalid}
      id={control.id}
      aria-label={control.id ? undefined : ariaLabel}
      aria-describedby={describedBy}
      aria-required={control['aria-required']}
      disabled={disabled}
      onChange={changeTime}
      onBlur={leaveTime}
    />
  );

  const problemNote = problem && (
    <Box
      id={messageId}
      role="status"
      sx={(theme) => ({ fontSize: '0.8125rem', color: palette(theme).error.main })}
    >
      {problemText(problem)}
    </Box>
  );

  const dayChips = (
    <Box
      role="group"
      aria-label={t('ui.time.day')}
      sx={{ display: 'flex', flexWrap: 'wrap', gap: compact ? 0.75 : 1 }}
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
  );

  const ruler = <TimeRuler value={shown} now={max} min={min} disabled={disabled} onPick={pick} />;

  const runningSwitch = allowRunning && (
    <SwitchRow
      checked={running}
      onChange={(on) => {
        setProblem(null);
        onChange(on ? null : clampDate(now, min, max));
      }}
      label={t('ui.time.stillRunning')}
      disabled={disabled}
    />
  );

  if (compact) {
    const dayText =
      days === 0 ? t('ui.time.today') : days === 1 ? t('ui.time.yesterday') : dateLabel;
    const dayId = `${control.id ?? 'time'}-day`;
    const rulerId = `${control.id ?? 'time'}-ruler`;
    return (
      <Box sx={{ display: 'grid', gap: 1 }}>
        {runningSwitch}
        {!running && (
          <>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
              {chips}
              {pill}
            </Box>
            {problemNote}
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              <DisclosureButton
                expanded={showDay}
                onToggle={() => setShowDay((open) => !open)}
                controls={dayId}
                disabled={disabled}
              >
                {dayText}
              </DisclosureButton>
              <DisclosureButton
                expanded={showRuler}
                onToggle={() => setShowRuler((open) => !open)}
                controls={rulerId}
                disabled={disabled}
              >
                {t('ui.time.morePrecise')}
              </DisclosureButton>
            </Box>
            {showDay && <Box id={dayId}>{dayChips}</Box>}
            {showRuler && <Box id={rulerId}>{ruler}</Box>}
          </>
        )}
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      {runningSwitch}
      {!running && (
        <>
          {chips}
          {pill}
          {problemNote}
          {dayChips}
          {ruler}
        </>
      )}
    </Box>
  );
}

/** A small text button that folds a part of the panel in and out (44 px high). */
function DisclosureButton({
  expanded,
  onToggle,
  controls,
  disabled,
  children,
}: {
  expanded: boolean;
  onToggle: () => void;
  controls: string;
  disabled: boolean;
  children: string;
}) {
  return (
    <Box
      component="button"
      type="button"
      aria-expanded={expanded}
      aria-controls={expanded ? controls : undefined}
      disabled={disabled}
      onClick={onToggle}
      sx={(theme) => ({
        ...optionBase(theme),
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        minHeight: 44,
        px: 1.25,
        borderRadius: '999px',
        backgroundColor: 'transparent',
        fontSize: '0.875rem',
        color: palette(theme).text.primary,
        textDecoration: 'underline',
        textDecorationColor: palette(theme).hairline,
        textUnderlineOffset: 4,
      })}
    >
      {children}
      <Icon name={expanded ? 'collapse' : 'expand'} size={16} />
    </Box>
  );
}

interface RulerProps {
  value: Date;
  /** The right end of the ruler. */
  now: Date;
  min: Date | null;
  disabled: boolean;
  onPick: (date: Date) => void;
}

/** Horizontal slider over the 12 hours before now: drag or use the arrow keys. */
function TimeRuler({ value, now, min, disabled, onPick }: RulerProps) {
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
        time: formatTime(value),
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
                {formatTime(mark)}
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
