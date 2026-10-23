import { useMemo, useState, type ReactNode } from 'react';
import { familyBabies } from '../doctor/appMode';
import { useBabies } from '../db/hooks';
import { SelectedBabyContext } from './SelectedBabyContext';
import { readSelectedBabyId, writeSelectedBabyId } from './selectedBabyStorage';

/**
 * Tracks which baby the app shows; the choice survives reloads via localStorage. Only the babies
 * the user cares for: a baby followed as its Doctor lives in the doctor's dashboard
 * (docs/design/19-doctor-dashboard.md), never in the parents' screens.
 */
export function SelectedBabyProvider({ children }: { children: ReactNode }) {
  const all = useBabies();
  const babies = useMemo(() => (all ? familyBabies(all) : undefined), [all]);
  const [selectedId, setSelectedId] = useState(readSelectedBabyId);
  const baby = babies?.find((b) => b.id === selectedId) ?? babies?.[0];

  const select = (id: string) => {
    writeSelectedBabyId(id);
    setSelectedId(id);
  };

  return <SelectedBabyContext value={{ babies, baby, select }}>{children}</SelectedBabyContext>;
}
