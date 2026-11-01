/*
 * Names offered while typing a new formula's name: a small, neutral list of infant formula names
 * commonly sold in Brazil, with their stage numbers. It is only a typing aid, not a catalog: no
 * brand is recommended, nothing is said about what a formula does, and any other name can be typed.
 */

export const FORMULA_SUGGESTIONS: readonly string[] = [
  'Aptamil 1',
  'Aptamil 2',
  'Aptamil 3',
  'Aptamil Pepti',
  'Aptamil Profutura 1',
  'Aptamil Profutura 2',
  'Enfamil 1',
  'Enfamil 2',
  'Enfamil Premium 1',
  'Enfamil Premium 2',
  'Milnutri',
  'Nan 1',
  'Nan 2',
  'Nan 3',
  'Nan Supreme 1',
  'Nan Supreme 2',
  'Nestogeno 1',
  'Nestogeno 2',
  'Similac 1',
  'Similac 2',
];

/** Case, accents and spacing do not matter when matching. */
const key = (text: string) =>
  text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Most suggestions shown under the name field. */
export const MAX_SUGGESTIONS = 6;

/**
 * Suggestions for the typed `query`: names where a word starts with what was typed (or that
 * contain it), in list order, without the exact name typed and without `taken` names (the baby's
 * own formulas). Nothing until something is typed.
 */
export function suggestFormulaNames(query: string, taken: readonly string[] = []): string[] {
  const needle = key(query);
  if (needle === '') return [];
  const excluded = new Set([needle, ...taken.map(key)]);
  const candidates = FORMULA_SUGGESTIONS.filter((name) => !excluded.has(key(name)));
  const wordStart = candidates.filter((name) =>
    key(name)
      .split(' ')
      .some((_, index, words) => words.slice(index).join(' ').startsWith(needle)),
  );
  const inside = candidates.filter(
    (name) => !wordStart.includes(name) && key(name).includes(needle),
  );
  return [...wordStart, ...inside].slice(0, MAX_SUGGESTIONS);
}
