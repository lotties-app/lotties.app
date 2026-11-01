import { useTranslation } from 'react-i18next';
import { Box } from '@mui/material';
import { Field, TextInput } from '../ui/form';
import { optionBase, palette } from '../ui/form/styles';
import { FORMULA_LIMITS } from './formulaModel';
import { suggestFormulaNames } from './formulaSuggestions';

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** Names the baby already has (not suggested again). */
  taken: readonly string[];
  error?: string;
}

/**
 * The formula's name with a few names to pick while typing (a small static list of common
 * formulas, see `formulaSuggestions.ts`): tapping one fills the field. Any other name can be typed.
 */
export function FormulaNameField({ value, onChange, taken, error }: Props) {
  const { t } = useTranslation();
  const suggestions = suggestFormulaNames(value, taken);
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Field label={t('formulas.name')} required error={error}>
        <TextInput value={value} onChange={onChange} maxLength={FORMULA_LIMITS.name} />
      </Field>
      {suggestions.length > 0 && (
        <Box
          component="ul"
          aria-label={t('formulas.suggestions')}
          sx={{ m: 0, p: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: 1 }}
        >
          {suggestions.map((name) => (
            <li key={name}>
              <Box
                component="button"
                type="button"
                onClick={() => onChange(name)}
                aria-label={t('formulas.useSuggestion', { name })}
                sx={(theme) => ({
                  ...optionBase(theme),
                  minHeight: 44,
                  px: 1.75,
                  borderRadius: '999px',
                  backgroundColor: palette(theme).surfaceRaised,
                  fontSize: '0.875rem',
                })}
              >
                {name}
              </Box>
            </li>
          ))}
        </Box>
      )}
    </Box>
  );
}
