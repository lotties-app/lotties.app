import { useTranslation } from 'react-i18next';
import { Box } from '@mui/material';
import type { BodyWeightRow } from '../db/models';
import { formatDate, formatNumber, formatUnit } from '../i18n/format';
import { ChipGroup, Field, NumberStepper, SwitchRow, TextInput } from '../ui/form';
import {
  AMOUNT_MAX,
  ROUNDING_CHOICES,
  UNIT_MAX,
  type FormErrors,
  type PrescriptionForm,
  type RoundingChoice,
} from './prescriptionForm';

interface Props {
  form: PrescriptionForm;
  errors: FormErrors;
  weight: BodyWeightRow | null;
  onChange: (patch: Partial<PrescriptionForm>) => void;
}

const UNIT_CHIPS = ['drops', 'ml', 'mg'] as const;

/** Dose: amount and unit, the "per kg" switch and, for per-kg rules, the rounding step. */
export function DoseFields({ form, errors, weight, onChange }: Props) {
  const { t } = useTranslation();
  const unitLabel = (unit: (typeof UNIT_CHIPS)[number]) => t(`ui.units.${unit}`);
  const dropsLabel = unitLabel('drops');
  const step = form.unit.trim().toLowerCase() === unitLabel('ml').toLowerCase() ? 0.5 : 1;
  const roundingLabel = (choice: RoundingChoice) =>
    choice === 'none'
      ? t('medications.editor.roundingNone')
      : t('medications.editor.roundingTo', { step: formatNumber(Number(choice)) });

  return (
    <Box sx={{ display: 'grid', gap: 2 }} data-field-key="dose">
      <Field
        label={form.perKg ? t('medications.editor.amountPerKg') : t('medications.editor.amount')}
        required
        error={errors.amount}
      >
        <NumberStepper
          value={form.amount}
          onChange={(amount) => onChange({ amount })}
          step={step}
          min={0}
          max={AMOUNT_MAX}
          decimals={3}
          start={1}
        />
      </Field>
      <Field label={t('medications.editor.unit')} required error={errors.unit}>
        <TextInput
          value={form.unit}
          onChange={(unit) => onChange({ unit })}
          maxLength={UNIT_MAX}
          placeholder={dropsLabel}
        />
      </Field>
      <ChipGroup
        aria-label={t('medications.editor.unitChoices')}
        value={UNIT_CHIPS.map(unitLabel).find((u) => u === form.unit) ?? null}
        onChange={(unit) => onChange({ unit: unit ?? '' })}
        options={UNIT_CHIPS.map((unit) => ({ value: unitLabel(unit), label: unitLabel(unit) }))}
      />
      <SwitchRow
        checked={form.perKg}
        onChange={(perKg) => onChange({ perKg, ...(perKg ? {} : { rounding: 'none' as const }) })}
        label={t('medications.editor.perKg')}
        description={t('medications.editor.perKgHelp')}
      />
      {form.perKg && (
        <>
          <Box sx={{ fontSize: '0.8125rem', color: 'text.secondary' }}>
            {weight
              ? t('medications.editor.weightOnRecord', {
                  weight: formatUnit(weight.kg, 'kilogram'),
                  date: formatDate(weight.date, 'dayMonthYear'),
                })
              : t('medications.editor.noWeight')}
          </Box>
          <Field label={t('medications.editor.rounding')} group optional>
            <ChipGroup
              value={form.rounding}
              onChange={(rounding) => onChange({ rounding: rounding ?? 'none' })}
              options={ROUNDING_CHOICES.map((choice) => ({
                value: choice,
                label: roundingLabel(choice),
              }))}
            />
          </Field>
        </>
      )}
    </Box>
  );
}
