import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Box } from '@mui/material';
import { formatNumber } from '../../i18n/format';
import { Icon } from '../Icon';
import { useControlAttributes } from './fieldContext';
import { decimalsOf, formatDecimal, parseLocaleNumber, roundTo } from './numbers';
import { filledSurface, focusRing, optionBase, palette, selectedOption } from './styles';

/** Press-and-hold: first repeat after this delay, then at this interval (docs/design/03 section 7). */
export const HOLD_DELAY_MS = 400;
export const HOLD_INTERVAL_MS = 90;

export interface NumberStepperProps {
  value: number | null;
  onChange: (value: number | null) => void;
  step?: number;
  min?: number;
  max?: number;
  /** Unit suffix next to the value ("ml"). */
  unit?: string;
  /** Quick-value chips under the stepper. */
  quickValues?: readonly number[];
  /** A short word shown after a quick chip ("120 ml · all"), by chip value. */
  quickTags?: Readonly<Record<number, string>>;
  /** The last used value: marked "· last" on its chip (added to the chips when not in the list). */
  lastValue?: number | null;
  /** Where the first press starts when the value is empty (defaults to `min`, else 0). */
  start?: number;
  /** Fraction digits shown; defaults to the digits of `step`. */
  decimals?: number;
  /** Accessible name when the stepper is used without a `Field`. */
  'aria-label'?: string;
  disabled?: boolean;
}

const clamp = (value: number, min?: number, max?: number) =>
  Math.min(max ?? Infinity, Math.max(min ?? -Infinity, value));

/**
 * A number with big - / + buttons (44 px, press-and-hold repeats), a centred value you can also
 * type (`inputMode="decimal"`, comma or dot), a unit suffix and optional quick-value chips. The
 * value is clamped to min/max with a quiet status message ("Up to 400 ml").
 */
