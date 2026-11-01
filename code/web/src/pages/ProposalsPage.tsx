import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import { Alert, CircularProgress } from '@mui/material';
import { canDecideProposals } from '../baby/permissions';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import { ProposalsScreen } from '../proposals/ProposalsScreen';

/**
 * `/proposals`: the Doctor's proposals for the selected baby (docs/design/16-doctor-access.md
 * section 10.5). Reached from Settings and the Patients list; not in the bottom bar. The parents
 * are sent to what the doctor sent them.
 */
export function ProposalsPage() {
  const { t } = useTranslation();
  const { babies, baby } = useSelectedBaby();
  if (!babies) return <CircularProgress aria-label={t('common.loading')} />;
  if (!baby) return <Alert severity="info">{t('proposals.mine.noBaby')}</Alert>;
  if (canDecideProposals(baby)) return <Navigate to="/from-doctor" replace />;
  return <ProposalsScreen key={baby.id} baby={baby} />;
}
