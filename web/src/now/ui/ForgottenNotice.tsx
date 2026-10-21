import { useTranslation } from 'react-i18next';
import { Box, Button, Typography } from '@mui/material';
import { RADIUS } from '../../theme/tokens';
import { palette } from '../../ui/form/styles';

interface Props {
  /** "Still running? Tummy time has run for 3h 40m". */
  title: string;
  /** Label of the button that ends the timer at the suggested time ("Stop at 14:20"). */
  endLabel: string;
  onEnd: () => void;
  /** "Still going": keeps the timer and hides the notice for a while. */
  onKeep: () => void;
  disabled?: boolean;
}

/**
 * A running timer that probably was not stopped (docs/design/03-interaction.md section 3): a calm
 * amber note with the suggested end and the way to keep it running. No modal, no red.
 */
export function ForgottenNotice({ title, endLabel, onEnd, onKeep, disabled = false }: Props) {
  const { t } = useTranslation();
  return (
    <Box
      role="group"
      aria-label={title}
      sx={(theme) => ({
        p: 1.5,
        borderRadius: `${RADIUS.input}px`,
        backgroundColor: palette(theme).category.diaper.bg,
        color: palette(theme).category.diaper.fg,
      })}
    >
      <Typography variant="body2" sx={{ fontWeight: 600, color: 'inherit' }}>
        {title}
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1 }}>
        <Button
          size="small"
          variant="outlined"
          color="inherit"
          onClick={onEnd}
          disabled={disabled}
          sx={{ minHeight: 44, borderColor: 'currentColor' }}
        >
          {endLabel}
        </Button>
        <Button size="small" color="inherit" onClick={onKeep} sx={{ minHeight: 44 }}>
          {t('now.forgotten.keep')}
        </Button>
      </Box>
    </Box>
  );
}
