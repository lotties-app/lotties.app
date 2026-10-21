import { useTranslation } from 'react-i18next';
import { Box } from '@mui/material';
import { ChipGroup, DateField, Field, NotesRow, TextInput } from '../ui/form';
import { INTERVAL_GROUP_MAX, normalizeGroupName } from './groupName';
import {
  INSTRUCTIONS_MAX,
  LATEST_DATE,
  PRESCRIBER_MAX,
  type FormErrors,
  type PrescriptionForm,
} from './prescriptionForm';

interface Props {
  form: PrescriptionForm;
  errors: FormErrors;
  /** Interval groups already used by the baby's prescriptions (normalised names). */
  groups: readonly string[];
  onChange: (patch: Partial<PrescriptionForm>) => void;
}

/** Shared wait, course dates, prescriber and instructions. */
export function ExtraFields({ form, errors, groups, onChange }: Props) {
  const { t } = useTranslation();
  const current = normalizeGroupName(form.group);
  const options = [...new Set([...groups, ...(current ? [current] : [])])];
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'grid', gap: 1.25 }} data-field-key="group">
        <Field
          label={t('medications.editor.group')}
          optional
          help={t('medications.editor.groupHelp')}
          error={errors.group}
        >
          <TextInput
            value={form.group}
            onChange={(group) => onChange({ group })}
            maxLength={INTERVAL_GROUP_MAX}
            placeholder={t('medications.editor.groupPlaceholder')}
          />
        </Field>
        {options.length > 0 && (
          <ChipGroup
            aria-label={t('medications.editor.groupChoices')}
            value={current}
            clearable
            onChange={(group) => onChange({ group: group ?? '' })}
            options={options.map((value) => ({ value, label: value }))}
          />
        )}
      </Box>
      <Field label={t('medications.editor.startDate')} required error={errors.startDate}>
        <DateField
          value={form.startDate}
          onChange={(startDate) => onChange({ startDate })}
          max={LATEST_DATE}
        />
      </Field>
      <Field label={t('medications.editor.endDate')} optional error={errors.endDate}>
        <DateField
          value={form.endDate}
          onChange={(endDate) => onChange({ endDate })}
          min={form.startDate || undefined}
          max={LATEST_DATE}
        />
      </Field>
      <Field label={t('medications.editor.prescriber')} optional error={errors.prescriber}>
        <TextInput
          value={form.prescriber}
          onChange={(prescriber) => onChange({ prescriber })}
          maxLength={PRESCRIBER_MAX}
        />
      </Field>
      <Field label={t('medications.editor.instructions')} optional error={errors.instructions}>
        <NotesRow
          value={form.instructions}
          onChange={(instructions) => onChange({ instructions })}
          maxLength={INSTRUCTIONS_MAX}
          counterFrom={INSTRUCTIONS_MAX - 200}
        />
      </Field>
    </Box>
  );
}
