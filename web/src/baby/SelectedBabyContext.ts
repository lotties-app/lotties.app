import { createContext, use } from 'react';
import type { Baby } from '../db/models';

export interface SelectedBaby {
  /** `undefined` while the first local query is loading. */
  babies: Baby[] | undefined;
  /** The selected baby, or the first one when nothing (valid) is stored. */
  baby: Baby | undefined;
  select: (id: string) => void;
}

export const SelectedBabyContext = createContext<SelectedBaby | null>(null);

export function useSelectedBaby(): SelectedBaby {
  const value = use(SelectedBabyContext);
  if (!value) throw new Error('useSelectedBaby must be used within SelectedBabyProvider');
  return value;
}
