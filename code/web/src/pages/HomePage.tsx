import { Navigate } from 'react-router-dom';
import { useSelectedBaby } from '../baby/SelectedBabyContext';
import { landsOnDashboard } from '../doctor/appMode';
import { readAppMode } from '../doctor/dashboardStorage';
import { CreateBabyCard } from '../baby/CreateBabyCard';
import { useBabies, useBabiesListed } from '../db/hooks';
import { ServerUnreachableCard } from '../home/ServerUnreachableCard';
import { NowScreen } from '../now/ui/NowScreen';
import { NowSkeleton } from '../now/ui/NowSkeleton';
import { useSyncEngine, useSyncStatus } from '../sync/SyncEngineContext';

/**
 * The Now screen of the selected baby (route `/`); the doctor's dashboard for a user who follows
 * babies only as their Doctor or chose "My patients". Without any local baby, "Create baby" is offered only once the server
 * confirmed the list is empty (now or in an earlier session); while that is unknown and the server
 * cannot be reached, a retry card is shown instead.
 */
export function HomePage() {
  const { babies, baby } = useSelectedBaby();
  const all = useBabies();
  const listed = useBabiesListed();
  const engine = useSyncEngine();
  const status = useSyncStatus();
  const spinner = <NowSkeleton />;

  if (!babies || !all) return spinner;
  // A doctor without a baby of her own, or one who chose "My patients", lands on the dashboard.
  if (landsOnDashboard(all, readAppMode())) return <Navigate to="/doctor" replace />;
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
