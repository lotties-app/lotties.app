import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Stack, Typography } from '@mui/material';
import { InstallButton } from '../install/InstallButton';
import { useInstallState } from '../install/useInstallState';
import { Icon } from '../ui/Icon';
import { PAGE_WIDTH } from './features';

/**
 * "Install on your phone": a small visible section (not a popup) with the install button and the
 * way to the step-by-step guide. Says so when this already is the installed app; absent in the
 * store app.
 */
export function InstallStrip() {
  const { t } = useTranslation();
  const { native, installed } = useInstallState();
  if (native) return null;
  return (
    <Box
      component="section"
      aria-labelledby="landing-install"
      sx={{ maxWidth: PAGE_WIDTH, mx: 'auto', px: 2, pb: { xs: 5, md: 8 } }}
    >
      <Stack spacing={1.5}>
        <Typography id="landing-install" variant="h4" component="h2">
          {t('install.landing.title')}
        </Typography>
        {installed ? (
          <Typography>{t('install.installed')}</Typography>
        ) : (
          <>
            <Typography>{t('install.landing.body')}</Typography>
            <Typography color="text.secondary">{t('install.landing.soon')}</Typography>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              sx={{ alignItems: { xs: 'stretch', sm: 'flex-start' } }}
            >
              <InstallButton />
              <Button
                component={RouterLink}
                to="/install"
                variant="outlined"
                endIcon={<Icon name="chevron-right" size={20} />}
                sx={{ minHeight: 48, alignSelf: 'flex-start' }}
              >
                {t('install.landing.guide')}
              </Button>
            </Stack>
          </>
        )}
      </Stack>
    </Box>
  );
}
