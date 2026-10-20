import { useState, type ReactNode } from 'react';
import { createDatabase, type BabyRoutineDb } from './database';
import { DatabaseContext } from './DatabaseContext';

/** Provides the local IndexedDB store; pass `db` to inject one (tests). */
export function DatabaseProvider({ db, children }: { db?: BabyRoutineDb; children: ReactNode }) {
  const [database] = useState(() => db ?? createDatabase());
  return <DatabaseContext value={database}>{children}</DatabaseContext>;
}
