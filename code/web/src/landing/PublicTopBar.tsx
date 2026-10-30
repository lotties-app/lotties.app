import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import { Box, Button } from '@mui/material';
import { BrandMark } from '../ui/BrandMark';
import { Icon } from '../ui/Icon';
import { PAGE_WIDTH } from './features';

/**
 * The small top bar of the public pages (/credits, /install, /privacy). The installed app has no browser
 * back button, so the page brings its own: Back returns to where the person came from inside the
 * app, or to the home route when the page was opened directly (a link, a new window). Home always
 * goes to `/`: the app when signed in, the landing page otherwise.
 */
export function PublicTopBar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // The first entry of this tab's in-app history has the key "default": nothing to go back to.
  const canGoBack = useLocation().key !== 'default';
  return (
    <Box
      component="header"
      sx={{
        borderBottom: 1,
        borderColor: 'divider',
        bgcolor: 'background.default',
        pt: 'env(safe-area-inset-top)',
      }}
    >
      <Box
        sx={{
          maxWidth: PAGE_WIDTH,
          mx: 'auto',
          px: 2,
          minHeight: 64,
          display: 'grid',
          gridTemplateColumns: 'auto minmax(0, 1fr) auto',
          alignItems: 'center',
          gap: 1,
        }}
      >
        <Button
          onClick={() => (canGoBack ? navigate(-1) : navigate('/'))}
          startIcon={<Icon name="arrow-left" size={20} />}
          sx={{ minHeight: 44 }}
        >
          {t('install.publicNav.back')}
        </Button>
        <Box sx={{ justifySelf: 'center', minWidth: 0 }}>
          <RouterLink
            to="/"
            aria-label={t('install.publicNav.brandHome')}
            style={{ color: 'inherit', display: 'inline-flex' }}
          >
            <BrandMark size={32} decorative />
          </RouterLink>
        </Box>
        <Button
          component={RouterLink}
          to="/"
          startIcon={<Icon name="home" size={20} />}
          sx={{ minHeight: 44 }}
        >
          {t('install.publicNav.home')}
        </Button>
      </Box>
    </Box>
  );
}
