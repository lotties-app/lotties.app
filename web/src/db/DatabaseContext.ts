import { createContext, useContext } from 'react';
import type { BabyRoutineDb } from './database';

export const DatabaseContext = createContext<BabyRoutineDb | null>(null);

export function useDatabase(): BabyRoutineDb {
  const db = useContext(DatabaseContext);
  if (!db) throw new Error('useDatabase must be used within DatabaseProvider');
  return db;
}
