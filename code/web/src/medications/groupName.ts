/** Longest interval group label the API accepts. */
export const INTERVAL_GROUP_MAX = 50;

/**
 * The API's normal form of an interval group label (lower case, no diacritics, single spaces), so
 * "Cólica" and "colica " are one group. `null` for blank text.
 */
export function normalizeGroupName(text: string | null | undefined): string | null {
  const normalized = (text ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
  return normalized === '' ? null : normalized;
}
