import { useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '../api/ApiClientContext';
import { useAuth } from '../auth/useAuth';
import { useDatabase } from '../db/DatabaseContext';
import { countUnsyncedMutations } from '../db/outbox';
import { releaseThisDevice } from '../notifications/pushActions';
import { useSyncEngine } from '../sync/SyncEngineContext';
import { useAccountSession } from './AccountSessionContext';
import { endAccountSession } from './endSession';

/**
 * Sign-out that leaves nothing of the account on the device: stops sync, drops cached server
 * state, deletes the account's database and localStorage entries, then ends the OIDC session.
 * Check `countUnsynced` first: changes still in the outbox are lost.
 */
export function useSignOut() {
  const db = useDatabase();
  const engine = useSyncEngine();
  const { logout } = useAuth();
  const queryClient = useQueryClient();
  const session = useAccountSession();
  const api = useApiClient();

  const signOut = async () => {
    engine.stop();
    await engine.whenIdle();
    queryClient.clear();
    await (session ? session.end() : endAccountSession(db, logout, releaseThisDevice(api)));
  };

  return {
    signOut,
    /** Pending plus dead-lettered changes (all lost on sign-out). */
    countUnsynced: () => countUnsyncedMutations(db),
  };
}
