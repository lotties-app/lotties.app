import { useTranslation } from 'react-i18next';
import { Box, Card, Typography } from '@mui/material';
import { ExternalLink } from '../credits/ExternalLink';
import { importRequestUrl } from '../import/importRequest';
import { Illustration } from '../ui/illustrations';
import { FEATURES, PAGE_WIDTH } from './features';

export function FeatureGrid() {
  const { t } = useTranslation('landing');
  return (
    <Box
      component="section"
      aria-labelledby="landing-features"
      sx={{ maxWidth: PAGE_WIDTH, mx: 'auto', px: 2, pb: { xs: 5, md: 8 } }}
    >
      <Typography id="landing-features" variant="h4" component="h2" sx={{ mb: 3 }}>
        {t('features.title')}
      </Typography>
      <Box
        component="ul"
        sx={{
          m: 0,
          p: 0,
          listStyle: 'none',
          display: 'grid',
          gap: 2,
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            sm: 'repeat(2, minmax(0, 1fr))',
            md: 'repeat(3, minmax(0, 1fr))',
          },
        }}
      >
        {FEATURES.map(({ key, illustration, category }) => (
          <Box component="li" key={key} sx={{ display: 'flex' }}>
            <Card sx={{ p: 2.5, width: '100%', display: 'grid', gap: 1.5, alignContent: 'start' }}>
              <Box
                aria-hidden
                sx={(theme) => ({
                  width: 72,
                  height: 72,
                  borderRadius: '24px',
                  bgcolor: (theme.vars ?? theme).palette.category[category].bg,
                  display: 'grid',
                  placeItems: 'center',
                })}
              >
                <Illustration name={illustration} size={56} />
              </Box>
              {/* Two lines reserved side by side, so a one-line title does not lift its text above the others. */}
              <Typography variant="h5" component="h3" sx={{ minHeight: { sm: '2lh' } }}>
                {t(`features.${key}.title`)}
              </Typography>
              <Typography color="text.secondary">{t(`features.${key}.body`)}</Typography>
              {key === 'data' && (
                <ExternalLink
                  href={importRequestUrl()}
                  sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}
                >
                  {t('features.data.request')}
                </ExternalLink>
              )}
            </Card>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