export function NumberStepper({
  value,
  onChange,
  step = 1,
  min,
  max,
  unit,
  quickValues,
  quickTags,
  lastValue = null,
  decimals,
  start,
  disabled: disabledProp = false,
  'aria-label': ariaLabel,
}: NumberStepperProps) {
  const { t } = useTranslation();
  const { disabled: fieldDisabled, ...control } = useControlAttributes();
  const disabled = disabledProp || fieldDisabled;
  const places = decimals ?? decimalsOf(step);
  const [draft, setDraft] = useState<string | null>(null);
  const [clamped, setClamped] = useState<'min' | 'max' | null>(null);
  const latest = useRef(value);
  const hold = useRef<{ delay?: number; repeat?: number }>({});

  useEffect(() => {
    latest.current = value;
  }, [value]);

  const stopHold = () => {
    window.clearTimeout(hold.current.delay);
    window.clearInterval(hold.current.repeat);
    hold.current = {};
  };
  useEffect(() => stopHold, []);

  const commit = (next: number) => {
    const bounded = clamp(roundTo(next, places), min, max);
    setClamped(next > (max ?? Infinity) ? 'max' : next < (min ?? -Infinity) ? 'min' : null);
    latest.current = bounded;
    setDraft(null);
    onChange(bounded);
  };

  const nudge = (direction: 1 | -1) => {
    if (latest.current === null) return commit(start ?? min ?? 0);
    commit(latest.current + direction * step);
  };

  const startHold = (direction: 1 | -1, event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0 || disabled) return;
    stopHold();
    nudge(direction);
    const tick = () => {
      nudge(direction);
      const now = latest.current;
      // A button that becomes disabled at the bound gets no pointerup: stop here.
      const atBound = direction === 1 ? now !== null && now >= (max ?? Infinity) : false;
      const atLow = direction === -1 ? now !== null && now <= (min ?? -Infinity) : false;
      if (atBound || atLow) stopHold();
    };
    hold.current.delay = window.setTimeout(() => {
      hold.current.repeat = window.setInterval(tick, HOLD_INTERVAL_MS);
    }, HOLD_DELAY_MS);
  };

  const atMin = value !== null && min !== undefined && value <= min;
  const atMax = value !== null && max !== undefined && value >= max;

  const onType = (text: string) => {
    setDraft(text);
    setClamped(null);
    const parsed = parseLocaleNumber(text);
    if (parsed !== null && parsed >= (min ?? -Infinity) && parsed <= (max ?? Infinity)) {
      latest.current = parsed;
      onChange(parsed);
    }
  };

  const onBlur = () => {
    if (draft === null) return;
    const parsed = parseLocaleNumber(draft);
    if (parsed !== null) commit(parsed);
    else if (draft.trim() === '') {
      setDraft(null);
      latest.current = null;
      onChange(null);
    } else setDraft(null);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowUp') nudge(1);
    else if (event.key === 'ArrowDown') nudge(-1);
    else return;
    event.preventDefault();
  };

  const shown = draft ?? (value === null ? '' : formatDecimal(value, places));
  const withUnit = (n: number) => (unit ? `${formatNumber(n)} ${unit}` : formatNumber(n));
  const chips = [...(quickValues ?? [])];
  if (lastValue !== null && quickValues && !chips.includes(lastValue)) chips.push(lastValue);
  chips.sort((a, b) => a - b);

  return (
    <Box>
      <Box
        sx={(theme) => ({
          ...filledSurface(theme, !!control['aria-invalid']),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1.5,
          p: 1,
          borderRadius: '18px',
          '&:focus-within': { outline: focusRing(theme), outlineOffset: 0 },
        })}
      >
        <StepButton
          label={t('ui.stepper.decrease')}
          icon="minus"
          disabled={disabled || atMin}
          onPointerDown={(event) => startHold(-1, event)}
          onStop={stopHold}
          onKeyboardClick={() => nudge(-1)}
        />
        <Box
          sx={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'center',
            gap: 0.5,
            flex: 1,
            minWidth: 0,
          }}
        >
          <Box
            component="input"
            type="text"
            inputMode="decimal"
            role="spinbutton"
            autoComplete="off"
            id={control.id}
            aria-label={control.id ? undefined : ariaLabel}
            aria-describedby={control['aria-describedby']}
            aria-invalid={control['aria-invalid']}
            aria-required={control['aria-required']}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={value ?? undefined}
            aria-valuetext={value === null ? undefined : withUnit(value)}
            disabled={disabled}
            value={shown}
            onChange={(e: { target: { value: string } }) => onType(e.target.value)}
            onBlur={onBlur}
            onFocus={(e: { target: HTMLInputElement }) => e.target.select()}
            onKeyDown={onKeyDown}
            sx={(theme) => ({
              width: '100%',
              maxWidth: 140,
              textAlign: 'center',
              border: 0,
              outline: 0,
              background: 'none',
              color: palette(theme).text.primary,
              fontFamily: theme.typography.fontFamilyDisplay,
              fontSize: '2.125rem',
              fontWeight: 400,
              fontVariantNumeric: 'tabular-nums lining-nums',
              '&::placeholder': { color: palette(theme).text.secondary },
            })}
          />
          {unit && (
            <Box
              component="span"
              aria-hidden
              sx={(theme) => ({ fontSize: '1rem', color: palette(theme).text.secondary })}
            >
              {unit}
            </Box>
          )}
        </Box>
        <StepButton
          label={t('ui.stepper.increase')}
          icon="add"
          disabled={disabled || atMax}
          onPointerDown={(event) => startHold(1, event)}
          onStop={stopHold}
          onKeyboardClick={() => nudge(1)}
        />
      </Box>
      <Box role="status" sx={{ mt: clamped ? 0.75 : 0 }}>
        {clamped && (
          <Box sx={(theme) => ({ fontSize: '0.8125rem', color: palette(theme).text.secondary })}>
            {clamped === 'max' && max !== undefined
              ? t('ui.stepper.atMost', { value: withUnit(max) })
              : min !== undefined
                ? t('ui.stepper.atLeast', { value: withUnit(min) })
                : null}
          </Box>
        )}
      </Box>
      {chips.length > 0 && (
        <Box
          role="group"
          aria-label={t('ui.stepper.quickValues')}
          sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1.25 }}
        >
          {chips.map((chip) => (
            <Box
              key={chip}
              component="button"
              type="button"
              aria-pressed={value === chip}
              disabled={disabled}
              onClick={() => commit(chip)}
              sx={(theme) => ({
                ...optionBase(theme),
                display: 'inline-flex',
                alignItems: 'baseline',
                gap: 0.5,
                minHeight: 40,
                px: 1.5,
                borderRadius: '999px',
                backgroundColor: palette(theme).surfaceRaised,
                fontSize: '0.875rem',
                ...(value === chip && selectedOption(theme)),
              })}
            >
              <span>{withUnit(chip)}</span>
              {chip === lastValue && (
                <Box component="span" sx={{ fontSize: '0.6875rem', opacity: 0.8 }}>
                  {`· ${t('ui.stepper.last')}`}
                </Box>
              )}
              {quickTags && Object.hasOwn(quickTags, chip) && (
                <Box component="span" sx={{ fontSize: '0.6875rem', opacity: 0.8 }}>
                  {`· ${quickTags[chip]}`}
                </Box>
              )}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

interface StepButtonProps {
  label: string;
  icon: 'add' | 'minus';
  disabled: boolean;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onStop: () => void;
  /** Keyboard and assistive-tech activation (pointer presses step on `pointerdown`). */
  onKeyboardClick: () => void;
}

function StepButton({
  label,
  icon,
  disabled,
  onPointerDown,
  onStop,
  onKeyboardClick,
}: StepButtonProps) {
  return (
    <Box
      component="button"
      type="button"
      aria-label={label}
      disabled={disabled}
      onPointerDown={onPointerDown}
      onPointerUp={onStop}
      onPointerLeave={onStop}
      onPointerCancel={onStop}
      onBlur={onStop}
      onContextMenu={(e: { preventDefault: () => void }) => e.preventDefault()}
      // A pointer press already stepped on pointerdown; a click with no pointer (detail 0) is
      // the keyboard or a screen reader.
      onClick={(event: { detail: number }) => {
        if (event.detail === 0) onKeyboardClick();
      }}
      sx={(theme) => ({
        ...optionBase(theme),
        display: 'grid',
        placeItems: 'center',
        flex: 'none',
        width: 44,
        height: 44,
        borderRadius: '50%',
        backgroundColor: palette(theme).background.paper,
        color: palette(theme).text.primary,
        touchAction: 'manipulation',
        userSelect: 'none',
      })}
    >
      <Icon name={icon} size={20} />
    </Box>
  );
}
