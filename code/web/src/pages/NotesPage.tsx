import { useTranslation } from 'react-i18next';
import { Alert, CircularProgress } from '@mui/material';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import { NotesScreen } from '../notes/NotesScreen';

/**
 * `/notes`: the selected baby's notes (docs/design/16-doctor-access.md). Reached from Settings and
 * from the Patients list; not in the bottom bar.
 */
export function NotesPage() {
  const { t } = useTranslation();
  const { babies, baby } = useSelectedBaby();
  if (!babies) return <CircularProgress aria-label={t('common.loading')} />;
  if (!baby) return <Alert severity="info">{t('doctor.notes.createBabyFirst')}</Alert>;
  return <NotesScreen key={baby.id} baby={baby} />;
}
