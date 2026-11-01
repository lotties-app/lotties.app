import { useControlAttributes } from './fieldContext';
import { NativeTimeInput } from './NativeTimeInput';

export interface ClockTimeFieldProps {
  /** The time of day as `HH:MM` (24 h), or empty while the native control is incomplete. */
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** Overrides the id from the surrounding `Field` (several fields under one label). */
  id?: string;
  'aria-label'?: string;
  disabled?: boolean;
}

/**
 * A time of day without a date (quiet hours, medicine times): the native time picker in a
 * form-row size, labelled, described and marked invalid by its `Field`.
 */
export function ClockTimeField({
  value,
  onChange,
  onBlur,
  id,
  disabled = false,
  'aria-label': ariaLabel,
}: ClockTimeFieldProps) {
  const { disabled: fieldDisabled, ...control } = useControlAttributes();
  return (
    <NativeTimeInput
      size="field"
      value={value}
      onChange={onChange}
      onBlur={onBlur}
      invalid={!!control['aria-invalid']}
      id={id ?? control.id}
      aria-label={ariaLabel}
      aria-describedby={control['aria-describedby']}
      aria-required={control['aria-required']}
      disabled={disabled || fieldDisabled}
    />
  );
}
