import { useTranslation } from 'react-i18next';
import { SPECIALTY_CODES, specialtyCodeOf } from './providerModel';

const fold = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();

/**
 * Specialties are stored as free text. A suggested one is stored by its code (`pediatrician`) so
 * every device shows it in its own language; anything else is shown as typed.
 */
export function useSpecialtyLabel() {
  const { t } = useTranslation();
  /** The text to show for a stored specialty, or `null` when none. */
  const labelOf = (specialty: string | null): string | null => {
    const code = specialtyCodeOf(specialty);
    if (code) return t(`providers.specialties.${code}`);
    return specialty?.trim() || null;
  };
  /** The code whose translated label is `text` (accents and case ignored), else `null`. */
  const codeOfLabel = (text: string): string | null => {
    const wanted = fold(text);
    if (!wanted) return null;
    const code = SPECIALTY_CODES.find((c) => fold(t(`providers.specialties.${c}`)) === wanted);
    return code ?? null;
  };
  return { labelOf, codeOfLabel };
}
