import { useTranslation } from 'react-i18next';
import { Box, Typography } from '@mui/material';
import { PAGE_WIDTH, STORY } from './features';

/** Why Lotties exists, in the makers' own words. */
export function StoryStrip() {
  const { t } = useTranslation('landing');
  return (
    <Box
      component="section"
      aria-labelledby="landing-story"
      sx={{ maxWidth: PAGE_WIDTH, mx: 'auto', px: 2, pb: { xs: 5, md: 8 } }}
    >
      <Typography id="landing-story" variant="h4" component="h2" sx={{ mb: 2 }}>
        {t('story.title')}
      </Typography>
      <Box sx={{ maxWidth: '65ch' }}>
        {STORY.map((p) => (
          <Typography key={p} color="text.secondary" sx={{ mb: 1.5 }}>
            {t(`story.${p}`)}
          </Typography>
        ))}
      </Box>
    </Box>
  );
}
