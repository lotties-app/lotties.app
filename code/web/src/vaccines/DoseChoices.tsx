import { Box, type Theme } from '@mui/material';
import { RADIUS } from '../theme/tokens';
import { useGroupAttributes } from '../ui/form/fieldContext';
import { optionBase, palette, selectedOption } from '../ui/form/styles';
import { useRadioGroup } from '../ui/form/useRadioGroup';

export interface DoseChoice {
  value: string;
  label: string;
}

interface Props {
  value: string;
  options: readonly DoseChoice[];
  onChange: (value: string) => void;
}

function rowSx(selected: boolean) {
  return (theme: Theme) => ({
    ...optionBase(theme),
    display: 'block',
    width: '100%',
    minHeight: 48,
    px: 1.75,
    py: 1,
    textAlign: 'start' as const,
    lineHeight: 1.35,
    fontSize: '0.9375rem',
    borderRadius: `${RADIUS.tile}px`,
    backgroundColor: palette(theme).surfaceRaised,
    overflowWrap: 'anywhere' as const,
    ...(selected && selectedOption(theme)),
  });
}

/**
 * The doses of a vaccine as a list of full-width radio rows (their labels are long sentences that
 * would not fit chips): one tab stop, arrows move and select. Named by the `Field` around it.
 */
export function DoseChoices({ value, options, onChange }: Props) {
  const group = useGroupAttributes();
  const radios = useRadioGroup(
    options.map((option) => ({ value: option.value, disabled: group.disabled })),
    value,
    onChange,
  );
  return (
    <Box
      role="radiogroup"
      aria-labelledby={group['aria-labelledby']}
      aria-describedby={group['aria-describedby']}
      onKeyDown={radios.onKeyDown}
      sx={{ display: 'grid', gap: 1 }}
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
            disabled={group.disabled}
            tabIndex={radios.tabIndexFor(option.value)}
            ref={radios.register(option.value)}
            onClick={() => onChange(option.value)}
            sx={rowSx(selected)}
          >
            {option.label}
          </Box>
        );
      })}
    </Box>
  );
}
