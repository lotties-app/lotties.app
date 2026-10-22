import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { Alert, CircularProgress } from '@mui/material';
import { isDoctor } from '../baby/permissions';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import { FromDoctorScreen } from '../proposals/FromDoctorScreen';

/**
 * `/from-doctor`: what the baby's doctor sent the family (docs/design/16-doctor-access.md section
 * 10.3). Reached from Now, Settings and a "doctor suggestion" notification; not in the bottom bar.
 * The doctor herself is sent to her proposals.
 */
export function FromDoctorPage() {
  const { t } = useTranslation();
  const { babies, baby } = useSelectedBaby();
  if (!babies) return <CircularProgress aria-label={t('common.loading')} />;
  if (!baby) return <Alert severity="info">{t('proposals.fromDoctor.noBaby')}</Alert>;
  if (isDoctor(baby)) return <Navigate to="/proposals" replace />;
  return <FromDoctorScreen key={baby.id} baby={baby} />;
}
