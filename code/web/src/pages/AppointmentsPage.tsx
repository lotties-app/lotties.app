import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { Alert, CircularProgress } from '@mui/material';
import { AppointmentsScreen } from '../appointments/AppointmentsScreen';
import { canSeeAppointments } from '../baby/permissions';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import { useBabies } from '../db/hooks';
import { hasPatients } from '../doctor/appMode';

/**
 * `/appointments`: the selected baby's appointments calendar. Reached from the Now card, the Day
 * header's calendar button, Settings, and an appointment reminder; not in the bottom bar. A Doctor
 * never sees the family's appointments: she is sent to her dashboard before anything renders.
 */
export function AppointmentsPage() {
  const { t } = useTranslation();
  const { babies, baby } = useSelectedBaby();
  const all = useBabies();
  if (!babies || !all) return <CircularProgress aria-label={t('common.loading')} />;
  if (!baby && hasPatients(all)) return <Navigate to="/doctor" replace />;
  if (!baby) return <Alert severity="info">{t('appointments.createBabyFirst')}</Alert>;
  if (!canSeeAppointments(baby)) return <Navigate to="/doctor" replace />;
  return <AppointmentsScreen key={baby.id} baby={baby} />;
}
