import { useState } from 'react';
import {
  Button,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import { canWrite } from '../baby/permissions';
import { useMedicationCommands, useMedications } from '../db/hooks';
import type { Baby, Medication } from '../db/models';
import { ConfirmDialog } from './ConfirmDialog';
import { MedicationDialog } from './MedicationDialog';

type Editing = { medication: Medication } | 'new' | null;

function dosageText(medication: Medication): string | null {
  const dose = medication.defaultDosage;
  return dose ? `${dose.amount} ${dose.unit}` : null;
}

function MedicationRow({
  medication,
  writable,
  onEdit,
  onDelete,
}: {
  medication: Medication;
  writable: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <ListItem
      divider
      secondaryAction={
        writable && (
          <Stack direction="row">
            <IconButton aria-label={`Edit ${medication.name}`} onClick={onEdit}>
              <EditIcon />
            </IconButton>
            <IconButton aria-label={`Delete ${medication.name}`} onClick={onDelete}>
              <DeleteIcon />
            </IconButton>
          </Stack>
        )
      }
    >
      <ListItemText
        primary={
          <>
            {medication.name}
            {medication.isUsual && <Chip size="small" label="Usual" sx={{ ml: 1 }} />}
          </>
        }
        secondary={[dosageText(medication), medication.notes].filter(Boolean).join(' · ')}
      />
    </ListItem>
  );
}

/** Medication catalog. Works offline: edits go through the local store and the outbox. */
export function MedicationsSection({ baby }: { baby: Baby }) {
  const medications = useMedications(baby.id);
  const commands = useMedicationCommands();
  const writable = canWrite(baby);
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<Medication | null>(null);

  if (!medications) return null;

  return (
    <Stack spacing={1}>
      {medications.length === 0 && (
        <Typography color="text.secondary">No medications yet.</Typography>
      )}
      <List aria-label="Medications" disablePadding>
        {medications.map((m) => (
          <MedicationRow
            key={m.id}
            medication={m}
            writable={writable}
            onEdit={() => setEditing({ medication: m })}
            onDelete={() => setDeleting(m)}
          />
        ))}
      </List>
      {writable ? (
        <Button
          startIcon={<AddIcon />}
          variant="outlined"
          onClick={() => setEditing('new')}
          sx={{ minHeight: 48, alignSelf: 'flex-start' }}
        >
          Add medication
        </Button>
      ) : (
        <Typography color="text.secondary">
          You can view medications but not change them.
        </Typography>
      )}
      {editing && (
        <MedicationDialog
          babyId={baby.id}
          medication={editing === 'new' ? undefined : editing.medication}
          onClose={() => setEditing(null)}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title={`Delete ${deleting.name}?`}
          body="Past events keep their own copy of the medication."
          confirmLabel="Delete medication"
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            void commands.remove(deleting.id);
            setDeleting(null);
          }}
        />
      )}
    </Stack>
  );
}
