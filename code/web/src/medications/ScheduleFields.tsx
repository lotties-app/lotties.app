import { useTranslation } from 'react-i18next';
import { Box } from '@mui/material';
import type { PrescriptionKind } from '../db/models';
import { Field, NumberStepper, SegmentedControl, TextInput } from '../ui/form';
import { DayPartsFields } from './DayPartsFields';
import { TimesOfDayField } from './TimesOfDayField';
import {
  INDICATION_MAX,
  INTERVAL_PRESETS_HOURS,
  MAX_DOSES_LIMIT,
  type FormErrors,
  type PrescriptionForm,
  type ScheduleBy,
} from './prescriptionForm';

interface Props {
  form: PrescriptionForm;
  errors: FormErrors;
  onChange: (patch: Partial<PrescriptionForm>) => void;
}

const MIN_HOURS = 0.25;
const MAX_HOURS = 168;

function HoursStepper({
  value,
  onChange,
  label,
}: {
  value: number | null;
  onChange: (hours: number | null) => void;
  label: string;
}) {
  const { t } = useTranslation();
  return (
    <NumberStepper
      aria-label={label}
      value={value}
      onChange={onChange}
      step={0.5}
      min={MIN_HOURS}
      max={MAX_HOURS}
      decimals={2}
      start={8}
      unit={t('medications.interval.hoursShort')}
      quickValues={INTERVAL_PRESETS_HOURS}
    />
  );
}

/**
 * When it is given: scheduled (clock times, every N hours or parts of the day) or as needed
 * (minimum interval, max).
 */
export function ScheduleFields({ form, errors, onChange }: Props) {
  const { t } = useTranslation();
  const scheduled = form.kind === 'scheduled';
  return (
    <Box sx={{ display: 'grid', gap: 2 }} data-field-key="schedule">
      <Field label={t('medications.editor.kind')} group>
        <SegmentedControl<PrescriptionKind>
          value={form.kind}
          onChange={(kind) => onChange({ kind: kind ?? 'asNeeded' })}
          options={[
            { value: 'scheduled', label: t('medications.kind.scheduled'), icon: 'clock' },
            { value: 'asNeeded', label: t('medications.kind.asNeeded'), icon: 'pill' },
          ]}
        />
      </Field>
      {scheduled && (
        <>
          <Field label={t('medications.editor.scheduleBy')} group>
            <SegmentedControl<ScheduleBy>
              value={form.scheduleBy}
              onChange={(scheduleBy) => onChange({ scheduleBy: scheduleBy ?? 'times' })}
              options={[
                { value: 'times', label: t('medications.editor.byTimes') },
                { value: 'every', label: t('medications.editor.byEvery') },
                { value: 'parts', label: t('medications.editor.byParts') },
              ]}
            />
          </Field>
          {form.scheduleBy === 'parts' ? (
            <DayPartsFields form={form} errors={errors} onChange={onChange} />
          ) : form.scheduleBy === 'times' ? (
            <Field label={t('medications.editor.timesOfDay')} required group error={errors.times}>
              <TimesOfDayField value={form.times} onChange={(times) => onChange({ times })} />
            </Field>
          ) : (
            <Field label={t('medications.editor.everyHours')} required error={errors.every}>
              <HoursStepper
                label={t('medications.editor.everyHours')}
                value={form.everyHours}
                onChange={(everyHours) => onChange({ everyHours })}
              />
            </Field>
          )}
        </>
      )}
      {!scheduled && (
        <>
          <Field
            label={t('medications.editor.minInterval')}
            required
            help={t('medications.editor.minIntervalHelp')}
            error={errors.minInterval}
          >
            <HoursStepper
              label={t('medications.editor.minInterval')}
              value={form.minIntervalHours}
              onChange={(minIntervalHours) => onChange({ minIntervalHours })}
            />
          </Field>
          <Field label={t('medications.editor.maxDoses')} optional error={errors.maxDoses}>
            <NumberStepper
              aria-label={t('medications.editor.maxDoses')}
              value={form.maxDoses}
              onChange={(maxDoses) => onChange({ maxDoses })}
              min={1}
              max={MAX_DOSES_LIMIT}
              start={3}
            />
          </Field>
        </>
      )}
      <Field label={t('medications.editor.indication')} optional error={errors.indication}>
        <TextInput
          value={form.indication}
          onChange={(indication) => onChange({ indication })}
          maxLength={INDICATION_MAX}
          placeholder={t('medications.editor.indicationPlaceholder')}
        />
      </Field>
    </Box>
  );
}
