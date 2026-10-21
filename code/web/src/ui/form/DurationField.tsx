import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box } from '@mui/material';
import { Icon } from '../Icon';
import { formatNumber } from '../../i18n/format';
import { formatDurationInput, parseDuration } from './duration';
import { useControlAttributes } from './fieldContext';
import { filledSurface, focusRing, palette } from './styles';

export interface DurationFieldProps {
  /** Stored value in seconds (`null` = empty). */
  valueSeconds: number | null;
  onChange: (seconds: number | null) => void;
  /** Longest accepted duration, in seconds. */
  maxSeconds?: number;
  'aria-label'?: string;
  disabled?: boolean;
}

/**
 * A duration typed in minutes with a stopwatch icon: `12`, `12:30` (mm:ss) or `12,5`. The stored
 * value is seconds. The unit label ("min") comes from the catalog.
 */
export function DurationField({
  valueSeconds,
  onChange,
  maxSeconds,
  disabled: disabledProp = false,
  'aria-label': ariaLabel,
}: DurationFieldProps) {
  const { t } = useTranslation();
  const { disabled: fieldDisabled, ...control } = useControlAttributes();
  const disabled = disabledProp || fieldDisabled;
  const [draft, setDraft] = useState<string | null>(null);
  const [problem, setProblem] = useState<'invalid' | 'tooLong' | null>(null);
  const shown = draft ?? (valueSeconds === null ? '' : formatDurationInput(valueSeconds));
  const invalid = problem !== null || !!control['aria-invalid'];
  const messageId = `${control.id ?? 'duration'}-problem`;

  const read = (text: string) => {
    const parsed = parseDuration(text);
    if (parsed.kind === 'empty') return { ok: true as const, seconds: null };
    if (parsed.kind === 'invalid') return { ok: false as const, problem: 'invalid' as const };
    if (maxSeconds !== undefined && parsed.seconds > maxSeconds) {
      return { ok: false as const, problem: 'tooLong' as const };
    }
    return { ok: true as const, seconds: parsed.seconds };
  };

  const onType = (text: string) => {
    setDraft(text);
    const result = read(text);
    setProblem(null);
    if (result.ok) onChange(result.seconds);
  };

  const onBlur = () => {
    if (draft === null) return;
    const result = read(draft);
    if (result.ok) setDraft(null);
    else setProblem(result.problem);
  };

  const describedBy =
    [control['aria-describedby'], problem ? messageId : null].filter(Boolean).join(' ') ||
    undefined;

  return (
    <Box>
      <Box
        sx={(theme) => ({
          ...filledSurface(theme, invalid),
          display: 'flex',
          alignItems: 'center',
          gap: 1.25,
          px: 1.5,
          '&:focus-within': { outline: focusRing(theme), outlineOffset: 0 },
        })}
      >
        <Icon name="stopwatch" size={20} sx={{ color: 'text.secondary' }} />
        <Box
          component="input"
          type="text"
          inputMode="text"
          enterKeyHint="done"
          autoComplete="off"
          spellCheck={false}
          id={control.id}
          aria-label={control.id ? undefined : ariaLabel}
          aria-describedby={describedBy}
          aria-invalid={invalid ? true : undefined}
          aria-required={control['aria-required']}
          placeholder={t('ui.duration.placeholder')}
          disabled={disabled}
          value={shown}
          onChange={(e: { target: { value: string } }) => onType(e.target.value)}
          onBlur={onBlur}
          sx={(theme) => ({
            flex: 1,
            minWidth: 0,
            height: 44,
            border: 0,
            outline: 0,
            background: 'none',
            color: palette(theme).text.primary,
            font: 'inherit',
            fontSize: '1.0625rem',
            fontVariantNumeric: 'tabular-nums',
          })}
        />
        <Box
          component="span"
          aria-hidden
          sx={(theme) => ({ color: palette(theme).text.secondary, fontSize: '0.9375rem' })}
        >
          {t('ui.duration.unit')}
        </Box>
      </Box>
      {problem && (
        <Box
          id={messageId}
          role="status"
          sx={(theme) => ({ mt: 0.75, fontSize: '0.8125rem', color: palette(theme).error.main })}
        >
          {problem === 'invalid'
            ? t('ui.duration.invalid')
            : t('ui.duration.tooLong', {
                value: `${formatNumber(Math.floor((maxSeconds ?? 0) / 60))} ${t('ui.duration.unit')}`,
              })}
        </Box>
      )}
    </Box>
  );
}
