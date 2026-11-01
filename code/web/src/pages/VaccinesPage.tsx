import { useTranslation } from 'react-i18next';
import { Alert, CircularProgress } from '@mui/material';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import { VaccinesScreen } from '../vaccines/VaccinesScreen';

/**
 * `/vaccines`: the selected baby's vaccine schedule and records. Reached from Settings, the "Vaccines
 * due" card on Now and a vaccine reminder; not in the bottom bar.
 */
export function VaccinesPage() {
  const { t } = useTranslation();
  const { babies, baby } = useSelectedBaby();
  if (!babies) return <CircularProgress aria-label={t('common.loading')} />;
  if (!baby) return <Alert severity="info">{t('vaccines.createBabyFirst')}</Alert>;
  return <VaccinesScreen key={baby.id} baby={baby} />;
}
