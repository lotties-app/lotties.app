import { Navigate } from 'react-router-dom';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import { isDoctorOnly, patientChosenThisSession } from '../patients/patientsModel';
import { CreateBabyCard } from '../baby/CreateBabyCard';
import { useBabiesListed } from '../db/hooks';
import { ServerUnreachableCard } from '../home/ServerUnreachableCard';
import { NowScreen } from '../now/ui/NowScreen';
import { NowSkeleton } from '../now/ui/NowSkeleton';
import { useSyncEngine, useSyncStatus } from '../sync/SyncEngineContext';

/**
 * The Now screen of the selected baby (route `/`). Without any local baby, "Create baby" is offered only once the server
 * confirmed the list is empty (now or in an earlier session); while that is unknown and the server
 * cannot be reached, a retry card is shown instead.
 */
export function HomePage() {
  const { babies, baby } = useSelectedBaby();
  const listed = useBabiesListed();
  const engine = useSyncEngine();
  const status = useSyncStatus();
  const spinner = <NowSkeleton />;

  if (!babies) return spinner;
  // A doctor without a baby of her own lands on her Patients list until she opens one.
  if (isDoctorOnly(babies) && !patientChosenThisSession())
    return <Navigate to="/patients" replace />;
  if (baby) return <NowScreen key={baby.id} baby={baby} />;
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
