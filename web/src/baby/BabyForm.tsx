import { useState, type FormEvent } from 'react';
import { Button, Stack, TextField } from '@mui/material';
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
  const [name, setName] = useState(initial?.name ?? '');
  const [birthDate, setBirthDate] = useState(initial?.birthDate ?? '');
  const [touched, setTouched] = useState(false);
  const today = todayIso();

  const nameError = !name.trim() ? 'Name is required.' : null;
  const dateError = !birthDate
    ? 'Birth date is required.'
    : birthDate > today
      ? 'Birth date cannot be in the future.'
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
        label="Name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={disabled}
        error={touched && !!nameError}
        helperText={touched ? nameError : null}
        required
        autoComplete="off"
      />
      <TextField
        label="Birth date"
        type="date"
        value={birthDate}
        onChange={(e) => setBirthDate(e.target.value)}
        disabled={disabled}
        error={touched && !!dateError}
        helperText={touched ? dateError : null}
        required
        slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today } }}
      />
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
