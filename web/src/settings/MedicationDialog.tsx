import { useState, type FormEvent } from 'react';
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
import { useMedicationCommands } from '../db/hooks';
import type { Dosage, Medication } from '../db/models';

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
  if (!amount.trim() || !Number.isFinite(n) || n <= 0) return 'Dose must be a positive number.';
  if (!unit.trim()) return 'A dose needs a unit.';
  return { amount: n, unit: unit.trim() };
}

export function MedicationDialog({ babyId, medication, onClose }: Props) {
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
    if (!name.trim()) return setError('Name is required.');
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
      setError(e instanceof Error ? e.message : 'Could not save the medication.');
    }
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{medication ? 'Edit medication' : 'Add medication'}</DialogTitle>
      <form onSubmit={(e) => void submit(e)} noValidate>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoComplete="off"
            />
            <Stack direction="row" spacing={1}>
              <TextField
                label="Default dose"
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                sx={{ flex: 2 }}
              />
              <TextField
                label="Unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                sx={{ flex: 1 }}
              />
            </Stack>
            <TextField
              label="Notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              multiline
              minRows={2}
            />
            <FormControlLabel
              label="Usual medication"
              control={<Switch checked={isUsual} onChange={(_, on) => setIsUsual(on)} />}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained">
            Save
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
