import type { Dispatch, SetStateAction } from 'react';
import type { BabyEvent, EventType, Formula } from '../db/models';
import type { FinishMode } from '../events/eventSheetTypes';
import { pruneHiddenValues, type EventFormState } from '../events/formModel';
import { isFieldVisible } from '../events/payloadRules';
import { getOwn, withOwn } from '../util/ownProperty';
import { declaresFormula, FORMULA_ID_KEY, FORMULA_NAME_KEY, formulaIdOf } from './formulaModel';
import { useFormulaOptions, type FormulaOptions } from './useFormulaOptions';

/** A chip of the formula choice (a formula of the list, or the one an older bottle names). */
export interface FormulaChip {
  id: string;
  name: string;
  archived: boolean;
}

export interface FormulaChoice {
  /** The chips show: built-in feeding, a bottle of formula, and in a finish form only when asked. */
  visible: boolean;
  options: FormulaOptions | undefined;
  chips: FormulaChip[];
  /** The selected formula: the one picked, else (new bottles) the preselected one. */
  selectedId: string | null;
  /** Picks a formula (`null`: none named for this bottle). */
  select: (formula: Pick<Formula, 'id' | 'name'> | null) => void;
  /** The form values to save: a bottle left on the preselected formula gets its id and name. */
  valuesToSave: (values: EventFormState['values']) => EventFormState['values'];
}

interface Input {
  babyId: string;
  type: EventType | undefined;
  event: BabyEvent | undefined;
  finish: FinishMode | undefined;
  values: EventFormState['values'];
  setForm: Dispatch<SetStateAction<EventFormState>>;
}

/** Whether the formula members are shown for these values (a bottle whose content is formula). */
function formulaVisible(type: EventType | undefined, values: EventFormState['values']) {
  const field = type?.fields.find((f) => f.key === FORMULA_ID_KEY);
  return !!type && !!field && isFieldVisible(type.fields, field, (key) => getOwn(values, key));
}

function chipsOf(
  options: FormulaOptions | undefined,
  selectedId: string | null,
  snapshot: unknown,
): FormulaChip[] {
  const chips: FormulaChip[] = (options?.active ?? []).map((f) => ({
    id: f.id,
    name: f.name,
    archived: false,
  }));
  if (!selectedId || chips.some((chip) => chip.id === selectedId)) return chips;
  const known = options?.all.find((f) => f.id === selectedId);
  const name = known?.name ?? (typeof snapshot === 'string' && snapshot !== '' ? snapshot : null);
  return name ? [...chips, { id: selectedId, name, archived: known?.archived ?? false }] : chips;
}

/**
 * The formula of a bottle in the event sheet. A value of `formula_id` in the form means a choice
 * was made (`''` = none); without one, a new bottle (or a timer being finished that names none)
 * preselects the current formula, else the last one used, and saves it. Editing a logged bottle
 * never fills one in on its own.
 */
export function useFormulaChoice({
  babyId,
  type,
  event,
  finish,
  values,
  setForm,
}: Input): FormulaChoice {
  const options = useFormulaOptions(babyId, type);
  const asked = !finish || finish.fields.includes(FORMULA_ID_KEY);
  const visible = declaresFormula(type) && asked && formulaVisible(type, values);
  const automatic = !event || (!!finish && !formulaIdOf(event.payload));
  const explicit = getOwn(values, FORMULA_ID_KEY);
  const fallback = automatic ? (options?.fallback ?? null) : null;
  const selectedId =
    typeof explicit === 'string' ? explicit || null : visible ? (fallback?.id ?? null) : null;

  const select = (formula: Pick<Formula, 'id' | 'name'> | null) =>
    setForm((form) => ({
      ...form,
      values: pruneHiddenValues(
        withOwn<string | boolean>(
          withOwn<string | boolean>(form.values, FORMULA_ID_KEY, formula?.id ?? ''),
          FORMULA_NAME_KEY,
          formula?.name ?? '',
        ),
        type,
      ),
    }));

  const valuesToSave = (current: EventFormState['values']) => {
    const untouched = getOwn(current, FORMULA_ID_KEY) === undefined;
    if (!visible || !untouched || !fallback || !formulaVisible(type, current)) return current;
    const named = withOwn<string | boolean>(current, FORMULA_ID_KEY, fallback.id);
    return withOwn<string | boolean>(named, FORMULA_NAME_KEY, fallback.name);
  };

  return {
    visible,
    options,
    chips: chipsOf(options, selectedId, getOwn(values, FORMULA_NAME_KEY)),
    selectedId,
    select,
    valuesToSave,
  };
}
