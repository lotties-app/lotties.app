import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { Alert, CircularProgress } from '@mui/material';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import { useBabies } from '../db/hooks';
import { hasPatients } from '../doctor/appMode';
import { FromDoctorScreen } from '../proposals/FromDoctorScreen';

/**
 * `/from-doctor`: what the baby's doctor sent the family (docs/design/16-doctor-access.md section
 * 10.3). Reached from Now, Settings and a "doctor suggestion" notification; not in the bottom bar.
 * A doctor without a baby of her own is sent to her dashboard (docs/design/19-doctor-dashboard.md).
 */
export function FromDoctorPage() {
  const { t } = useTranslation();
  const { babies, baby } = useSelectedBaby();
  const all = useBabies();
  if (!babies || !all) return <CircularProgress aria-label={t('common.loading')} />;
  if (!baby && hasPatients(all)) return <Navigate to="/doctor" replace />;
  if (!baby) return <Alert severity="info">{t('proposals.fromDoctor.noBaby')}</Alert>;
  return <FromDoctorScreen key={baby.id} baby={baby} />;
}
