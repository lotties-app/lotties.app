import { useTranslation } from 'react-i18next';
import { Box } from '@mui/material';
import type { DayPart } from '../db/models';
import { formatList } from '../i18n/format';
import { ChipGroup, ClockTimeField, Field, SwitchRow } from '../ui/form';
import { dayPartName, dayPartWithWindow } from './dayPartText';
import { DAY_PARTS, sortDayParts } from './dayParts';
import { wrongReminderPart, type FormErrors, type PrescriptionForm } from './prescriptionForm';

interface Props {
  form: PrescriptionForm;
  errors: FormErrors;
  onChange: (patch: Partial<PrescriptionForm>) => void;
}

/** One reminder time input per chosen part (inside the part's window). */
function ReminderTimes({ form, errors, onChange }: Props) {
  const { t } = useTranslation();
  const wrong = errors.reminders ? wrongReminderPart(form) : null;
  const setTime = (part: DayPart, time: string) =>
    onChange({ reminderTimes: { ...form.reminderTimes, [part]: time } });
  return (
    <Box sx={{ display: 'grid', gap: 1.5 }}>
      {sortDayParts(form.parts).map((part) => (
        <Field
          key={part}
          label={t('medications.editor.reminderAt', { part: dayPartName(part) })}
          error={part === wrong ? errors.reminders : undefined}
        >
          <ClockTimeField
            value={form.reminderTimes[part]}
            onChange={(time) => setTime(part, time)}
          />
        </Field>
      ))}
    </Box>
  );
}

/**
 * "Part of the day": which parts the doctor prescribed (one dose in each, any time inside it) and
 * optional reminders (off by default), one time per chosen part.
 */
export function DayPartsFields({ form, errors, onChange }: Props) {
  const { t } = useTranslation();
  const chosen = form.parts.length > 0;
  return (
    <>
      <Field
        label={t('medications.editor.dayParts')}
        required
        group
        error={errors.parts}
        help={t('medications.editor.dayPartsHelp', {
          windows: formatList(DAY_PARTS.map(dayPartWithWindow)),
        })}
      >
        <ChipGroup<DayPart>
          multiple
          aria-label={t('medications.editor.dayParts')}
          value={form.parts}
          onChange={(parts) => onChange({ parts: sortDayParts(parts) })}
          options={DAY_PARTS.map((part) => ({ value: part, label: dayPartName(part) }))}
        />
      </Field>
      {chosen && (
        <SwitchRow
          checked={form.partReminders}
          onChange={(partReminders) => onChange({ partReminders })}
          label={t('medications.editor.partReminders')}
          description={t('medications.editor.partRemindersHelp')}
        />
      )}
      {chosen && form.partReminders && (
        <ReminderTimes form={form} errors={errors} onChange={onChange} />
      )}
    </>
  );
}
