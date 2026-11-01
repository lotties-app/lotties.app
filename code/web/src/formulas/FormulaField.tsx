import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box } from '@mui/material';
import { Icon } from '../ui/Icon';
import { ChipGroup, Field } from '../ui/form';
import { optionBase, palette } from '../ui/form/styles';
import { FORMULA_ID_KEY } from './formulaModel';
import { FormulaSheet } from './FormulaSheet';
import type { FormulaChoice } from './useFormulaChoice';

/**
 * Which formula a bottle of formula was: the baby's formulas as chips (the current one, else the
 * last one used, preselected on a new bottle; tap the selected chip again to name none), and for
 * Owners and Parents "+ New formula", a tiny sheet with the name only. Hidden for other contents
 * and when there is nothing to pick or add (a Caregiver of a baby without formulas).
 */
export function FormulaField({ babyId, choice }: { babyId: string; choice: FormulaChoice }) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const { options, chips, selectedId } = choice;
  if (!choice.visible || !options || (chips.length === 0 && !options.canAdd)) return null;
  return (
    <Box data-field-key={FORMULA_ID_KEY} sx={{ display: 'grid', gap: 1 }}>
      <Field label={t('formulas.field')} group optional>
        {chips.length > 0 ? (
          <ChipGroup
            value={selectedId}
            clearable
            options={chips.map((chip) => ({ value: chip.id, label: chip.name }))}
            onChange={(id) => choice.select(chips.find((chip) => chip.id === id) ?? null)}
          />
        ) : (
          <Box sx={{ fontSize: '0.875rem', color: 'text.secondary' }}>{t('formulas.noneYet')}</Box>
        )}
      </Field>
      {options.canAdd && (
        <Box
          component="button"
          type="button"
          onClick={() => setAdding(true)}
          sx={(theme) => ({
            ...optionBase(theme),
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            minHeight: 44,
            px: 1.75,
            borderRadius: '999px',
            backgroundColor: palette(theme).surfaceRaised,
            color: palette(theme).primary.main,
            fontWeight: 600,
            fontSize: '0.875rem',
            justifySelf: 'start',
          })}
        >
          <Icon name="add" size={20} />
          <span>{t('formulas.newFormula')}</span>
        </Box>
      )}
      {adding && (
        <FormulaSheet
          compact
          babyId={babyId}
          formulas={options.all}
          onClose={() => setAdding(false)}
          onSaved={(formula) => choice.select(formula)}
        />
      )}
    </Box>
  );
}
