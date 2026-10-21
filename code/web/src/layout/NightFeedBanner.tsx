import { useTranslation } from 'react-i18next';
import { Box, Button, Typography } from '@mui/material';
import { useNightFeed } from '../theme/NightFeedContext';
import { RADIUS } from '../theme/tokens';

/**
 * "Switch to night view?" between 22:00 and 05:00 when the setting is Ask. Quiet, dismissible,
 * and gone for the rest of the window after either button.
 */
export function NightFeedBanner() {
  const { t } = useTranslation();
  const { suggested, accept, dismiss } = useNightFeed();
  if (!suggested) return null;
  return (
    <Box
      role="region"
      aria-label={t('layout.nightView')}
      sx={{
        mx: 2,
        mb: 1,
        pl: 2,
        pr: 1,
        py: 0.5,
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        flexWrap: 'wrap',
        borderRadius: `${RADIUS.input}px`,
        bgcolor: 'surfaceRaised',
      }}
    >
      <Typography variant="body2" sx={{ flexGrow: 1, fontWeight: 600 }}>
        {t('layout.nightViewPrompt')}
      </Typography>
      <Button size="small" variant="contained" onClick={accept}>
        {t('layout.nightViewSwitch')}
      </Button>
      <Button size="small" color="inherit" onClick={dismiss}>
        {t('layout.nightViewNotNow')}
      </Button>
    </Box>
  );
}
