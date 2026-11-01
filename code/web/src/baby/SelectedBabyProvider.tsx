import { useState, type ReactNode } from 'react';
import { useBabies } from '../db/hooks';
import { SelectedBabyContext } from './SelectedBabyContext';
import { readSelectedBabyId, writeSelectedBabyId } from './selectedBabyStorage';

/** Tracks which baby the app shows; the choice survives reloads via localStorage. */
export function SelectedBabyProvider({ children }: { children: ReactNode }) {
  const babies = useBabies();
  const [selectedId, setSelectedId] = useState(readSelectedBabyId);
  const baby = babies?.find((b) => b.id === selectedId) ?? babies?.[0];

  const select = (id: string) => {
    writeSelectedBabyId(id);
    setSelectedId(id);
  };

  return <SelectedBabyContext value={{ babies, baby, select }}>{children}</SelectedBabyContext>;
}
