import { Box, type Theme } from '@mui/material';
import { useControlAttributes } from './fieldContext';
import { filledSurface, focusRing } from './styles';

export interface TextInputProps {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
  placeholder?: string;
  /** Accessible name when the input is used without a `Field`. */
  'aria-label'?: string;
  disabled?: boolean;
}

/** One line of free text on the filled surface; label, help and error come from the `Field`. */
export function TextInput({
  value,
  onChange,
  maxLength = 200,
  placeholder,
  disabled: disabledProp = false,
  'aria-label': ariaLabel,
}: TextInputProps) {
  const { disabled: fieldDisabled, ...control } = useControlAttributes();
  const disabled = disabledProp || fieldDisabled;
  return (
    <Box
      component="input"
      type="text"
      id={control.id}
      aria-label={control.id ? undefined : ariaLabel}
      aria-describedby={control['aria-describedby']}
      aria-invalid={control['aria-invalid']}
      aria-required={control['aria-required']}
      disabled={disabled}
      maxLength={maxLength}
      placeholder={placeholder}
      value={value}
      onChange={(e: { target: { value: string } }) => onChange(e.target.value)}
      sx={(theme: Theme) => ({
        ...filledSurface(theme, !!control['aria-invalid']),
        display: 'block',
        width: '100%',
        boxSizing: 'border-box',
        px: 1.75,
        border: 0,
        font: 'inherit',
        '&:focus-visible': { outline: focusRing(theme), outlineOffset: 0 },
        '&:disabled': { opacity: 0.5 },
      })}
    />
  );
}
