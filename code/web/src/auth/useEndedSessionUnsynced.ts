import { useEffect, useState } from 'react';
import Dexie from 'dexie';
import { createDatabase } from '../db/database';
import { countUnsyncedMutations } from '../db/outbox';
import { readEndedSession } from './endedSession';

/**
 * Unsynced changes left in the database of a session that ended (`null` while counting or when
 * unknown). The database is only read: it stays for the next sign-in of the same account.
 */
export function useEndedSessionUnsynced(): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    const name = readEndedSession();
    if (!name) return;
    let cancelled = false;
    void (async () => {
      if (!(await Dexie.exists(name).catch(() => false))) return;
      const db = createDatabase(name);
      try {
        const unsynced = await countUnsyncedMutations(db);
        if (!cancelled) setCount(unsynced);
      } catch {
        // Unreadable store: the generic notice is enough.
      } finally {
        db.close();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  return count;
}
