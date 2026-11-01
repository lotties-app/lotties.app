import { useState } from 'react';
import {
  Button,
  Checkbox,
  Chip,
  FormControlLabel,
  FormGroup,
  FormLabel,
  Stack,
  TextField,
} from '@mui/material';
import { useMedicationCommands, useMedications } from '../db/hooks';
import type { Medication } from '../db/models';
import type { EventFormState, MedicationSelection } from './formModel';
import { getOwn, withOwn, withoutOwn } from '../util/ownProperty';

type Selected = EventFormState['medications'];

interface Props {
  babyId: string;
  selected: Selected;
  onChange: (selected: Selected) => void;
}

function selectionFor(medication: Medication): MedicationSelection {
  return {
    name: medication.name,
    amount: medication.defaultDosage ? String(medication.defaultDosage.amount) : '',
    unit: medication.defaultDosage?.unit ?? '',
  };
}

function DoseFields({
  name,
  value,
  onChange,
}: {
  name: string;
  value: MedicationSelection;
  onChange: (value: MedicationSelection) => void;
}) {
  return (
    <Stack direction="row" spacing={1} sx={{ pl: 4, pb: 1 }}>
      <TextField
        size="small"
        type="number"
        label={`${name} dose`}
        value={value.amount}
        onChange={(e) => onChange({ ...value, amount: e.target.value })}
        sx={{ flex: 2 }}
      />
      <TextField
        size="small"
        label={`${name} unit`}
        value={value.unit}
        onChange={(e) => onChange({ ...value, unit: e.target.value })}
        sx={{ flex: 1 }}
      />
    </Stack>
  );
}

function AddMedication({ babyId, onAdded }: { babyId: string; onAdded: (m: Medication) => void }) {
  const { create } = useMedicationCommands();
  const [name, setName] = useState('');

  const add = async () => {
    if (!name.trim()) return;
    onAdded(await create({ babyId, name }));
    setName('');
  };

  return (
    <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
      <TextField
        size="small"
        label="New medication"
        value={name}
        onChange={(e) => setName(e.target.value)}
        sx={{ flexGrow: 1 }}
      />
      <Button variant="outlined" onClick={add} disabled={!name.trim()} sx={{ minHeight: 40 }}>
        Add medication
      </Button>
    </Stack>
  );
}

export function MedicationChecklist({ babyId, selected, onChange }: Props) {
  const medications = useMedications(babyId) ?? [];

  const toggle = (medication: Medication) => {
    const removed = getOwn(selected, medication.id);
    onChange(
      removed
        ? withoutOwn(selected, medication.id)
        : withOwn(selected, medication.id, selectionFor(medication)),
    );
  };

  return (
    <FormGroup>
      <FormLabel>Medications</FormLabel>
      {medications.map((medication) => {
        const selection = getOwn(selected, medication.id);
        return (
          <div key={medication.id}>
            <FormControlLabel
              sx={{ minHeight: 48 }}
              label={
                <>
                  {medication.name}
                  {medication.isUsual && <Chip size="small" label="Usual" sx={{ ml: 1 }} />}
                </>
              }
              control={
                <Checkbox
                  checked={selection !== undefined}
                  onChange={() => toggle(medication)}
                  slotProps={{ input: { 'aria-label': medication.name } }}
                />
              }
            />
            {selection && (
              <DoseFields
                name={medication.name}
                value={selection}
                onChange={(value) => onChange(withOwn(selected, medication.id, value))}
              />
            )}
          </div>
        );
      })}
      <AddMedication
        babyId={babyId}
        onAdded={(m) => onChange(withOwn(selected, m.id, selectionFor(m)))}
      />
    </FormGroup>
  );
}
