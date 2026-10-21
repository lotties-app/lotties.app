import { useTranslation } from 'react-i18next';
import { Card, Stack, Typography } from '@mui/material';
import { CategoryIcon } from '../ui/CategoryIcon';
import { GrowthPage } from './GrowthPage';

/**
 * Insights (third tab). The sleep, feeding and diaper charts arrive in a later wave; for now the
 * page hosts Growth under its own heading and says, calmly, that more is coming.
 */
export function InsightsPage() {
  const { t } = useTranslation();
  return (
    <Stack spacing={3}>
      <Typography variant="h4" component="h1">
        {t('nav.insights')}
      </Typography>
      <Card component="section" aria-labelledby="insights-soon-title" sx={{ p: 2.5 }}>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
          <CategoryIcon name="seedling" category="care" size={24} />
          <Stack spacing={0.5}>
            <Typography id="insights-soon-title" variant="h6" component="h2">
              {t('insights.soonTitle')}
            </Typography>
            <Typography color="text.secondary">{t('insights.soonBody')}</Typography>
          </Stack>
        </Stack>
      </Card>
      <GrowthPage heading="h2" />
    </Stack>
  );
}
