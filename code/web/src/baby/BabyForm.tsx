import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Stack, TextField, Typography } from '@mui/material';
import { DateField } from '../ui/form/DateField';
import { Field } from '../ui/form/Field';
import { formatDate } from '../i18n/format';
import type { BabyRequest } from '../sync/contract';
import { mondayOf } from './birthWeek';
import { LabelPicker } from './LabelPicker';
import { BABY_LABEL_PRESETS, LABEL_MAX_LENGTH, babyLabelText } from './shownName';

interface Props {
  initial?: BabyRequest & { birthWeekOnly?: boolean };
  submitLabel: string;
  disabled?: boolean;
  pending?: boolean;
  onSubmit: (request: BabyRequest) => void;
}

function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Name + label + birth date form shared by baby creation and editing (docs/design/45): the name is
 * optional (the label is shown without one) and the date is stored as its week.
 */
export function BabyForm({
  initial,
  submitLabel,
  disabled = false,
  pending = false,
  onSubmit,
}: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? '');
  const [label, setLabel] = useState(initial?.label?.trim() || 'baby');
  const [birthDate, setBirthDate] = useState(initial?.birthDate ?? '');
  const [touched, setTouched] = useState(false);
  const today = todayIso();
  const exactStored = initial !== undefined && initial.birthWeekOnly !== true;

  const dateError = !birthDate
    ? t('baby.birthRequired')
    : birthDate > today
      ? t('baby.birthFuture')
      : null;

  const request = (): BabyRequest => ({
    name: name.trim(),
    label: label.trim() || 'baby',
    birthDate,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (dateError) return;
    onSubmit(request());
  };

  const storeOnlyWeek = () => {
    setTouched(true);
    if (dateError) return;
    onSubmit({ ...request(), birthWeekOnly: true });
  };

  return (
    <Stack component="form" spacing={2} onSubmit={submit} noValidate>
      <TextField
        label={t('baby.nameLabel')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={disabled}
        helperText={t('baby.nameHelp')}
        slotProps={{ htmlInput: { maxLength: LABEL_MAX_LENGTH } }}
        autoComplete="off"
      />
      <LabelPicker
        value={label}
        presets={BABY_LABEL_PRESETS}
        presetText={babyLabelText}
        label={t('baby.labelLabel')}
        customLabel={t('baby.labelCustom')}
        customOption={t('baby.labelPreset.custom')}
        helperText={t('baby.labelHelp')}
        disabled={disabled}
        onChange={setLabel}
      />
      <Field
        label={t('baby.birthDate')}
        required
        group
        disabled={disabled}
        error={touched ? dateError : null}
      >
        <DateField value={birthDate} onChange={setBirthDate} max={today} disabled={disabled} />
      </Field>
      <Typography variant="body2" color="text.secondary">
        {t('baby.birthWeekNotice')}
      </Typography>
      {birthDate && !dateError && (
        <Typography variant="body2" color="text.secondary">
          {t('baby.birthWeekStored', { date: formatDate(mondayOf(birthDate)) })}
        </Typography>
      )}
      {exactStored && (
        <>
          <Typography variant="body2" color="text.secondary">
            {t('baby.birthExactStored')}
          </Typography>
          <Button
            variant="outlined"
            onClick={storeOnlyWeek}
            disabled={disabled || pending}
            sx={{ minHeight: 48 }}
          >
            {t('baby.storeOnlyWeek')}
          </Button>
        </>
      )}
      <Button
        type="submit"
        variant="contained"
        disabled={disabled || pending}
        sx={{ minHeight: 48 }}
      >
        {submitLabel}
      </Button>
    </Stack>
  );
}
