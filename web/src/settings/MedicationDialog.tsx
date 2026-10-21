import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
} from '@mui/material';
import { describeApiError } from '../api/errorMessages';
import { useMedicationCommands } from '../db/hooks';
import type { Dosage, Medication } from '../db/models';
import { t } from '../i18n/i18n';

interface Props {
  babyId: string;
  /** Omit to add a new medication. */
  medication?: Medication;
  onClose: () => void;
}

/** Returns the dosage, `null` for none, or an error message. */
function parseDosage(amount: string, unit: string): Dosage | null | string {
  if (!amount.trim() && !unit.trim()) return null;
  const n = Number(amount);
  if (!amount.trim() || !Number.isFinite(n) || n <= 0) return t('settings.medications.doseInvalid');
  if (!unit.trim()) return t('settings.medications.doseNeedsUnit');
  return { amount: n, unit: unit.trim() };
}

export function MedicationDialog({ babyId, medication, onClose }: Props) {
  const { t } = useTranslation();
  const commands = useMedicationCommands();
  const [name, setName] = useState(medication?.name ?? '');
  const [amount, setAmount] = useState(
    medication?.defaultDosage ? String(medication.defaultDosage.amount) : '',
  );
  const [unit, setUnit] = useState(medication?.defaultDosage?.unit ?? '');
  const [notes, setNotes] = useState(medication?.notes ?? '');
  const [isUsual, setIsUsual] = useState(medication?.isUsual ?? false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const dosage = parseDosage(amount, unit);
    if (!name.trim()) return setError(t('settings.medications.nameRequired'));
    if (typeof dosage === 'string') return setError(dosage);
    const changes = {
      name,
      defaultDosage: dosage,
      notes: notes.trim() || null,
      isUsual,
    };
    try {
      if (medication) await commands.update(medication.id, changes);
      else await commands.create({ babyId, ...changes });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? describeApiError(e) : t('settings.medications.saveFailed'));
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {medication ? t('settings.medications.edit') : t('settings.medications.add')}
      </DialogTitle>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label={t('common.name')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="off"
            />
            <Stack direction="row" spacing={1}>
              <TextField
                label={t('settings.medications.defaultDose')}
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                sx={{ flex: 2 }}
              />
              <TextField
                label={t('common.unit')}
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                sx={{ flex: 1 }}
              />
            </Stack>
            <TextField
              label={t('common.notes')}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              multiline
              minRows={2}
            />
            <FormControlLabel
              label={t('settings.medications.usualSwitch')}
              control={<Switch checked={isUsual} onChange={(_, on) => setIsUsual(on)} />}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" variant="contained">
            {t('common.save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
