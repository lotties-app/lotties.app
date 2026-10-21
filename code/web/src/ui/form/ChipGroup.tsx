import type { ReactNode } from 'react';
import { Box, type Theme } from '@mui/material';
import { Icon } from '../Icon';
import type { IconName } from '../icons';
import { useGroupAttributes } from './fieldContext';
import { optionBase, palette, selectedOption } from './styles';
import { useRadioGroup } from './useRadioGroup';

export interface ChipOption<T extends string> {
  value: T;
  label: ReactNode;
  /** A 20 px icon before the label. */
  icon?: IconName;
  disabled?: boolean;
}

interface BaseProps<T extends string> {
  options: readonly ChipOption<T>[];
  'aria-label'?: string;
  disabled?: boolean;
}

export interface SingleChipGroupProps<T extends string> extends BaseProps<T> {
  multiple?: false;
  value: T | null;
  /** `null` when the selected chip is tapped again and `clearable` is set. */
  onChange: (value: T | null) => void;
  clearable?: boolean;
}

export interface MultiChipGroupProps<T extends string> extends BaseProps<T> {
  multiple: true;
  value: readonly T[];
  onChange: (value: T[]) => void;
}

export type ChipGroupProps<T extends string> = SingleChipGroupProps<T> | MultiChipGroupProps<T>;

/** Wrapping chips: 44 px high pills. Selected = accent ring, strong text, heavier weight. */
function chipSx(selected: boolean) {
  return (theme: Theme) => ({
    ...optionBase(theme),
    display: 'inline-flex',
    alignItems: 'center',
    gap: 0.75,
    minHeight: 44,
    px: 1.75,
    borderRadius: '999px',
    backgroundColor: palette(theme).surfaceRaised,
    fontSize: '0.875rem',
    whiteSpace: 'nowrap' as const,
    ...(selected && selectedOption(theme)),
  });
}

function ChipContent<T extends string>({ option }: { option: ChipOption<T> }) {
  return (
    <>
      {option.icon && <Icon name={option.icon} size={20} />}
      <span>{option.label}</span>
    </>
  );
}

function SingleChips<T extends string>({
  value,
  options,
  onChange,
  clearable = false,
  disabled: disabledProp = false,
  'aria-label': ariaLabel,
}: SingleChipGroupProps<T>) {
  const { disabled: fieldDisabled, ...group } = useGroupAttributes();
  const disabled = disabledProp || fieldDisabled;
  const radios = useRadioGroup(
    options.map((o) => ({ value: o.value, disabled: o.disabled || disabled })),
    value,
    onChange,
  );
  return (
    <Box
      role="radiogroup"
      aria-label={group['aria-labelledby'] ? undefined : ariaLabel}
      aria-labelledby={group['aria-labelledby']}
      aria-describedby={group['aria-describedby']}
      aria-invalid={group['aria-invalid']}
      aria-required={group['aria-required']}
      onKeyDown={radios.onKeyDown}
      sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Box
            key={option.value}
            component="button"
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={option.disabled || disabled}
            tabIndex={radios.tabIndexFor(option.value)}
            ref={radios.register(option.value)}
            onClick={() => onChange(selected && clearable ? null : option.value)}
            sx={chipSx(selected)}
          >
            <ChipContent option={option} />
          </Box>
        );
      })}
    </Box>
  );
}

function MultiChips<T extends string>({
  value,
  options,
  onChange,
  disabled: disabledProp = false,
  'aria-label': ariaLabel,
}: MultiChipGroupProps<T>) {
  const { disabled: fieldDisabled, ...group } = useGroupAttributes();
  const disabled = disabledProp || fieldDisabled;
  const toggle = (key: T) =>
    onChange(value.includes(key) ? value.filter((v) => v !== key) : [...value, key]);
  return (
    <Box
      role="group"
      aria-label={group['aria-labelledby'] ? undefined : ariaLabel}
      aria-labelledby={group['aria-labelledby']}
      aria-describedby={group['aria-describedby']}
      sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}
    >
      {options.map((option) => {
        const selected = value.includes(option.value);
        return (
          <Box
            key={option.value}
            component="button"
            type="button"
            aria-pressed={selected}
            disabled={option.disabled || disabled}
            onClick={() => toggle(option.value)}
            sx={chipSx(selected)}
          >
            <ChipContent option={option} />
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * Chips for 5-12 options or optional attributes. Single choice is a radio group (arrows move and
 * select); multiple choice is a group of toggle buttons (`aria-pressed`). They wrap, never scroll.
 */
export function ChipGroup<T extends string>(props: ChipGroupProps<T>) {
  return props.multiple ? <MultiChips {...props} /> : <SingleChips {...props} />;
}
