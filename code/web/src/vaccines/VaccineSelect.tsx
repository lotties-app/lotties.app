import { Box, type Theme } from '@mui/material';
import { Icon } from '../ui/Icon';
import { useControlAttributes } from '../ui/form/fieldContext';
import { filledSurface, focusRing, TOUCH_FIELD_FONT } from '../ui/form/styles';

export interface SelectOption {
  value: string;
  label: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  /** Shown while nothing is chosen (value `''`). */
  placeholder: string;
  disabled?: boolean;
}

/**
 * A native `<select>` on the filled form surface, for a list too long for chips (the vaccines).
 * Label, help and error come from the `Field` around it; the native control keeps the platform's
 * picker, search-by-typing and accessibility.
 */
export function VaccineSelect({ value, onChange, options, placeholder, disabled = false }: Props) {
  const { disabled: fieldDisabled, ...control } = useControlAttributes();
  return (
    <Box sx={{ position: 'relative' }}>
      <Box
        component="select"
        id={control.id}
        aria-describedby={control['aria-describedby']}
        aria-invalid={control['aria-invalid']}
        aria-required={control['aria-required']}
        disabled={disabled || fieldDisabled}
        value={value}
        onChange={(event: { target: { value: string } }) => onChange(event.target.value)}
        sx={(theme: Theme) => ({
          ...filledSurface(theme, !!control['aria-invalid']),
          appearance: 'none',
          display: 'block',
          width: '100%',
          boxSizing: 'border-box',
          paddingInlineStart: '14px',
          paddingInlineEnd: '44px',
          border: 0,
          font: 'inherit',
          ...TOUCH_FIELD_FONT,
          textOverflow: 'ellipsis',
          '&:focus-visible': { outline: focusRing(theme), outlineOffset: 0 },
          '&:disabled': { opacity: 0.5 },
        })}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Box>
      <Icon
        name="expand"
        size={20}
        sx={{
          position: 'absolute',
          insetInlineEnd: 14,
          top: '50%',
          transform: 'translateY(-50%)',
          pointerEvents: 'none',
          color: 'text.secondary',
        }}
      />
    </Box>
  );
}
