import { useTranslation } from 'react-i18next';
import { Box, Typography } from '@mui/material';
import { useLocale } from '../i18n/useLocale';
import { useThemeMode } from '../theme/ThemeModeContext';
import { PAGE_WIDTH, SHOWCASE_SCREENS, SHOWCASE_SIZE } from './features';

/** Self-hosted media (code/web/public/showcase): no third-party video host, nothing loaded until it scrolls into view. */
const MEDIA = `${import.meta.env.BASE_URL}showcase/`;
const FRAME_WIDTH = 220;

/**
 * "See it in action": a short silent demo video and a row of phone screenshots (a made-up baby with
 * made-up events). Images are lazy; the video loads nothing until the viewer presses play, and never
 * autoplays, so reduced-motion settings and data savers are respected by construction.
 */
export function ShowcaseStrip() {
  const { t } = useTranslation('landing');
  const { locale } = useLocale();
  const { scheme } = useThemeMode();
  const lang = locale === 'pt-BR' ? 'pt-BR' : 'en';
  const dark = scheme !== 'light';
  return (
    <Box
      component="section"
      aria-labelledby="landing-showcase"
      sx={{ maxWidth: PAGE_WIDTH, mx: 'auto', px: 2, pb: { xs: 5, md: 8 } }}
    >
      <Typography id="landing-showcase" variant="h4" component="h2" sx={{ mb: 1 }}>
        {t('showcase.title')}
      </Typography>
      <Typography color="text.secondary" sx={{ mb: 3, maxWidth: '65ch' }}>
        {t('showcase.intro')}
      </Typography>
      <Box
        component="video"
        controls
        playsInline
        muted
        preload="none"
        poster={`${MEDIA}demo-${lang}-poster.webp`}
        aria-label={t('showcase.video')}
        sx={{
          display: 'block',
          width: '100%',
          maxWidth: 300,
          aspectRatio: '390 / 844',
          mx: { xs: 'auto', md: 0 },
          mb: 3,
          borderRadius: 3,
          bgcolor: 'background.paper',
          boxShadow: 2,
        }}
      >
        <source src={`${MEDIA}demo-${lang}.webm`} type="video/webm" />
        <source src={`${MEDIA}demo-${lang}.mp4`} type="video/mp4" />
      </Box>
      <Box
        component="ul"
        // A scrollable row, focusable so keyboard users can move through it.
        tabIndex={0}
        aria-label={t('showcase.gallery')}
        sx={{
          m: 0,
          p: 0.5,
          listStyle: 'none',
          display: 'flex',
          gap: 2,
          overflowX: 'auto',
          scrollSnapType: 'x proximity',
          pb: 2,
        }}
      >
        {SHOWCASE_SCREENS.map(({ id, dark: hasDark }) => (
          <Box
            component="li"
            key={id}
            sx={{ flex: `0 0 ${FRAME_WIDTH}px`, scrollSnapAlign: 'start' }}
          >
            <Box
              component="img"
              src={`${MEDIA}${id}-${hasDark && dark ? 'dark' : 'light'}-${lang}.webp`}
              alt={t(`showcase.screens.${id}.alt`)}
              width={SHOWCASE_SIZE.width}
              height={SHOWCASE_SIZE.height}
              loading="lazy"
              decoding="async"
              sx={{
                display: 'block',
                width: '100%',
                height: 'auto',
                borderRadius: 3,
                boxShadow: 2,
                border: 1,
                borderColor: 'divider',
              }}
            />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {t(`showcase.screens.${id}.caption`)}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
