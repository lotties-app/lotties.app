import { useTranslation } from 'react-i18next';
import { Box } from '@mui/material';
import { Icon } from '../ui/Icon';
import { filledSurface, focusRing, palette, TOUCH_FIELD_FONT } from '../ui/form/styles';

interface Props {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

/** The "Find or add a medication" search field of the medication choosers. */
export function ChooserSearch({ value, onChange, disabled = false }: Props) {
  const { t } = useTranslation();
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
        aria-label={t('ui.medication.find')}
        placeholder={t('ui.medication.find')}
        value={value}
        disabled={disabled}
        onChange={(e: { target: { value: string } }) => onChange(e.target.value)}
        sx={(theme) => ({
          flex: 1,
          minWidth: 0,
          // No intrinsic width (an input's `size`): the row, not the field, sets the size.
          width: 0,
          height: 44,
          border: 0,
          outline: 0,
          background: 'none',
          font: 'inherit',
          ...TOUCH_FIELD_FONT,
          color: palette(theme).text.primary,
          '&::placeholder': { color: palette(theme).text.secondary },
        })}
      />
    </Box>
  );
}
