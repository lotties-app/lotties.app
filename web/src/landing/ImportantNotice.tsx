import { useTranslation } from 'react-i18next';
import { Box, Typography } from '@mui/material';
import { Icon } from '../ui/Icon';
import { PAGE_WIDTH } from './features';

/**
 * The medical disclaimer as a visible callout, not footer small print: the app keeps a log and shows
 * estimates, it never gives medical advice. Kept deliberately plain and calm (an accent edge, an icon
 * and a clear heading) so it reads as important without alarming.
 */
export function ImportantNotice() {
  const { t } = useTranslation('landing');
  return (
    <Box
      component="section"
      aria-labelledby="landing-important"
      sx={{ maxWidth: PAGE_WIDTH, mx: 'auto', px: 2, pb: { xs: 5, md: 8 } }}
    >
      <Box
        sx={(theme) => ({
          display: 'flex',
          gap: { xs: 2, sm: 3 },
          alignItems: 'flex-start',
          p: { xs: 2.5, sm: 3.5 },
          borderRadius: 3,
          bgcolor: (theme.vars ?? theme).palette.surfaceRaised,
          border: `1.5px solid ${theme.palette.warning.main}`,
        })}
      >
        <Box
          aria-hidden
          sx={(theme) => ({
            flexShrink: 0,
            width: 48,
            height: 48,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            color: theme.palette.warning.main,
            border: `1.5px solid ${theme.palette.warning.main}`,
          })}
        >
          <Icon name="info" size={24} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography
            component="p"
            variant="overline"
            sx={{ color: 'warning.main', fontWeight: 600, lineHeight: 1.6 }}
          >
            {t('important.eyebrow')}
          </Typography>
          <Typography id="landing-important" variant="h4" component="h2" sx={{ mb: 1 }}>
            {t('important.title')}
          </Typography>
          <Typography sx={{ mb: 1.5, fontWeight: 500 }}>{t('important.body')}</Typography>
          <Typography color="text.secondary">{t('important.care')}</Typography>
        </Box>
      </Box>
    </Box>
  );
}
