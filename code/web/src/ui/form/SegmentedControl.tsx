import type { ReactNode } from 'react';
import { Box } from '@mui/material';
import { Icon } from '../Icon';
import type { IconName } from '../icons';
import { RADIUS } from '../../theme/tokens';
import { useGroupAttributes } from './fieldContext';
import { CONTROL_HEIGHT, filledSurface, optionBase, palette, selectedOption } from './styles';
import { useRadioGroup } from './useRadioGroup';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** A 20 px icon before the label. */
  icon?: IconName;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  value: T | null;
  options: readonly SegmentedOption<T>[];
  /** `null` only when `clearable`. */
  onChange: (value: T | null) => void;
  /** Tapping the selected option clears it (optional fields only; never for required ones). */
  clearable?: boolean;
  /** Accessible name when the control is used without a `Field`. */
  'aria-label'?: string;
  disabled?: boolean;
}

/** Narrowest comfortable option: below `options x this` the control wraps to two rows. */
const MIN_OPTION_WIDTH = 96;

/**
 * Single choice from a few options: equal-width segments with an icon and a label, a radio group
 * for assistive tech (roving tabindex, arrows select). The selected segment has an inset accent
 * ring, the strong text colour and a heavier weight (not colour alone). When the container is
 * narrow (or the text is scaled) the options wrap to two rows instead of clipping.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  clearable = false,
  disabled: disabledProp = false,
  'aria-label': ariaLabel,
}: SegmentedControlProps<T>) {
  const { disabled: fieldDisabled, ...group } = useGroupAttributes();
  const disabled = disabledProp || fieldDisabled;
  const radios = useRadioGroup(
    options.map((o) => ({ value: o.value, disabled: o.disabled || disabled })),
    value,
    onChange,
  );
  const columns = options.length;
  const wrapAt = columns * MIN_OPTION_WIDTH;

  return (
    <Box sx={{ containerType: 'inline-size' }}>
      <Box
        role="radiogroup"
        aria-label={group['aria-labelledby'] ? undefined : ariaLabel}
        aria-labelledby={group['aria-labelledby']}
        aria-describedby={group['aria-describedby']}
        aria-invalid={group['aria-invalid']}
        aria-required={group['aria-required']}
        aria-disabled={disabled || undefined}
        onKeyDown={radios.onKeyDown}
        sx={(theme) => ({
          ...filledSurface(theme, !!group['aria-invalid']),
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gap: '4px',
          p: '4px',
          borderRadius: `${RADIUS.input + 4}px`,
          [`@container (max-width: ${wrapAt}px)`]: {
            gridTemplateColumns: `repeat(${Math.ceil(columns / 2)}, minmax(0, 1fr))`,
          },
        })}
      >
        {options.map((option) => {
          const selected = option.value === value;
          const optionDisabled = option.disabled || disabled;
          return (
            <Box
              key={option.value}
              component="button"
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={optionDisabled}
              tabIndex={radios.tabIndexFor(option.value)}
              ref={radios.register(option.value)}
              onClick={() => onChange(selected && clearable ? null : option.value)}
              sx={(theme) => ({
                ...optionBase(theme),
                minWidth: 0,
                minHeight: CONTROL_HEIGHT - 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 1,
                px: 1,
                py: 0.5,
                borderRadius: `${RADIUS.input}px`,
                backgroundColor: 'transparent',
                fontSize: '0.875rem',
                lineHeight: 1.2,
                textAlign: 'center',
                ...(selected && {
                  ...selectedOption(theme),
                  backgroundColor: palette(theme).background.paper,
                }),
              })}
            >
              {option.icon && <Icon name={option.icon} size={20} />}
              <span>{option.label}</span>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
