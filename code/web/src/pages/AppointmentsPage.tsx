import { useTranslation } from 'react-i18next';
import { Alert, CircularProgress } from '@mui/material';
import { AppointmentsScreen } from '../appointments/AppointmentsScreen';
import { useSelectedBaby } from '../baby/SelectedBabyContext';

/**
 * `/appointments`: the selected baby's appointments calendar. Reached from the Now card, the Day
 * header's calendar button, Settings, and an appointment reminder; not in the bottom bar.
 */
export function AppointmentsPage() {
  const { t } = useTranslation();
  const { babies, baby } = useSelectedBaby();
  if (!babies) return <CircularProgress aria-label={t('common.loading')} />;
  if (!baby) return <Alert severity="info">{t('appointments.createBabyFirst')}</Alert>;
  return <AppointmentsScreen key={baby.id} baby={baby} />;
}
