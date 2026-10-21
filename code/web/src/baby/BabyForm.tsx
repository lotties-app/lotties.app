import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Stack, TextField } from '@mui/material';
import { DateField } from '../ui/form/DateField';
import { Field } from '../ui/form/Field';
import type { BabyRequest } from '../sync/contract';

interface Props {
  initial?: BabyRequest;
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

/** Name + birth date form shared by baby creation and editing. */
export function BabyForm({
  initial,
  submitLabel,
  disabled = false,
  pending = false,
  onSubmit,
}: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? '');
  const [birthDate, setBirthDate] = useState(initial?.birthDate ?? '');
  const [touched, setTouched] = useState(false);
  const today = todayIso();

  const nameError = !name.trim() ? t('baby.nameRequired') : null;
  const dateError = !birthDate
    ? t('baby.birthRequired')
    : birthDate > today
      ? t('baby.birthFuture')
      : null;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (nameError || dateError) return;
    onSubmit({ name: name.trim(), birthDate });
  };

  return (
    <Stack component="form" spacing={2} onSubmit={submit} noValidate>
      <TextField
        label={t('baby.nameLabel')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={disabled}
        error={touched && !!nameError}
        helperText={touched ? nameError : null}
        required
        autoComplete="off"
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
