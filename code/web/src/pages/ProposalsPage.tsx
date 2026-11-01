import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { Alert, CircularProgress } from '@mui/material';
import { canDecideProposals } from '../baby/permissions';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import { useBabies } from '../db/hooks';
import { hasPatients } from '../doctor/appMode';
import { ProposalsScreen } from '../proposals/ProposalsScreen';

/**
 * `/proposals`: the old address of the Doctor's proposals (docs/design/16-doctor-access.md section
 * 10.5), now in her dashboard (a patient's Medications, docs/design/19-doctor-dashboard.md): a
 * doctor is sent there, the parents to what the doctor sent them.
 */
export function ProposalsPage() {
  const { t } = useTranslation();
  const { babies, baby } = useSelectedBaby();
  const all = useBabies();
  if (!babies || !all) return <CircularProgress aria-label={t('common.loading')} />;
  if (!baby && hasPatients(all)) return <Navigate to="/doctor" replace />;
  if (!baby) return <Alert severity="info">{t('proposals.mine.noBaby')}</Alert>;
  if (canDecideProposals(baby)) return <Navigate to="/from-doctor" replace />;
  return <ProposalsScreen key={baby.id} baby={baby} />;
}
