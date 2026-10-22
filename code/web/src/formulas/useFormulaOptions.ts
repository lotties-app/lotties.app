import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { canWrite } from '../baby/permissions';
import { useDatabase } from '../db/DatabaseContext';
import { useFormulas } from '../db/hooks';
import type { EventType, Formula } from '../db/models';
import { useBottleHistory } from '../events/useBottleHistory';
import { activeFormulas, declaresFormula, defaultFormula } from './formulaModel';

export interface FormulaOptions {
  /** Every formula of the baby, archived ones included (names of older bottles). */
  all: readonly Formula[];
  /** The chips: formulas that are not archived, by name. */
  active: readonly Formula[];
  /** What a new bottle of formula preselects: the current formula, else the last one used. */
  fallback: Formula | null;
  /** Owners and Parents add formulas ("+ New formula"); Caregivers only pick one. */
  canAdd: boolean;
}

/**
 * The formula choice of the event sheet for `type` (the built-in feeding type only), live from the
 * local store: `undefined` for other types and while loading.
 */
export function useFormulaOptions(
  babyId: string,
  type: EventType | undefined,
): FormulaOptions | undefined {
  const db = useDatabase();
  const formulas = useFormulas(babyId);
  const history = useBottleHistory(babyId);
  const baby = useLiveQuery(async () => (await db.babies.get(babyId)) ?? null, [db, babyId]);
  const applies = declaresFormula(type);
  return useMemo(() => {
    if (!applies || !formulas || !history || baby === undefined) return undefined;
    return {
      all: formulas,
      active: activeFormulas(formulas),
      fallback: defaultFormula(formulas, history.events, type?.id),
      canAdd: !!baby && canWrite(baby),
    };
  }, [applies, formulas, history, baby, type?.id]);
}
