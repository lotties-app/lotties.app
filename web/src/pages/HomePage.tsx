import { useTranslation } from 'react-i18next';
import { CircularProgress } from '@mui/material';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import { CreateBabyCard } from '../baby/CreateBabyCard';
import { useBabiesListed } from '../db/hooks';
import { BabyHome } from '../home/BabyHome';
import { ServerUnreachableCard } from '../home/ServerUnreachableCard';
import { useSyncEngine, useSyncStatus } from '../sync/SyncEngineContext';

/**
 * Home of the selected baby. Without any local baby, "Create baby" is offered only once the server
 * confirmed the list is empty (now or in an earlier session); while that is unknown and the server
 * cannot be reached, a retry card is shown instead.
 */
export function HomePage() {
  const { t } = useTranslation();
  const { babies, baby } = useSelectedBaby();
  const listed = useBabiesListed();
  const engine = useSyncEngine();
  const status = useSyncStatus();
  const spinner = <CircularProgress aria-label={t('common.loading')} />;

  if (!babies) return spinner;
  if (baby) return <BabyHome key={baby.id} baby={baby} />;
  if (listed === undefined) return spinner;
  if (listed) return <CreateBabyCard />;
  const failed = status.state === 'error' || status.state === 'offline' || status.authRequired;
  if (!failed) return spinner;
  return (
    <ServerUnreachableCard
      offline={status.state === 'offline'}
      onRetry={() => void engine.syncNow()}
    />
  );
}
