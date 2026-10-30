import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Stack, Typography } from '@mui/material';
import summary from '../credits/third-party-summary.generated.json';
import { SOURCE_REPOSITORY } from '../credits/curatedCredits';
import { ExternalLink } from '../credits/ExternalLink';
import { Icon } from '../ui/Icon';
import { PAGE_WIDTH } from './features';

/** How the headline packages of the generated summary are written for people. */
const DISPLAY_NAMES: Record<string, string> = {
  react: 'React',
  '@mui/material': 'MUI',
  dexie: 'Dexie',
  vite: 'Vite',
  i18next: 'i18next',
  '@capacitor/core': 'Capacitor',
  '@tabler/icons-react': 'Tabler Icons',
  'workbox-precaching': 'Workbox',
  'Microsoft.EntityFrameworkCore': 'Entity Framework Core',
  'Npgsql.EntityFrameworkCore.PostgreSQL': 'Npgsql',
  'Microsoft.AspNetCore.Authentication.JwtBearer': 'ASP.NET Core',
  'Lib.Net.Http.WebPush': 'Web Push',
};

/**
 * "Built on open source": a visible thank-you strip (not footer small print) with the number of
 * packages and a few direct dependencies, both read from the generated summary, the license, the
 * source link, the medical note and the way to the full credits page.
 */
export function OpenSourceStrip() {
  const { t } = useTranslation('landing');
  const names = summary.featured
    .map((name) => DISPLAY_NAMES[name])
    .filter(Boolean)
    .join(', ');
  return (
    <Box
      component="section"
      aria-labelledby="landing-open-source"
      sx={{ maxWidth: PAGE_WIDTH, mx: 'auto', px: 2, pb: { xs: 5, md: 8 } }}
    >
      <Box
        sx={(theme) => ({
          p: { xs: 2.5, sm: 3.5 },
          borderRadius: 3,
          bgcolor: (theme.vars ?? theme).palette.surfaceRaised,
          border: `1px solid ${theme.palette.divider}`,
        })}
      >
        <Stack spacing={1.5}>
          <Typography id="landing-open-source" variant="h4" component="h2">
            {t('openSource.title')}
          </Typography>
          <Typography>{t('openSource.body')}</Typography>
          <Typography sx={{ fontWeight: 600 }}>
            {t('openSource.count', { count: summary.count })}
          </Typography>
          <Typography color="text.secondary">{t('openSource.including', { names })}</Typography>
          <Typography color="text.secondary">
            {t('openSource.license')} {t('openSource.notMedical')}
          </Typography>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{ alignItems: { xs: 'stretch', sm: 'center' } }}
          >
            <Button
              component={RouterLink}
              to="/credits"
              variant="contained"
              endIcon={<Icon name="chevron-right" size={20} />}
              sx={{ minHeight: 48 }}
            >
              {t('openSource.seeAll')}
            </Button>
            <ExternalLink
              href={SOURCE_REPOSITORY}
              sx={{ minHeight: 44, display: 'inline-flex', alignItems: 'center' }}
            >
              {t('openSource.source')}
            </ExternalLink>
          </Stack>
        </Stack>
      </Box>
    </Box>
  );
}
