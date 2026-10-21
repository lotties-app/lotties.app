import { useTranslation } from 'react-i18next';
import { CircularProgress, Typography } from '@mui/material';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import { BabyTimeline } from '../timeline/BabyTimeline';

export function TimelinePage() {
  const { t } = useTranslation();
  const { babies, baby } = useSelectedBaby();

  if (!babies) return <CircularProgress aria-label={t('common.loading')} />;
  if (!baby) {
    return (
      <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
        {t('timeline.noBaby')}
      </Typography>
    );
  }
  return <BabyTimeline key={baby.id} baby={baby} />;
}
