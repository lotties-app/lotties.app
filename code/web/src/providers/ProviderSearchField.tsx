import { Box } from '@mui/material';
import { Icon } from '../ui/Icon';
import { filledSurface, focusRing, palette } from '../ui/form/styles';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** The accessible name and placeholder. */
  label: string;
}

/** A search box on the filled surface (magnifier, search input), as in the medication picker. */
export function ProviderSearchField({ value, onChange, label }: Props) {
  return (
    <Box
      sx={(theme) => ({
        ...filledSurface(theme),
        display: 'flex',
        alignItems: 'center',
        gap: 1.25,
        px: 1.5,
        '&:focus-within': { outline: focusRing(theme), outlineOffset: 0 },
      })}
    >
      <Icon name="search" size={20} sx={{ color: 'text.secondary' }} />
      <Box
        component="input"
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        aria-label={label}
        placeholder={label}
        value={value}
        onChange={(e: { target: { value: string } }) => onChange(e.target.value)}
        sx={(theme) => ({
          flex: 1,
          minWidth: 0,
          height: 44,
          border: 0,
          outline: 0,
          background: 'none',
          font: 'inherit',
          color: palette(theme).text.primary,
          '&::placeholder': { color: palette(theme).text.secondary },
        })}
      />
    </Box>
  );
}
