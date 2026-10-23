import { createBaby, updateBaby } from '../api/managementApi';
import { useApiClient } from '../api/ApiClientContext';
import { useDatabase } from '../db/DatabaseContext';
import type { Baby } from '../db/models';
import { useSyncEngine } from '../sync/SyncEngineContext';
import type { BabyRequest } from '../sync/contract';
import { useSelectedBaby } from './SelectedBabyContext';

/**
 * Online-only baby operations. The server's answer is mirrored into Dexie straight away (so the
 * UI reacts without waiting), then a sync refreshes babies, catalogs and events.
 */
export function useBabyActions() {
  const api = useApiClient();
  const db = useDatabase();
  const engine = useSyncEngine();
  const { select } = useSelectedBaby();

  /**
   * Stores a baby the server just returned, selects it and refreshes everything else. A baby the
   * user follows as its Doctor is not selected: it lives in the doctor's dashboard.
   */
  const adopt = async (baby: Baby) => {
    await db.babies.put(baby);
    if (baby.role !== 'Doctor') select(baby.id);
    void engine.syncNow();
  };

  return {
    adopt,
    create: async (request: BabyRequest) => adopt(await createBaby(api, request)),
    update: async (id: string, request: BabyRequest) => {
      await updateBaby(api, id, request);
      await db.babies.update(id, { name: request.name, birthDate: request.birthDate });
      void engine.syncNow();
    },
  };
}
