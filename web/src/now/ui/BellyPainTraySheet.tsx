import { useTranslation } from 'react-i18next';
import { Box, Typography } from '@mui/material';
import { formatNumber } from '../../i18n/format';
import { RADIUS } from '../../theme/tokens';
import { CategoryIcon } from '../../ui/CategoryIcon';
import { palette } from '../../ui/form/styles';
import type { BellyPainTray } from '../quickLog';
import { SheetFrame } from './SheetFrame';

interface Props {
  open: boolean;
  onClose: () => void;
  tray: BellyPainTray;
  onChoose: (intensity: number) => void;
  disabled: boolean;
}

/** The Belly pain tray: intensity 1 to 5 (mild to severe), one tap logs. */
export function BellyPainTraySheet({ open, onClose, tray, onChoose, disabled }: Props) {
  const { t } = useTranslation();
  const first = tray.intensities[0];
  const last = tray.intensities[tray.intensities.length - 1];
  return (
    <SheetFrame
      open={open}
      onClose={onClose}
      title={t('now.bellyTray.title')}
      leading={<CategoryIcon name="mood-sad" category="health" />}
    >
      <Typography variant="body2" color="text.secondary">
        {t('now.bellyTray.hint')}
      </Typography>
      <Box
        role="group"
        aria-label={t('now.bellyTray.title')}
        sx={{
          display: 'grid',
          gridTemplateColumns: `repeat(${Math.max(1, tray.intensities.length)}, minmax(0, 1fr))`,
          gap: 1,
        }}
      >
        {tray.intensities.map((value, index) => (
          <Box
            key={value}
            component="button"
            type="button"
            autoFocus={index === 0}
            disabled={disabled}
            onClick={() => onChoose(value)}
            sx={(theme) => ({
              appearance: 'none',
              border: 0,
              font: 'inherit',
              cursor: 'pointer',
              minHeight: 64,
              borderRadius: `${RADIUS.tile}px`,
              fontFamily: theme.typography.fontFamilyDisplay,
              fontSize: '1.5rem',
              backgroundColor: palette(theme).category.health.bg,
              color: palette(theme).category.health.fg,
              '&:focus-visible': {
                outline: `2px solid ${palette(theme).primary.main}`,
                outlineOffset: 2,
              },
              '&:disabled': { opacity: 0.5, cursor: 'not-allowed' },
            })}
          >
            {formatNumber(value)}
          </Box>
        ))}
      </Box>
      {first !== undefined && last !== undefined && (
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Typography variant="caption" color="text.secondary">
            {t('now.bellyTray.mild')}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {t('now.bellyTray.severe')}
          </Typography>
        </Box>
      )}
    </SheetFrame>
  );
}
