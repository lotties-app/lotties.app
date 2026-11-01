import { useTranslation } from 'react-i18next';
import { Box, Typography } from '@mui/material';
import { PAGE_WIDTH, STEPS } from './features';

/** "How it works" in three steps: a numbered list, side by side from the small breakpoint. */
export function StepsStrip() {
  const { t } = useTranslation('landing');
  return (
    <Box
      component="section"
      aria-labelledby="landing-steps"
      sx={{ maxWidth: PAGE_WIDTH, mx: 'auto', px: 2, pb: { xs: 5, md: 8 } }}
    >
      <Typography id="landing-steps" variant="h4" component="h2" sx={{ mb: 3 }}>
        {t('steps.title')}
      </Typography>
      <Box
        component="ol"
        sx={{
          m: 0,
          p: 0,
          listStyle: 'none',
          display: 'grid',
          gap: 3,
          gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(3, minmax(0, 1fr))' },
        }}
      >
        {STEPS.map((step, index) => (
          <Box component="li" key={step} sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
            <Typography
              aria-hidden
              component="span"
              sx={(theme) => ({
                fontFamily: theme.typography.fontFamilyDisplay,
                fontSize: '2.5rem',
                lineHeight: 1,
                color: 'primary.main',
                minWidth: '1.2ch',
              })}
            >
              {index + 1}
            </Typography>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="h6" component="h3">
                {t(`steps.${step}.title`)}
              </Typography>
              <Typography color="text.secondary">{t(`steps.${step}.body`)}</Typography>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
