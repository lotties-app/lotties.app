import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { Box, Button, Stack, Typography } from '@mui/material';
import { BrandMark } from '../ui/BrandMark';
import { PAGE_WIDTH } from './features';
import { HeroArt } from './HeroArt';

interface Props {
  notice?: ReactNode;
  onSignIn: () => void;
  onRegister: () => void;
  /** A signed-in visitor (/welcome): one "Open the app" button instead of Sign in and Create. */
  signedIn?: boolean;
}

export function Hero({ notice, onSignIn, onRegister, signedIn }: Props) {
  const { t } = useTranslation('landing');
  return (
    <Box
      sx={{
        maxWidth: PAGE_WIDTH,
        mx: 'auto',
        px: 2,
        pt: { xs: 3, md: 6 },
        pb: { xs: 5, md: 8 },
        display: 'grid',
        gap: { xs: 4, md: 6 },
        gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1.1fr) minmax(0, 0.9fr)' },
        alignItems: 'center',
      }}
    >
      <Stack spacing={3} sx={{ alignItems: 'flex-start', minWidth: 0 }}>
        {notice && <Box sx={{ width: '100%' }}>{notice}</Box>}
        <BrandMark size={72} decorative />
        <Typography
          variant="hero"
          component="h1"
          sx={{ fontSize: { xs: '2.25rem', sm: '3rem', md: '3.5rem' }, overflowWrap: 'break-word' }}
        >
          {t('hero.headline')}
        </Typography>
        <Typography color="text.secondary" sx={{ fontSize: '1.0625rem', maxWidth: 520 }}>
          {t('hero.sub')}
        </Typography>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{ width: { xs: '100%', sm: 'auto' } }}
        >
          {signedIn ? (
            <Button
              component={RouterLink}
              to="/"
              variant="contained"
              size="large"
              sx={{ minHeight: 56, px: 4 }}
            >
              {t('hero.openApp')}
            </Button>
          ) : (
            <>
              <Button
                variant="contained"
                size="large"
                onClick={onSignIn}
                sx={{ minHeight: 56, px: 4 }}
              >
                {t('hero.signIn')}
              </Button>
              <Button
                variant="outlined"
                size="large"
                onClick={onRegister}
                sx={{ minHeight: 56, px: 4 }}
              >
                {t('hero.register')}
              </Button>
            </>
          )}
        </Stack>
      </Stack>
      <HeroArt />
    </Box>
  );
}
