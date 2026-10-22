import { useTranslation } from 'react-i18next';
import { Alert, CircularProgress } from '@mui/material';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import { VaccinationCardScreen } from '../vaccines/VaccinationCardScreen';

/** `/vaccines/card`: the selected baby's printable vaccination card. */
export function VaccinationCardPage() {
  const { t } = useTranslation();
  const { babies, baby } = useSelectedBaby();
  if (!babies) return <CircularProgress aria-label={t('common.loading')} />;
  if (!baby) return <Alert severity="info">{t('vaccines.createBabyFirst')}</Alert>;
  return <VaccinationCardScreen key={baby.id} baby={baby} />;
}
