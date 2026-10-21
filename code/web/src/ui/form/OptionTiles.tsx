import type { ReactNode } from 'react';
import { Box, type Theme } from '@mui/material';
import { RADIUS } from '../../theme/tokens';
import { Icon } from '../Icon';
import type { IconName } from '../icons';
import { useGroupAttributes } from './fieldContext';
import { optionBase, palette, selectedOption } from './styles';
import { useRadioGroup } from './useRadioGroup';

export interface TileOption<T extends string> {
  value: T;
  label: ReactNode;
  /** The picture above the label (an outline icon until the illustration set has one). */
  icon?: IconName;
  disabled?: boolean;
}

export interface OptionTilesProps<T extends string> {
  value: T | null;
  options: readonly TileOption<T>[];
  /** `null` when the selected tile is tapped again and `clearable` is set. */
  onChange: (value: T | null) => void;
  clearable?: boolean;
  /** Tiles per row on a phone (3 by default; 3 also fits 320 px). */
  columns?: number;
  'aria-label'?: string;
  disabled?: boolean;
}

function tileSx(selected: boolean) {
  return (theme: Theme) => ({
    ...optionBase(theme),
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0.5,
    minHeight: 76,
    minWidth: 0,
    px: 0.5,
    py: 1,
    textAlign: 'center' as const,
    lineHeight: 1.2,
    fontSize: '0.75rem',
    hyphens: 'auto' as const,
    borderRadius: `${RADIUS.tile}px`,
    backgroundColor: palette(theme).surfaceRaised,
    overflowWrap: 'break-word' as const,
    ...(selected && selectedOption(theme)),
  });
}

/**
 * Single choice as a grid of picture tiles (icon above a short label): a radio group for assistive
 * tech with the same keyboard behaviour as the chips. The selected tile has the accent ring and a
 * heavier label (not colour alone). Tiles wrap to more rows instead of shrinking below 88 px.
 */
export function OptionTiles<T extends string>({
  value,
  options,
  onChange,
  clearable = false,
  columns = 3,
  disabled: disabledProp = false,
  'aria-label': ariaLabel,
}: OptionTilesProps<T>) {
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
      onKeyDown={radios.onKeyDown}
      sx={{ display: 'grid', gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gap: 1 }}
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
            sx={tileSx(selected)}
          >
            {option.icon && <Icon name={option.icon} size={32} />}
            <span>{option.label}</span>
          </Box>
        );
      })}
    </Box>
  );
}
