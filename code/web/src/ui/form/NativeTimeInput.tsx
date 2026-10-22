import { Box } from '@mui/material';
import { filledSurface, focusRing, palette } from './styles';

export interface NativeTimeInputProps {
  /** Local time of day as `HH:MM` (24 h), or empty. */
  value: string;
  /** Every change of the native control (the iOS wheel fires these while it turns). */
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** `large` for the time panel, `compact` for its one-row form, `field` for a form row. */
  size: 'large' | 'compact' | 'field';
  invalid: boolean;
  id?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-required'?: true;
  disabled?: boolean;
}

/**
 * The one native `<input type="time">` of the app, in the form library's filled look: the device
 * shows its own picker (the wheel on iOS, the field and dropdown on desktop) and its own clock
 * format, while the value stays `HH:MM`. Used by the time panel and by `ClockTimeField`.
 */
export function NativeTimeInput({
  value,
  onChange,
  onBlur,
  size,
  invalid,
  disabled = false,
  ...aria
}: NativeTimeInputProps) {
  const big = size !== 'field';
  return (
    <Box
      component="input"
      type="time"
      step={60}
      dir="ltr"
      value={value}
      disabled={disabled}
      id={aria.id}
      aria-label={aria['aria-label']}
      aria-describedby={aria['aria-describedby']}
      aria-invalid={invalid ? true : undefined}
      aria-required={aria['aria-required']}
      onChange={(e: { target: { value: string } }) => onChange(e.target.value)}
      onBlur={onBlur}
      sx={(theme) => ({
        ...filledSurface(theme, invalid),
        appearance: 'none',
        WebkitAppearance: 'none',
        // Native parts (the desktop clock icon, the iOS wheel) follow the app theme.
        colorScheme: theme.palette.mode,
        boxSizing: 'border-box',
        width: '100%',
        minWidth: 0,
        minHeight: size === 'large' ? 72 : 48,
        px: 1.75,
        border: 0,
        color: palette(theme).text.primary,
        fontVariantNumeric: 'tabular-nums lining-nums',
        // Never below 16 px, or iOS zooms the page on focus.
        ...(big
          ? {
              fontFamily: theme.typography.fontFamilyDisplay,
              fontSize: size === 'compact' ? '1.5rem' : '2.5rem',
              letterSpacing: '0.02em',
              textAlign: 'center',
              // iOS Safari draws the value in this part; desktop Chrome in the edit box.
              '&::-webkit-date-and-time-value': { textAlign: 'center', margin: 0 },
              '&::-webkit-datetime-edit': { flex: '0 1 auto', margin: '0 auto' },
            }
          : {
              font: 'inherit',
              fontSize: '1.0625rem',
              '&::-webkit-date-and-time-value': { textAlign: 'start' },
            }),
        ...(size === 'compact' && { flex: '0 0 auto', width: 'auto', minWidth: 112 }),
        '&::-webkit-calendar-picker-indicator': { cursor: 'pointer', opacity: 0.6 },
        '&:focus-visible': { outline: focusRing(theme), outlineOffset: 0 },
        '&:disabled': { opacity: 0.5 },
      })}
    />
  );
}
