import type { ReactNode } from 'react';
import type { BabyRoutineDb } from './database';
import { DatabaseContext } from './DatabaseContext';

/**
 * Provides a local IndexedDB store. The app opens the signed-in account's store through
 * `session/AccountDataProvider`; tests inject their own.
 */
export function DatabaseProvider({ db, children }: { db: BabyRoutineDb; children: ReactNode }) {
  return <DatabaseContext value={db}>{children}</DatabaseContext>;
}
