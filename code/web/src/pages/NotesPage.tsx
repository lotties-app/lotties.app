import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { Alert, CircularProgress } from '@mui/material';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import { useBabies } from '../db/hooks';
import { hasPatients } from '../doctor/appMode';
import { NotesScreen } from '../notes/NotesScreen';

/**
 * `/notes`: the selected baby's notes (docs/design/16-doctor-access.md), reached from Settings; not
 * in the bottom bar. A doctor writes hers in her dashboard (docs/design/19-doctor-dashboard.md).
 */
export function NotesPage() {
  const { t } = useTranslation();
  const { babies, baby } = useSelectedBaby();
  const all = useBabies();
  if (!babies || !all) return <CircularProgress aria-label={t('common.loading')} />;
  if (!baby && hasPatients(all)) return <Navigate to="/doctor" replace />;
  if (!baby) return <Alert severity="info">{t('doctor.notes.createBabyFirst')}</Alert>;
  return <NotesScreen key={baby.id} baby={baby} />;
}
